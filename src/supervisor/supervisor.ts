import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { OpenCodeSessionManager } from "../adapters/opencode/index.js";
import { RelayStore } from "../persistence/index.js";
import { relayPlannerToWorker, relayWorkerToPlanner, type RelayResult } from "../relay/index.js";
import { classifyWorkerMessage } from "../relay/message-classifier.js";
import { parseWorkerAttentionEnvelope } from "../application/attention-parser.js";
import { RecoveryEngine } from "../recovery/index.js";
import { ExternalBrowserManager, type BrowserManager } from "../recovery/index.js";
import type { BackoffPolicy } from "../recovery/schedule.js";
import type { OpenCodeServerLauncher } from "../recovery/opencode.js";
import { ChatGptSubmissionGate } from "../relay/chatgpt-gate.js";
import { interruptibleSleep } from "../util/async.js";
import type {
  ObservationSnapshot,
  PlannerObservation,
  RecoveryPolicy,
  RelayableMessage,
  SessionPair,
  SupervisorContinuity,
  SupervisorState,
  WorkerObservation
} from "../types.js";
import {
  classify,
  emptyCycleContext,
  type CycleContext
} from "./classifier.js";
import {
  type SupervisorEvent,
  type SupervisorEventType,
  type SupervisorLogger
} from "./events.js";
import {
  observePlannerConversation,
  observeWorkerSession
} from "./observation.js";
import { decideRelays, type SuperviseMode } from "./policy.js";

export const DEFAULT_POLL_INTERVAL_MS = 5_000;

export interface SupervisorRecoveryOptions {
  policy: RecoveryPolicy;
  browser?: BrowserManager;
  maxAttempts?: number;
  backoff?: BackoffPolicy;
  startServerLauncher?: OpenCodeServerLauncher;
  baseUrl?: string;
}

export interface SupervisorDeps {
  pair: SessionPair;
  worker: OpenCodeSessionManager;
  planner: ChatGPTBrowserAdapter;
  store: RelayStore;
  clock?: () => Date;
  logger?: SupervisorLogger;
  pollIntervalMs?: number;
  stuckAfterMs?: number;
  stabilityMs?: number;
  mode?: SuperviseMode;
  recovery?: SupervisorRecoveryOptions;
  onReport?: (report: SupervisorReport) => void;
  onEvent?: (event: SupervisorEvent) => void;
  chatgptGate?: ChatGptSubmissionGate;
  adapter?: import("../application/control-plane-adapter.js").ControlPlaneAdapter;
}

export interface SupervisorReport {
  pairId: string;
  state: SupervisorState;
  previousState?: SupervisorState;
  reason?: string;
  observedAt: string;
  paused: boolean;
  mode: SuperviseMode;
  /** True when the ChatGPT conversation was freshly observed this cycle. */
  plannerObserved?: boolean;
  relays: RelayResult[];
  cycle: CycleContext;
  snapshot: ObservationSnapshot;
  workerRelayStable: boolean;
  recovery?: {
    policy: RecoveryPolicy;
    eligible: boolean;
    recovered: boolean;
    performed: boolean;
    intervention: boolean;
    action: string;
    attemptCount: number;
  };
}

export class Supervisor {
  private readonly clock: () => Date;
  private readonly logger: SupervisorLogger | undefined;
  private readonly pollIntervalMs: number;
  private readonly stabilityMs: number;
  private readonly stuckAfterMs: number | undefined;
  private readonly mode: SuperviseMode;
  private readonly chatgptGate: ChatGptSubmissionGate | undefined;
  private lastPlannerObservation: PlannerObservation | undefined;
  private lastWorkerObservation: WorkerObservation | undefined;
  private recoveryEngine: RecoveryEngine | undefined;
  private abortController: AbortController | undefined;
  private externalSignal: AbortSignal | undefined;
  private running = false;

