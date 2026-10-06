import { type ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import { type OpenCodeSessionManager } from "../adapters/opencode/index.js";
import type {
  ObservationSnapshot,
  RecoveryErrorCode,
  SupervisorContinuity,
  SupervisorState
} from "../types.js";
import type { RelayStore } from "../persistence/index.js";
import { type SupervisorEvent, type SupervisorLogger } from "../supervisor/events.js";
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

  private async recoverWorker(): Promise<
      { recovered: boolean; code?: RecoveryErrorCode; intervention: boolean } | undefined
  > {
    const outcome = await recoverOpenCode({
      worker: this.deps.worker,
      sessionId: this.deps.pair.worker.sessionId,
      expectedRepoPath: this.deps.pair.worker.repoPath,
      maxAttempts: this.deps.maxAttempts,
      backoff: this.deps.backoff,
      sleep: this.deps.sleep,
      signal: this.deps.signal,
      onRetry: (attempt, delayMs, error) => {
        this.emit("RECOVERY_RETRY", {
          reason: `OpenCode reconnect attempt ${attempt} retried in ${delayMs}ms: ${error.message}`,
          details: { attempt, delayMs }
        });
      },
      startServerLauncher: this.deps.startServerLauncher,
      baseUrl: this.deps.baseUrl ?? this.deps.pair.worker.server?.baseUrl ?? process.env.AGENT_RELAY_OPENCODE_BASE_URL,
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
    if (outcome.intervention) {
      this.emit("INTERVENTION_REQUIRED", { reason: outcome.reason });
    }
    return { recovered: false, code: outcome.code, intervention: outcome.intervention };
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

    // The worker is healthy, but the already-delivered instruction has not
    // started.  A verify-only recovery leaves the pair permanently stuck:
    // the runtime has no way to make an idle OpenCode session re-enter its
    // work loop.  Send one uniquely identified, bounded continuation nudge.
    // This is safe here because ambiguous/in-flight relay records were
    // rejected above, and the nudge does not replay the original task.
    const nudge: RelayableMessage = {
      id: `recovery-nudge-${this.deps.pair.pairId}-${this.now().getTime()}`,
      source: "planner",
      role: "user",
      text: "Recovery check: inspect the current task state and continue the existing work. Report the next concrete step when done.",
      createdAt: this.now().getTime()
    };

    try {
      const receipt = await this.deps.worker.sendPlannerMessage(this.deps.pair.worker, nudge);
      if (receipt.delivered) {
        this.emit("RECOVERY_RETRY", {
          reason: "STUCK verification found no progress; sent one bounded continuation nudge to the healthy worker.",
          details: { action: "continue-worker", targetId: receipt.targetId }
        });
        return { recovered: false, intervention: false };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("RECOVERY_FAILED", {
        reason: `Continuation nudge failed: ${message}`,
        details: { action: "continue-worker" }
      });
    }

    this.emit("INTERVENTION_REQUIRED", {
      reason: "STUCK verification found no progress and the bounded continuation nudge was not accepted."
    });
    return { recovered: false, code: "STUCK_UNRESOLVED", intervention: true };
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

  private writeMetadata(input: AttemptInput, result: RecoveryRunResult): RecoveryRunResult {
    const attemptCount = result.performed ? (input.continuity.recoveryAttemptCount ?? 0) + 1 : input.continuity.recoveryAttemptCount ?? 0;
    const nowIso = this.now().toISOString();

    this.deps.store.touchSupervisorState({
      pairId: this.deps.pair.pairId,
      recoveryAttemptCount: attemptCount,
      lastRecoveryAttemptAt: result.performed ? nowIso : undefined
    });

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
