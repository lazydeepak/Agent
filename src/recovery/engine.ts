/**
 * Agent-relay codebase — module explanation / info.
 * File: src/recovery/engine.ts
 * Purpose: Source module for engine.ts.
 */
import { type ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import { type OpenCodeSessionManager } from "../adapters/opencode/index.js";
import type {
  ObservationSnapshot,
  RecoveryErrorCode,
  SupervisorContinuity,
  SupervisorState
} from "../types.js";
import type { RelayStore } from "../persistence/index.js";
import { type SupervisorEvent, type SupervisorLogger } from "../contracts/events.js";
import type { BrowserManager } from "./browser.js";
import { recoverChatGPT } from "./chatgpt.js";
import { recoverOpenCode, type OpenCodeServerLauncher } from "./opencode.js";
import { recoveryActionForState, type RecoveryAction, isRecoveryPolicy } from "./policy.js";
import { type BackoffPolicy } from "./schedule.js";
import { humanReason } from "./reasons.js";
import type { RelayableMessage, SessionPair } from "../types.js";

export interface RecoveryEngineDeps {
  pair: SessionPair;
  worker: OpenCodeSessionManager;
  planner: ChatGPTBrowserAdapter;
  browser: BrowserManager;
  store: RelayStore;
  logger?: SupervisorLogger;
  onEvent?: (event: SupervisorEvent) => void;
  now?: () => Date;
  clock?: () => Date;
  policy?: string;
  maxAttempts?: number;
  backoff?: BackoffPolicy;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  startServerLauncher?: OpenCodeServerLauncher;
  baseUrl?: string;
  verifyAllAffectedWorkersIdle?: () => Promise<boolean>;
  terminateOpenCodeDesktop?: () => Promise<void>;
  relaunchOpenCodeDesktop?: () => Promise<void>;
  /** v1.1 §9.3 — shared restart deadline (default 60_000 ms). */
  sharedRestartDeadlineMs?: number;
  /** v1.1 §9.3 — temporarily pause affected pairs before the shared restart. */
  pauseAffectedPairs?: () => Promise<void>;
  /** v1.1 §9.3 — restore exactly the pairs paused by pauseAffectedPairs. */
  restoreAffectedPairs?: () => Promise<void>;
  relaunchSettleMs?: number;
}

export interface RecoveryRunResult {
  performed: boolean;
  recovered: boolean;
  action: RecoveryAction;
  code?: RecoveryErrorCode;
  reason?: string;
  attemptCount: number;
  intervention: boolean;
  cancelled: boolean;
}

interface AttemptInput {
  state: SupervisorState;
  snapshot: ObservationSnapshot;
  continuity: SupervisorContinuity;
  previousState?: SupervisorState;
}

/** v1.1 §11.3 — maximum corrective attempts per incident before the pair is suspended from automated recovery. */
export const RECOVERY_CORRECTIVE_BUDGET = 3;
/** v1.1 §11.3 — maximum active recovery duration per incident. */
export const RECOVERY_DURATION_LIMIT_MS = 10 * 60_000;
/** v1.1 §11.4 — window for reaching the identical-failure limit. */
export const RECOVERY_SIGNATURE_WINDOW_MS = RECOVERY_DURATION_LIMIT_MS;

export class RecoveryEngine {
  private readonly now: () => Date;
  private readonly logger: SupervisorLogger | undefined;

  constructor(private readonly deps: RecoveryEngineDeps) {
    this.now = deps.now ?? deps.clock ?? (() => new Date());
    this.logger = deps.logger;
  }

  async attempt(input: AttemptInput): Promise<RecoveryRunResult> {
    if (input.continuity.paused) {
      return {
        performed: false,
        recovered: false,
        action: "none",
        attemptCount: 0,
        intervention: false,
        cancelled: false
      };
    }

    // v1.1 §11 — a suspended pair is not eligible for automated recovery until the operator releases it.
    if (input.continuity.recoverySuspended) {
      return {
        performed: false,
        recovered: false,
        action: "none",
        attemptCount: input.continuity.recoveryAttemptCount ?? 0,
        intervention: true,
        cancelled: false,
        code: "RECOVERY_SUSPENDED",
        reason: `Recovery suspended for pair ${this.deps.pair.pairId} (v1.1 §11): repeated failures exhausted the corrective budget. Only the operator may release the suspension.`
      };
    }

    if (this.deps.policy === "none") {
      return {
        performed: false,
        recovered: false,
        action: "none",
        attemptCount: input.continuity.recoveryAttemptCount ?? 0,
        intervention: false,
        cancelled: false
      };
    }

    if (this.deps.policy !== undefined && !isRecoveryPolicy(this.deps.policy)) {
      return {
        performed: false,
        recovered: false,
        action: "none",
        attemptCount: 0,
        intervention: false,
        cancelled: false
      };
    }

    const action = recoveryActionForState(input.state);

    const ambiguous = this.pendingAmbiguousRelay();
    if (ambiguous) {
      this.emit("AMBIGUOUS_DELIVERY_BLOCKED", {
        reason:
          "An interrupted relay delivery is pending for this pair. Automatic recovery refuses to resend; operator decision required.",
        details: { recordId: ambiguous.id, direction: ambiguous.direction, status: ambiguous.status }
      });
      return {
        performed: false,
        recovered: false,
        action: "none",
        code: "RELAY_AMBIGUOUS",
        reason: "Interrupted relay delivery pending; operator decision required.",
        attemptCount: 0,
        intervention: true,
        cancelled: false
      };
    }

    const stateHandled = input.state === "DISCONNECTED" || input.state === "FAILED" || input.state === "STUCK";
    if (input.snapshot.worker.reachable && input.snapshot.worker.sessionExists &&
        (input.snapshot.planner.rateLimitedUntil ?? 0) > this.now().getTime()) {
      return { performed: false, recovered: false, action: "none", attemptCount: 0,
        intervention: false, cancelled: false };
    }
    if (!stateHandled) {
      return {
        performed: false,
        recovered: false,
        action: "none",
        attemptCount: 0,
        intervention: false,
        cancelled: false
      };
    }

    // A completed worker step can fail while both endpoints remain healthy.
    // Transport recovery cannot repair a provider/task failure or replay it.
    if (input.state === "FAILED" && input.snapshot.worker.reachable &&
        input.snapshot.worker.sessionExists && !plannerFailureState(input)) {
      return { performed: false, recovered: false, action: "none",
        attemptCount: input.continuity.recoveryAttemptCount ?? 0,
        intervention: true, cancelled: false };
    }

    const previousDisconnected = input.previousState !== "DISCONNECTED";
    if (input.state === "DISCONNECTED" && previousDisconnected) {
      this.emit("PEER_DISCONNECTED", {
        reason: peerDetailReason(input.snapshot)
      });
    }

    this.emit("RECOVERY_STARTED", { reason: `Starting ${action} recovery.`, details: { action } });

    const baseAttempt = input.continuity.recoveryAttemptCount ?? 0;
    const attemptNumber = baseAttempt + 1;

    const outcomes: Array<{ code?: RecoveryErrorCode; intervention: boolean; recovered: boolean }> = [];

    const workerUnreachable = !input.snapshot.worker.reachable;
    const workerSessionMissing =
      input.snapshot.worker.reachable === true && input.snapshot.worker.sessionExists === false;

    if (workerSessionMissing) {
      const outcome = {
        recovered: false,
        code: "OPENCODE_SESSION_MISSING" as const,
        intervention: true
      };
      this.emit("RECOVERY_FAILED", {
        reason: humanReason("OPENCODE_SESSION_MISSING"),
        details: { action: "intervention-required" }
      });
      outcomes.push(outcome);
    } else if (workerUnreachable) {
      const outcome = await this.recoverWorker();
      if (outcome) {
        outcomes.push(outcome);
      }
    }

    const plannerFailing = !input.snapshot.planner.reachable || plannerFailureState(input);
    if (plannerFailing && !workerStillBlocked(outcomes)) {
      const outcome = await this.recoverPlanner(input);
      if (outcome) {
        outcomes.push(outcome);
      }
    }

    if (input.state === "STUCK" && outcomes.length === 0) {
      const outcome = await this.verifyStuck(input);
      if (outcome) {
        outcomes.push(outcome);
      }
    }

    if (outcomes.length === 0) {
      return this.writeMetadata(input, {
        performed: false,
        recovered: false,
        action: "none",
        attemptCount: baseAttempt,
        intervention: false,
        cancelled: false
      });
    }

    const allRecovered = outcomes.every((outcome) => outcome.recovered);
    const firstFailure = outcomes.find((outcome) => !outcome.recovered);
    const intervention = outcomes.some((outcome) => outcome.intervention);

    const result: RecoveryRunResult = {
      performed: true,
      recovered: allRecovered,
      action,
      code: firstFailure?.code,
      reason: firstFailure ? humanReason(firstFailure.code ?? "RECOVERY_RETRY_EXHAUSTED") : undefined,
      attemptCount: attemptNumber,
      intervention,
      cancelled: false
    };

    return this.writeMetadata(input, result);
  }

  /**
   * v1.1 §2.2 / §8 / §10 — ask the dedicated Recovery Agent to look at the failure.
   * If the agent is unreachable, attempt a bounded, non-disruptive reconnection to the SAME
   * session (never replacement) before falling back to operator intervention.
   */
  private async escalateToAgent(
    text: string,
    details: Record<string, unknown>,
    action: string
  ): Promise<boolean> {
    const agentSessionId = this.deps.pair.masterWorkerSessionId?.trim();
    if (!agentSessionId) {
      this.emit("INTERVENTION_REQUIRED", {
        reason: `Recovery Agent is required for ${action} for pair ${this.deps.pair.pairId}, but masterWorkerSessionId is not configured. Operator intervention required.`,
        details: { ...details, action, agentUnavailable: true }
      });
      return false;
    }

    const agent = { ...this.deps.pair.worker, sessionId: agentSessionId };
    const message: RelayableMessage = {
      id: `${action}-${this.deps.pair.pairId}-${this.now().getTime()}`,
      source: "worker",
      role: "user",
      text,
      createdAt: this.now().getTime()
    };

    try {
      const receipt = await this.deps.worker.sendPlannerMessage(agent, message);
      if (receipt.delivered) {
        this.emit("ESCALATED_TO_AGENT", {
          reason: text.slice(0, 200),
          details: { ...details, action, targetId: receipt.targetId }
        });
        return true;
      }
      this.emit("RECOVERY_FAILED", {
        reason: `Recovery Agent message was not accepted for delivery (${action}).`,
        details: { ...details, action }
      });
      return false;
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      // v1.1 §10.5 — bounded, non-disruptive reconnection to the SAME agent session.
      if (await this.reconnectAgentSession(agentSessionId)) {
        try {
          const receipt = await this.deps.worker.sendPlannerMessage(agent, message);
          if (receipt.delivered) {
            this.emit("ESCALATED_TO_AGENT", {
              reason: text.slice(0, 200),
              details: { ...details, action, targetId: receipt.targetId, reconnected: true }
            });
            return true;
          }
        } catch {
          // fall through to the operator-intervention path below
        }
      }
      this.emit("INTERVENTION_REQUIRED", {
        reason: `Recovery Agent unavailable for pair ${this.deps.pair.pairId} (${action}): ${failure}. Bounded reconnection to the same agent session failed. Operator intervention required.`,
        details: { ...details, action, agentUnavailable: true }
      });
      return false;
    }
  }

  private async reconnectAgentSession(agentSessionId: string): Promise<boolean> {
    // v1.1 §10.5 — bounded attempts against the SAME session only; never replaced.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.deps.worker.checkServer();
        const session = await this.deps.worker.getSession(agentSessionId);
        if (session) {
          return true;
        }
      } catch {
        // bounded loop — keep trying
      }
    }
    return false;
  }

  private async recoverWorker(): Promise<
      { recovered: boolean; code?: RecoveryErrorCode; intervention: boolean } | undefined
  > {
    // Rule 5: retry once immediately; if unsuccessful, wait 10 minutes and retry;
    // if still unsuccessful, contact Recovery Agent.
    const masterStopLocation = this.deps.pair.masterWorkerSessionId;
    const outcome = await recoverOpenCode({
      worker: this.deps.worker,
      sessionId: this.deps.pair.worker.sessionId,
      expectedRepoPath: this.deps.pair.worker.repoPath,
      maxAttempts: 2,
      backoff: { delaysMs: [1_000, 600_000] },
      sleep: this.deps.sleep,
      signal: this.deps.signal,
      masterWorkerRepair: masterStopLocation
        ? async (error) =>
            this.escalateToAgent(
              `Recovery Agent repair request for pair ${this.deps.pair.pairId}: ${error.message}. Investigate the OpenCode worker and authorized model state. Do not start or kill OpenCode processes while other pairs may depend on them.`,
              { worker: this.deps.pair.worker.sessionId },
              "worker-repair"
            )
        : undefined,
      onRetry: (attempt, delayMs, error) => {
        this.emit("RECOVERY_RETRY", {
          reason: `OpenCode reconnect attempt ${attempt} retried in ${delayMs}ms: ${error.message}`,
          details: { attempt, delayMs }
        });
      },
      startServerLauncher: this.deps.startServerLauncher,
      baseUrl: this.deps.baseUrl ?? this.deps.pair.worker.server?.baseUrl ?? process.env.AGENT_OPENCODE_BASE_URL,
      verifyAllAffectedWorkersIdle: this.deps.verifyAllAffectedWorkersIdle,
      onRestartUnsafeHold: (reason) => {
        try {
          this.deps.store.touchPairState({ pairId: this.deps.pair.pairId, lastError: "AWAITING_OPERATOR_SHARED_RESTART_UNSAFE" });
        } catch {
          // best-effort marker for operator visibility
        }
        this.emit("INTERVENTION_REQUIRED", { reason });
      },
      terminateOpenCodeDesktop: this.deps.terminateOpenCodeDesktop,
      relaunchOpenCodeDesktop: this.deps.relaunchOpenCodeDesktop,
      relaunchSettleMs: this.deps.relaunchSettleMs,
      sharedRestartDeadlineMs: this.deps.sharedRestartDeadlineMs,
      pauseAffectedPairs: this.deps.pauseAffectedPairs,
      restoreAffectedPairs: this.deps.restoreAffectedPairs,
      onStartAttempt: () => this.emit("RECOVERY_RETRY", { reason: "Checking/starting the configured OpenCode server.", details: { action: "start-server" } }),
      onStartError: (error) => this.emit("RECOVERY_RETRY", { reason: `OpenCode server start failed: ${error.message}`, details: { action: "start-server" } })
    });

    if (outcome.recovered) {
      this.emit("RECOVERY_SUCCEEDED", {
        reason: "OpenCode endpoint reconnected and the configured session was verified.",
        details: { action: outcome.action }
      });
      this.emit("SESSION_RECONNECTED", { reason: "OpenCode session observation restored.", details: { action: outcome.action } });
      return { recovered: true, intervention: false };
    }

    const exhausted = outcome.code === "RECOVERY_RETRY_EXHAUSTED" || outcome.code === "OPENCODE_UNREACHABLE";
    this.emit(
      exhausted ? "RECOVERY_EXHAUSTED" : "RECOVERY_FAILED",
      {
        reason: outcome.reason,
        details: { code: outcome.code }
      }
    );
    return { recovered: false, code: outcome.code, intervention: outcome.code !== "OPENCODE_UNREACHABLE" };
  }

  private async recoverPlanner(input: AttemptInput): Promise<
    { recovered: boolean; code?: RecoveryErrorCode; intervention: boolean } | undefined
  > {
    if (input.snapshot.planner.authenticated === false) {
      const result = {
        recovered: false,
        code: "CHATGPT_AUTH_REQUIRED" as const,
        intervention: true
      };
      this.emit("RECOVERY_FAILED", { reason: humanReason("CHATGPT_AUTH_REQUIRED") });
      this.emit("INTERVENTION_REQUIRED", { reason: humanReason("CHATGPT_AUTH_REQUIRED") });
      return result;
    }

    const outcome = await recoverChatGPT({
      planner: this.deps.pair.planner,
      adapter: this.deps.planner,
      browser: this.deps.browser,
      sleep: this.deps.sleep,
      signal: this.deps.signal
    });

    if (outcome.recovered) {
      this.emit("RECOVERY_SUCCEEDED", {
        reason: "ChatGPT browser peer recovered.",
        details: { action: outcome.action }
      });
      if (outcome.action === "relaunch-browser") {
        this.emit("BROWSER_RELAUNCHED", { reason: "Managed browser was relaunched." });
      }
      this.emit("SESSION_RECONNECTED", { reason: "ChatGPT conversation observation restored.", details: { action: outcome.action } });
      return { recovered: true, intervention: false };
    }

    this.emit(
      outcome.code === "CHATGPT_CDP_UNREACHABLE" ? "RECOVERY_EXHAUSTED" : "RECOVERY_FAILED",
      { reason: outcome.reason, details: { code: outcome.code } }
    );

    // v1.1 §8.1 — if the Planner remains unavailable after refresh/reopen attempts, report to the Recovery Agent.
    await this.escalateToAgent(
      `Planner (ChatGPT) unrecoverable for pair ${this.deps.pair.pairId}: ${outcome.reason}. Inspect the Planner session state; do not kill or rebind sessions without operator approval.`,
      { code: outcome.code },
      "planner-investigation"
    );

    // Rule 11: an unrecoverable Planner always demands operator attention.
    this.emit("INTERVENTION_REQUIRED", { reason: outcome.reason });
    return { recovered: false, code: outcome.code, intervention: true };
  }

  private async verifyStuck(input: AttemptInput): Promise<
    { recovered: boolean; code?: RecoveryErrorCode; intervention: boolean } | undefined
  > {
    try {
      await this.deps.worker.checkServer();
      const session = await this.deps.worker.getSession(this.deps.pair.worker.sessionId);
      if (session === undefined) {
        this.emit("RECOVERY_FAILED", { reason: humanReason("OPENCODE_SESSION_MISSING") });
        return { recovered: false, code: "OPENCODE_SESSION_MISSING", intervention: true };
      }

      const refreshed = await this.deps.worker.observeWorkerSession?.(this.deps.pair.worker);
      const progressed = refreshed ? activityAdvanced(input.snapshot, refreshed) : false;
      if (progressed) {
        this.emit("RECOVERY_SUCCEEDED", {
          reason: "STUCK verification found resumed worker activity; the next observation will reclassify.",
          details: { action: "verify-only" }
        });
        return { recovered: true, intervention: false };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("RECOVERY_FAILED", { reason: `STUCK verification could not reach the OpenCode server: ${message}` });
      return { recovered: false, code: "OPENCODE_UNREACHABLE", intervention: false };
    }

    // v1.1 §8.4 — one hour without verifiable progress is escalated to the Recovery Agent.
    // Recovery never autonomously re-prompts the stuck Worker.
    const delivered = await this.escalateToAgent(
      `STUCK investigation request for pair ${this.deps.pair.pairId}: the Worker session ${this.deps.pair.worker.sessionId} shows no verifiable progress for at least one hour. Inspect the corresponding OpenCode session and model state, within the operator-approved model list. Do not restart, kill, or rebind the Worker; report findings to the operator.`,
      { worker: this.deps.pair.worker.sessionId },
      "stuck-investigation"
    );
    return { recovered: false, code: "STUCK_UNRESOLVED", intervention: !delivered };
  }

  private pendingAmbiguousRelay():
    | { id: number; direction: string; status: string }
    | undefined {
    for (const record of this.deps.store.listNondelivered()) {
      if (record.pairId !== this.deps.pair.pairId) {
        continue;
      }
      if (record.status === "DELIVERING") {
        return { id: record.id as number, direction: record.direction, status: record.status };
      }
    }
    return undefined;
  }

  /**
   * v1.1 §11.4 — stable, low-cardinality signature of a failure. Digits collapse to '#'
   * and the pair id is stripped so identical root causes match across runs.
   */
  private signatureFor(result: RecoveryRunResult, pairId: string): string {
    const code = result.code ?? (result.cancelled ? "CANCELLED" : "RECOVERY_FAILED");
    const reason = (result.reason ?? "")
      .toLowerCase()
      .replace(new RegExp(pairId.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<pair>")
      .replace(/\d{4,}/g, "#")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return `${code}|${reason}`;
  }

  private writeMetadata(input: AttemptInput, result: RecoveryRunResult): RecoveryRunResult {
    const attemptCount = result.performed ? (input.continuity.recoveryAttemptCount ?? 0) + 1 : input.continuity.recoveryAttemptCount ?? 0;
    const nowIso = this.now().toISOString();

    // v1.1 §11.3 — exhaustively tracked corrective attempts; exceeding the budget suspends automated recovery.
    const durationExceeded = input.continuity.lastRecoveryAttemptAt
      ? nowIso && (this.now().getTime() - Date.parse(input.continuity.lastRecoveryAttemptAt)) > RECOVERY_DURATION_LIMIT_MS
      : false;
    const budgetExhausted = result.performed && (attemptCount >= RECOVERY_CORRECTIVE_BUDGET || durationExceeded);

    // v1.1 §11.4 — repeated matching failures within the window suspend automated recovery.
    const failed = result.performed && !result.recovered;
    const signature = failed ? this.signatureFor(result, this.deps.pair.pairId) : undefined;
    const priorFirstAt = input.continuity.identicalFailureFirstAt ? Date.parse(input.continuity.identicalFailureFirstAt) : undefined;
    const signatureWindowValid = priorFirstAt !== undefined && Number.isFinite(priorFirstAt)
      ? this.now().getTime() - priorFirstAt <= RECOVERY_SIGNATURE_WINDOW_MS
      : false;
    const identicalCount = failed
      ? (signature !== undefined && input.continuity.lastFailureSignature === signature && signatureWindowValid
          ? (input.continuity.identicalFailureCount ?? 1) + 1
          : 1)
      : 0;
    const signatureExceeded = failed && identicalCount >= 2;
    const suspended = budgetExhausted || signatureExceeded;

    this.deps.store.touchSupervisorState({
      pairId: this.deps.pair.pairId,
      recoveryAttemptCount: attemptCount,
      lastRecoveryAttemptAt: result.performed ? nowIso : undefined,
      ...(failed ? {
        lastFailureSignature: signature,
        identicalFailureCount: identicalCount,
        identicalFailureFirstAt: identicalCount === 1 ? nowIso : (signatureWindowValid ? input.continuity.identicalFailureFirstAt : nowIso)
      } : { identicalFailureCount: 0 }),
      ...(suspended ? {
        recoverySuspended: true,
        recoverySuspendedAt: nowIso,
        lastRecoveryErrorCode: "RECOVERY_SUSPENDED" as RecoveryErrorCode,
        lastRecoveryError: signatureExceeded
          ? `Repeated matching failures (${identicalCount}x within ${Math.round(RECOVERY_SIGNATURE_WINDOW_MS / 60_000)} minutes); operator release required.`
          : `Corrective budget exhausted (${attemptCount}/${RECOVERY_CORRECTIVE_BUDGET}${durationExceeded ? ", duration limit reached" : ""}); operator release required.`,
        incidentDisposition: "awaiting_operator" as const
      } : result.recovered ? {
        incidentDisposition: "resolved" as const
      } : signature === undefined && result.performed ? {} : {})
    });

    if (suspended) {
      this.emit("RECOVERY_SUSPENDED", signatureExceeded
        ? {
            reason: `Recovery suspended for pair ${this.deps.pair.pairId} after ${identicalCount} identical matching failure(s) within ${Math.round(RECOVERY_SIGNATURE_WINDOW_MS / 60_000)} minutes. Only the operator may release the suspension.`,
            details: { action: "identical-failure-signature", signature, count: identicalCount, windowMs: RECOVERY_SIGNATURE_WINDOW_MS }
          }
        : {
            reason: `Recovery suspended for pair ${this.deps.pair.pairId} after ${attemptCount} corrective attempt(s)${durationExceeded ? " and the 10-minute recovery window" : ""}. Automated recovery will not run again until the operator releases the suspension.`,
            details: { action: "recovery-suspended", attemptCount, budget: RECOVERY_CORRECTIVE_BUDGET }
          });
    }

    if (result.recovered) {
      this.deps.store.touchSupervisorState({
        pairId: this.deps.pair.pairId,
        lastRecoverySuccessAt: nowIso
      });
      this.deps.store.clearSupervisorRecoveryError(this.deps.pair.pairId);
    }

    if (result.code && !result.recovered && result.performed) {
      this.deps.store.touchSupervisorState({
        pairId: this.deps.pair.pairId,
        lastRecoveryErrorCode: result.code,
        lastRecoveryError: result.reason
      });
    }

    return result;
  }

  private emit(
    type: Parameters<SupervisorLogger["write"]>[0]["type"],
    event: Omit<Parameters<SupervisorLogger["write"]>[0], "time" | "pairId" | "type">
  ): void {
    const supervisorEvent: SupervisorEvent = {
      time: this.now().toISOString(),
      pairId: this.deps.pair.pairId,
      type,
      ...event
    };
    this.logger?.write(supervisorEvent);
    this.deps.onEvent?.(supervisorEvent);
  }
}

function plannerFailureState(input: AttemptInput): boolean {
  const planner = input.snapshot.planner;
  return (
    planner.reachable === false ||
    planner.conversationReachable === false ||
    planner.composerAvailable === false ||
    planner.authenticated === false
  );
}

function workerStillBlocked(outcomes: Array<{ recovered: boolean }>): boolean {
  return outcomes.some((outcome) => outcome.recovered === false);
}

function activityAdvanced(before: ObservationSnapshot, after: MatchObservation): boolean {
  const beforeWorker = before.worker.latestMessageCreatedAt ?? before.worker.lastAssistantMessageCreatedAt ?? 0;
  const afterWorker = after.latestMessageCreatedAt ?? after.lastAssistantMessageCreatedAt ?? 0;
  return afterWorker > beforeWorker;
}

interface MatchObservation {
  latestMessageCreatedAt?: number;
  lastAssistantMessageCreatedAt?: number;
}

function peerDetailReason(snapshot: ObservationSnapshot): string {
  const worker = snapshot.worker.detail?.join("; ");
  const planner = snapshot.planner.detail?.join("; ");
  const parts = [
    worker ? `worker: ${worker}` : undefined,
    planner ? `planner: ${planner}` : undefined
  ].filter(isDefined);

  return parts.length > 0 ? `Peer disconnected: ${parts.join(" | ")}` : "Peer disconnected.";
}

function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}