  constructor(private readonly deps: SupervisorDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.logger = deps.logger;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.stabilityMs = deps.stabilityMs ?? 2 * this.pollIntervalMs;
    this.stuckAfterMs = deps.stuckAfterMs;
    this.mode = deps.mode ?? "observe";
    this.chatgptGate = deps.chatgptGate ?? new ChatGptSubmissionGate({ now: () => this.clock().getTime() });
  }

  async observeOnce(): Promise<SupervisorReport> {
    const { pair, store, worker, planner } = this.deps;
    const now = () => this.clock();
    const observedAt = now().toISOString();
    const continuity = store.getSupervisorState(pair.pairId) ?? emptyContinuity(pair.pairId);

    if (continuity.paused) {
      if (continuity.lastSupervisorState !== "PAUSED") {
        this.emit({
          type: "STATE_CHANGED",
          previousState: continuity.lastSupervisorState,
          state: "PAUSED",
          reason: "Supervision is paused for this pair."
        });
        store.touchSupervisorState({
          pairId: pair.pairId,
          lastSupervisorState: "PAUSED",
          stateChangedAt: observedAt,
          lastObservedAt: observedAt,
          paused: true
        });
      }
      return {
        pairId: pair.pairId,
        state: "PAUSED",
        previousState: continuity.lastSupervisorState,
        reason: "Supervision is paused for this pair.",
        observedAt,
        paused: true,
        mode: this.mode,
        relays: [],
        cycle: emptyCycleContext(),
        workerRelayStable: false,
        snapshot: {
          pairId: pair.pairId,
          observedAt,
          worker: {
            reachable: false,
            sessionExists: false,
            sessionActive: false,
            gathering: false
          },
          planner: {
            reachable: false,
            authenticated: false,
            conversationReachable: false,
            composerAvailable: false,
            generating: false
          }
        }
      };
    }

    const workerObservation = await observeWorkerSession(pair, worker);
    const previousPlannerObservation = this.lastPlannerObservation;
    const plannerNeeded =
      this.mode === "observe" ||
      !workerObservation.gathering ||
      this.lastPlannerObservation === undefined ||
      hasBlockingPlannerHealth(this.lastPlannerObservation);
    let plannerObservation = this.lastPlannerObservation;
    let plannerObserved = false;
    if (plannerNeeded) {
      plannerObservation = await observePlannerConversation(pair, planner);
      this.lastPlannerObservation = plannerObservation;
      plannerObserved = true;
    }
    const snapshot: ObservationSnapshot = {
      pairId: pair.pairId,
      observedAt,
      worker: workerObservation,
      planner:
        plannerObservation ?? {
          reachable: false,
          authenticated: false,
          conversationReachable: false,
          composerAvailable: false,
          generating: false,
          detail: ["Planner has not been observed yet."]
        }
    };
    this.emitObservationDeltas(this.lastWorkerObservation, previousPlannerObservation, snapshot);
    this.lastWorkerObservation = workerObservation;
    // Establish a durable baseline from the first worker message we ever see for
    // this pair. Questions strictly older than this baseline are treated as
    // pre-existing historical questions and are never re-sent to the planner.
    if (
      continuity.baselineWorkerMessageCreatedAt === undefined &&
      workerObservation.lastAssistantMessageCreatedAt !== undefined
    ) {
      store.touchSupervisorState({
        pairId: pair.pairId,
        baselineWorkerMessageId: workerObservation.lastAssistantMessageId,
        baselineWorkerMessageCreatedAt: workerObservation.lastAssistantMessageCreatedAt
      });
    }
    // A disconnected worker must reach recovery, not fail the runtime in a second read.
    let attributedWorkerResponse: RelayableMessage | undefined;
    if (workerObservation.reachable && workerObservation.sessionExists && !workerObservation.gathering) {
      try {
        attributedWorkerResponse = await this.findAttributedWorkerResponse(observedAt);
      } catch (error) {
        // The endpoint can disappear between observation and response lookup.
        // Reclassify this tick for recovery; never stop the runtime or replay.
        Object.assign(workerObservation, { reachable: false, gathering: false,
          detail: [...(workerObservation.detail ?? []), `response: ${error instanceof Error ? error.message : String(error)}`] });
      }
    }
    // Observe explicit attention markers from the worker assistant message.
    if (attributedWorkerResponse) {
      const envelope = parseWorkerAttentionEnvelope(attributedWorkerResponse.text);
      if (envelope) {
        const existing = store.getAttentionItemBySource(pair.pairId, attributedWorkerResponse.id);
        if (!existing || existing.status === "resolved") {
          const itemId = store.createAttentionItem({
            pairId: pair.pairId,
            sourceMessageId: attributedWorkerResponse.id,
            kind: envelope.kind,
            blocking: envelope.blocking,
            status: envelope.blocking ? "open" : "open",
            summary: attributedWorkerResponse.text.length > 200 ? attributedWorkerResponse.text.slice(0, 200) + "..." : attributedWorkerResponse.text,
            question: envelope.kind === "question" || envelope.kind === "blocked" ? attributedWorkerResponse.text : undefined,
          });
          const createdItem = store.listAttentionItems(pair.pairId).find((i) => i.id === itemId);
          // Emit an event through the adapter/service layer so the remote SSE stream sees it.
          this.emit({
            type: envelope.blocking ? "WORKER_ATTENTION_OPENED" : "WORKER_ATTENTION_OPENED",
            reason: envelope.blocking
              ? `Worker requires planner/human input (${envelope.kind}, blocking=true).`
              : `Worker attention observed (${envelope.kind}, blocking=${envelope.blocking}).`,
            details: {
              attentionId: String(itemId),
              sourceMessageId: attributedWorkerResponse.id,
              kind: envelope.kind,
              blocking: envelope.blocking,
            }
          });
        }
      }
    }

    const cycle = buildCycle(store, pair.pairId, snapshot, continuity);
    const previousState = continuity.lastSupervisorState;
    const classification = classify({
      snapshot,
      cycle,
      continuity,
      options: this.stuckAfterMs === undefined ? {} : { stuckAfterMs: this.stuckAfterMs }
    });
    const state = classification.state;

    if (plannerObserved && workerObservation.reachable && workerObservation.sessionExists &&
        !workerObservation.detail?.length && !hasBlockingPlannerHealth(snapshot.planner) &&
        !snapshot.planner.detail?.length && !isRecoverableState(state)) {
      store.clearSupervisorRecoveryError(pair.pairId);
    }

    if (previousState !== state) {
      this.emit({
        type: "STATE_CHANGED",
        previousState,
        state,
        reason: classification.reason
      });
    }

    if (state === "STUCK" && previousState !== "STUCK") {
      this.emit({ type: "STUCK_DETECTED", state, reason: classification.reason });
    }

    const stability = cycle.workerResponseMessageId ? {
      stable: true,
      candidateWorkerMessageId: cycle.workerResponseMessageId,
      candidateWorkerFirstSeenAt: observedAt
    } : computeWorkerRelayStability({
      continuity,
      snapshot,
      nowIso: observedAt,
      stabilityMs: this.stabilityMs
    });

    store.touchSupervisorState({
      pairId: pair.pairId,
      lastSupervisorState: state,
      stateChangedAt: previousState !== state ? observedAt : continuity.stateChangedAt,
      lastObservedAt: observedAt,
      paused: continuity.paused,
      lastWorkerActivityAt: maxIso(continuity.lastWorkerActivityAt, workerActivityIso(snapshot)),
      lastPlannerActivityAt: maxIso(continuity.lastPlannerActivityAt, plannerActivityIso(snapshot)),
      candidateWorkerMessageId: stability.candidateWorkerMessageId,
      candidateWorkerMessageHash: stability.candidateWorkerMessageHash,
      candidateWorkerFirstSeenAt: stability.candidateWorkerFirstSeenAt
    });

    const relays: RelayResult[] = [];
    const decisions = decideRelays({
      mode: this.mode,
      state,
      cycle,
      snapshot,
      paused: false,
      workerRelayStable: stability.stable
    });

    if (decisions.relayWorkerToPlanner && (!cycle.workerResponseMessageId || attributedWorkerResponse)) {
      const gate = this.chatgptGate;
      const decision = gate?.decide(pair.pairId);
      if (decision && !decision.allowed) {
        const result: RelayResult = decision.rateLimited
          ? {
              pairId: pair.pairId,
              status: "RATE_LIMITED",
              direction: "worker-to-planner",
              reason: decision.reason ?? "ChatGPT is temporarily rate-limited; holding the worker report."
            }
          : {
              pairId: pair.pairId,
              status: "HELD",
              direction: "worker-to-planner",
              reason: decision.reason ?? "ChatGPT submission spacing not yet reached; holding the worker report."
            };
        relays.push(result);
        this.emitRelayEvent(result, "worker-to-planner");
      } else {
        const sourceMessage = attributedWorkerResponse ?? (await worker.getLatestAssistantMessage(pair.worker));
        if (sourceMessage) {
          const classification = classifyWorkerMessage(sourceMessage.text);
          const baseline = continuity.baselineWorkerMessageCreatedAt;
          const possiblyStaleQuestion =
            !attributedWorkerResponse &&
            classification === "question" &&
            baseline !== undefined &&
            sourceMessage.createdAt !== undefined &&
            sourceMessage.createdAt <= baseline;
          if (possiblyStaleQuestion) {
            const result: RelayResult = {
              pairId: pair.pairId,
              status: "HELD",
              direction: "worker-to-planner",
              sourceMessage,
              classification,
              reason:
                "Detected a worker question created before the supervision baseline; not relayed as historical."
            };
            relays.push(result);
            this.emitRelayEvent(result, "worker-to-planner");
          } else {
            const result = await relayWorkerToPlanner(pair, { worker, planner }, {
              persistence: { store },
              sourceMessage,
              classification
            });
            relays.push(result);
            this.emitRelayEvent(result, "worker-to-planner");
            if (result.status === "DELIVERED") {
              gate?.recordSuccess(pair.pairId);
              store.touchSupervisorState({
                pairId: pair.pairId,
                currentCycleWorkerMessageId: result.sourceMessage?.id,
                // Only checkpoint the pre-send observation. A reply can arrive
                // during submission and must remain pending for the next tick.
                lastPlannerSideSyncedMessageId: snapshot.planner.latestPlannerMessageId,
                lastWorkerActivityAt: observedAt,
                lastObservedAt: observedAt
              });
              const activeCycle = latestIncompleteCycle(store, pair.pairId);
              if (activeCycle && result.sourceMessage?.id === activeCycle.workerResponseMessageId) {
                store.updateCycle(pair.pairId, activeCycle.plannerSourceMessageId, {
                  plannerDeliveryRecordId: result.recordId,
                  cycleStatus: "DELIVERED"
                });
              }
            } else if (result.status === "FAILED" && gate?.isRateLimitedError(result.reason)) {
              gate.recordRateLimited(pair.pairId);
            }
          }
        }
      }
    }

    if (decisions.relayPlannerToWorker) {
      const result = await relayPlannerToWorker(pair, { worker, planner }, { persistence: { store } });
      relays.push(result);
      this.emitRelayEvent(result, "planner-to-worker");
      if (result.status === "DELIVERED") {
        const plannerSourceMessageId = result.sourceMessage?.id;
        const workerDispatchMessageId = result.receipt?.workerDispatchMessageId ?? result.receipt?.targetId;
        // Correlation: resolve attention items that were answered by this planner delivery.
        const openAttention = store.listAttentionItems(pair.pairId, "open");
        for (const item of openAttention) {
          if (item.sourceMessageId && item.question) {
            // When planner sends a message that answers an open worker question,
            // resolve the attention item after delivery is confirmed.
            store.updateAttentionStatus(item.id, "resolved", plannerSourceMessageId);
            this.emit({
              type: "WORKER_ATTENTION_RESOLVED",
              reason: `Worker attention resolved by planner response (${item.id}).`,
              details: {
                attentionId: item.id,
                sourceMessageId: item.sourceMessageId,
                plannerSourceMessageId,
                kind: item.kind,
              }
            });
          }
        }
        if (plannerSourceMessageId && workerDispatchMessageId && !store.getCycleByPlannerSource(pair.pairId, plannerSourceMessageId)) {
          store.createCycle({
            pairId: pair.pairId,
            plannerSourceMessageId,
            workerDispatchMessageId,
            dispatchedAt: observedAt
          });
        }
        store.touchSupervisorState({
          pairId: pair.pairId,
          currentCyclePlannerMessageId: result.sourceMessage?.id,
          lastPlannerSideSyncedMessageId: result.sourceMessage?.id,
          lastPlannerActivityAt: observedAt,
          lastObservedAt: observedAt
        });
      }
    }

    let finalState = state;
    let finalReason = classification.reason;
    if (relays.length > 0) {
      const refreshed = store.getSupervisorState(pair.pairId) ?? continuity;
      const refreshedCycle = buildCycle(store, pair.pairId, snapshot, refreshed);
      const reclassification = classify({
        snapshot,
        cycle: refreshedCycle,
        continuity: refreshed,
        options: this.stuckAfterMs === undefined ? {} : { stuckAfterMs: this.stuckAfterMs }
      });
      if (reclassification.state !== finalState) {
        finalState = reclassification.state;
        finalReason = reclassification.reason;
        this.emit({
          type: "STATE_CHANGED",
          previousState: state,
          state: finalState,
          reason: finalReason
        });
        store.touchSupervisorState({
          pairId: pair.pairId,
          lastSupervisorState: finalState,
          stateChangedAt: observedAt
        });
      }
    }

    let recovery;
    if (this.deps.recovery && !continuity.paused && isRecoverableState(state)) {
      const engine = this.ensureRecoveryEngine();
      const run = await engine.attempt({ state, snapshot, continuity, previousState });
      recovery = {
        policy: this.deps.recovery.policy,
        eligible: true,
        recovered: run.recovered,
        performed: run.performed,
        intervention: run.intervention,
        action: run.action,
        attemptCount: run.attemptCount
      };
    }

    return {
      pairId: pair.pairId,
      state: finalState,
      previousState,
      reason: finalReason,
      observedAt,
      paused: continuity.paused,
      mode: this.mode,
      plannerObserved,
      relays,
      cycle: buildCycle(store, pair.pairId, snapshot, store.getSupervisorState(pair.pairId) ?? continuity),
      workerRelayStable: stability.stable,
      snapshot,
      recovery
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.abortController = new AbortController();
    this.recoveryEngine = undefined;
    this.emit({ type: "WATCH_STARTED", reason: "Supervisor watch started." });

    while (this.running) {
      try {
        const report = await this.observeOnce();
        this.deps.onReport?.(report);
      } catch (error) {
        this.emit({
          type: "OBSERVATION_ERROR",
          reason: error instanceof Error ? error.message : String(error)
        });
      }

      if (!this.running) {
        break;
      }
      try {
        await interruptibleSleep(this.pollIntervalMs, this.abortController?.signal);
      } catch {
        // AbortError from sleep — loop will check this.running and exit
      }
    }

    this.emit({ type: "WATCH_STOPPED", reason: "Supervisor watch stopped." });
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  setAbortSignal(signal: AbortSignal): void {
    this.externalSignal = signal;
  }

  private async findAttributedWorkerResponse(observedAt: string): Promise<RelayableMessage | undefined> {
    const { pair, store, worker } = this.deps;
    const cycle = latestIncompleteCycle(store, pair.pairId);
    if (!cycle || !worker.getAssistantResponseForDispatch) {
      return undefined;
    }
    const failure = await worker.getDispatchFailure?.(
      pair.worker,
      cycle.workerDispatchMessageId,
      cycle.dispatchedAt
    );
    if (failure && cycle.cycleStatus === "DISPATCHED") {
      store.updateCycle(pair.pairId, cycle.plannerSourceMessageId, {
        workerCompletedAt: observedAt,
        cycleStatus: "FAILED"
      });
      this.emit({
        type: "RELAY_FAILED",
        reason: failure,
        details: { direction: "planner-to-worker", workerDispatchMessageId: cycle.workerDispatchMessageId }
      });
      return undefined;
    }
    const response = await worker.getAssistantResponseForDispatch(
      pair.worker,
      cycle.workerDispatchMessageId,
      cycle.dispatchedAt
    );
    if (response && cycle.cycleStatus === "DISPATCHED") {
      store.updateCycle(pair.pairId, cycle.plannerSourceMessageId, {
        workerResponseMessageId: response.id,
        workerCompletedAt: response.createdAt ? new Date(response.createdAt).toISOString() : observedAt,
        cycleStatus: "WORKER_RESPONDED"
      });
    }
    return response;
  }

  private ensureRecoveryEngine(): RecoveryEngine {
    if (this.recoveryEngine) {
      return this.recoveryEngine;
    }
    const recovery = this.deps.recovery;
    if (!recovery) {
      throw new Error("Recovery engine was requested but no recovery options were configured.");
    }
    this.recoveryEngine = new RecoveryEngine({
      pair: this.deps.pair,
      worker: this.deps.worker,
      planner: this.deps.planner,
      browser: recovery.browser ?? new ExternalBrowserManager(),
      store: this.deps.store,
      logger: this.logger,
      onEvent: (event) => this.deps.onEvent?.(event),
      now: this.clock,
      policy: recovery.policy,
      maxAttempts: recovery.maxAttempts,
      backoff: recovery.backoff,
      signal: this.abortController?.signal ?? this.externalSignal,
      startServerLauncher: recovery.startServerLauncher,
      baseUrl: recovery.baseUrl
    });
    return this.recoveryEngine;
  }

  private emitRelayEvent(result: RelayResult, direction: "worker-to-planner" | "planner-to-worker"): void {
    const type = relayEventType(result.status, direction);
    if (!type) {
      return;
    }
    this.emit({
      type,
      reason: result.reason,
      details: {
        direction,
        sourceMessageId: result.sourceMessage?.id,
        recordId: result.recordId
      }
    });
  }

  private emitObservationDeltas(
    previousWorker: WorkerObservation | undefined,
    previousPlanner: PlannerObservation | undefined,
    snapshot: ObservationSnapshot
  ): void {
    this.emitWorkerObservationDelta(previousWorker, snapshot.worker);
    this.emitPlannerObservationDelta(previousPlanner, snapshot.planner);
  }

  private emitWorkerObservationDelta(
    previous: WorkerObservation | undefined,
    current: WorkerObservation
  ): void {
    if (previous === undefined) {
      return;
    }
    if (current.reachable !== previous.reachable) {
      this.emit({
        type: current.reachable ? "WORKER_SESSION_CONNECTED" : "WORKER_SESSION_DISCONNECTED",
        reason: current.reachable
          ? "OpenCode session endpoint became reachable."
          : "OpenCode session endpoint is no longer reachable."
      });
    }
    if (
      current.lastAssistantMessageId !== undefined &&
      current.lastAssistantMessageId !== previous.lastAssistantMessageId
    ) {
      this.emit({
        type: "WORKER_MESSAGE_OBSERVED",
        reason: "A new assistant message was observed on the OpenCode session.",
        details: {
          messageId: current.lastAssistantMessageId,
          messageHash: current.lastAssistantMessageHash,
          createdAt: current.lastAssistantMessageCreatedAt
        }
      });
    }
  }

  private emitPlannerObservationDelta(
    previous: PlannerObservation | undefined,
    current: PlannerObservation
  ): void {
    if (previous === undefined) {
      return;
    }
    const connected = current.reachable && current.authenticated && current.conversationReachable;
    const wasConnected = previous.reachable && previous.authenticated && previous.conversationReachable;
    if (connected !== wasConnected) {
      this.emit({
        type: connected ? "PLANNER_SESSION_CONNECTED" : "PLANNER_SESSION_DISCONNECTED",
        reason: connected
          ? "ChatGPT conversation became reachable."
          : "ChatGPT conversation is no longer reachable."
      });
    }
    if (current.latestPlannerMessageId !== undefined && current.latestPlannerMessageId !== previous.latestPlannerMessageId) {
      this.emit({
        type: "PLANNER_MESSAGE_OBSERVED",
        reason: "A new message was observed on the ChatGPT conversation.",
        details: {
          messageId: current.latestPlannerMessageId,
          createdAt: current.latestPlannerMessageCreatedAt
        }
      });
    }
    if (current.generating !== previous.generating) {
      this.emit({
        type: current.generating ? "PLANNER_GENERATING" : "PLANNER_IDLE",
        reason: current.generating
          ? "ChatGPT started generating a new response."
          : "ChatGPT stopped generating."
      });
    }
  }

  private emit(event: Omit<SupervisorEvent, "time" | "pairId">): void {
    const supervisorEvent: SupervisorEvent = {
      time: this.clock().toISOString(),
      pairId: this.deps.pair.pairId,
      ...event
    };
    this.logger?.write(supervisorEvent);
    this.deps.onEvent?.(supervisorEvent);
  }
}

function relayEventType(
  status: RelayResult["status"],
  direction: "worker-to-planner" | "planner-to-worker"
): SupervisorEventType | undefined {
  if (status === "DELIVERED") {
    return direction === "worker-to-planner" ? "WORKER_MESSAGE_RELAYED" : "PLANNER_MESSAGE_RELAYED";
  }
  if (status === "SKIPPED_DUPLICATE") {
    return "DUPLICATE_SKIPPED";
  }
  if (status === "AMBIGUOUS") {
    return "AMBIGUOUS_DELIVERY";
  }
  if (status === "RATE_LIMITED") {
    return "CHATGPT_RATE_LIMITED";
  }
  if (status === "HELD") {
    return "CHATGPT_SUBMISSION_HELD";
  }
  if (status === "FAILED") {
    return "RELAY_FAILED";
  }
  if (status === "NOT_READY") {
    return "RELAY_BLOCKED";
  }
  return undefined;
}

export function buildCycle(
  store: RelayStore,
  pairId: string,
  snapshot: ObservationSnapshot,
  continuity: SupervisorContinuity
): CycleContext {
  const lastWorkerRelay = store.latestRecord(pairId, "worker-to-planner");
  const lastPlannerRelay = store.latestRecord(pairId, "planner-to-worker");
  const lastWorkerDelivered = lastWorkerRelay?.status === "DELIVERED" ? lastWorkerRelay : undefined;
  const lastPlannerDelivered = lastPlannerRelay?.status === "DELIVERED" ? lastPlannerRelay : undefined;
  const relayCycles = store.listCycles(pairId);
  const durableCycle = relayCycles.at(-1);

  const workerReportPending = durableCycle
    ? durableCycle.cycleStatus === "WORKER_RESPONDED"
    : Boolean(snapshot.worker.lastAssistantMessageId) &&
      lastWorkerDelivered?.sourceMessageId !== snapshot.worker.lastAssistantMessageId;

  const plannerInstructionPending = Boolean(
    snapshot.planner.latestPlannerMessageId &&
      snapshot.planner.latestPlannerMessageId !== continuity.lastPlannerSideSyncedMessageId
  );

  return {
    ambiguousDelivery: store.listRecords(pairId).some((record) => record.status === "DELIVERING"),
    currentCyclePlannerMessageId: durableCycle?.plannerSourceMessageId ?? lastPlannerDelivered?.sourceMessageId,
    workerResponseMessageId: durableCycle?.workerResponseMessageId,
    workerFailed: durableCycle?.cycleStatus === "FAILED",
    workerReportPending,
    plannerInstructionPending,
    lastWorkerRelaySourceMessageId: lastWorkerDelivered?.sourceMessageId,
    lastWorkerRelayAt: lastWorkerDelivered?.deliveredAt,
    lastPlannerRelaySourceMessageId: lastPlannerDelivered?.sourceMessageId,
    lastPlannerRelayAt: lastPlannerDelivered?.deliveredAt
  };
}

function latestIncompleteCycle(store: RelayStore, pairId: string) {
  return [...store.listCycles(pairId)].reverse().find((cycle) =>
    cycle.cycleStatus === "DISPATCHED" || cycle.cycleStatus === "WORKER_RESPONDED"
  );
}

export interface WorkerRelayStability {
  stable: boolean;
  candidateWorkerMessageId?: string;
  candidateWorkerMessageHash?: string;
  candidateWorkerFirstSeenAt?: string;
}

export function computeWorkerRelayStability(input: {
  continuity: SupervisorContinuity;
  snapshot: ObservationSnapshot;
  nowIso: string;
  stabilityMs: number;
}): WorkerRelayStability {
  const candidateId = input.snapshot.worker.lastAssistantMessageId;
  const candidateHash = input.snapshot.worker.lastAssistantMessageHash;
  if (!candidateId) {
    return { stable: false };
  }

  const nowMs = Date.parse(input.nowIso);
  const prevId = input.continuity.candidateWorkerMessageId;
  const prevHash = input.continuity.candidateWorkerMessageHash;
  const prevSeenAt = input.continuity.candidateWorkerFirstSeenAt;

  if (prevId !== candidateId) {
    return {
      stable: input.stabilityMs <= 0,
      candidateWorkerMessageId: candidateId,
      candidateWorkerMessageHash: candidateHash,
      candidateWorkerFirstSeenAt: input.nowIso
    };
  }

  if (prevHash !== candidateHash) {
    return {
      stable: input.stabilityMs <= 0,
      candidateWorkerMessageId: candidateId,
      candidateWorkerMessageHash: candidateHash,
      candidateWorkerFirstSeenAt: input.nowIso
    };
  }

  const firstSeenMs = prevSeenAt ? Date.parse(prevSeenAt) : nowMs;
  return {
    stable: nowMs - firstSeenMs >= input.stabilityMs,
    candidateWorkerMessageId: candidateId,
    candidateWorkerMessageHash: candidateHash,
    candidateWorkerFirstSeenAt: prevSeenAt ?? input.nowIso
  };
}

function workerActivityIso(snapshot: ObservationSnapshot): string | undefined {
  const timestamp =
    snapshot.worker.latestMessageCreatedAt ?? snapshot.worker.lastAssistantMessageCreatedAt;
  return timestamp === undefined ? undefined : new Date(timestamp).toISOString();
}

function plannerActivityIso(snapshot: ObservationSnapshot): string | undefined {
  const timestamp = snapshot.planner.latestPlannerMessageCreatedAt;
  return timestamp === undefined ? undefined : new Date(timestamp).toISOString();
}

function maxIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function emptyContinuity(pairId: string): SupervisorContinuity {
  return {
    pairId,
    paused: false
  };
}

function isRecoverableState(state: SupervisorState): boolean {
  return state === "DISCONNECTED" || state === "FAILED" || state === "STUCK";
}

function hasBlockingPlannerHealth(observation: PlannerObservation): boolean {
  return (
    !observation.reachable ||
    !observation.authenticated ||
    !observation.conversationReachable ||
    !observation.composerAvailable
  );
}
