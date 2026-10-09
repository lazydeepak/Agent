/**
 * Agent-relay codebase — module explanation / info.
 * File: src/runtime/pair-runtime.ts
 * Purpose: Per-pair concurrent runtime supervisor.
 */
import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { OpenCodeEventSource, OpenCodeSessionManager } from "../adapters/opencode/index.js";
import type { RelayStore } from "../persistence/index.js";
import { Supervisor, type SupervisorRecoveryOptions, type SupervisorReport } from "../supervisor/supervisor.js";
import { type RuntimeEvent, type SupervisorEvent, type SupervisorLogger } from "../supervisor/events.js";
import { isTerminalFailure } from "../supervisor/state.js";
import type { SuperviseMode } from "../supervisor/policy.js";
import { FifoMutex, interruptibleSleep, type SleepFn } from "./scheduler.js";
import { WakeBus } from "./wake-bus.js";
import type {
  PairRuntimeState,
  PeerActivity,
  PeerFailureReason,
  PeerHealth,
  RuntimeMetadata,
  RuntimePairStatus,
  SessionPair,
  SchedulerMode,
  SupervisorContinuity,
  SupervisorState
} from "../types.js";

export interface PairRuntimeOptions {
  pair: SessionPair;
  store: RelayStore;
  worker: OpenCodeSessionManager;
  planner: ChatGPTBrowserAdapter;
  logger?: SupervisorLogger;
  clock?: () => Date;
  pollIntervalMs?: number;
  stuckAfterMs?: number;
  stabilityMs?: number;
  mode?: SuperviseMode;
  recovery?: SupervisorRecoveryOptions;
  sleep?: SleepFn;
  wakeBus?: WakeBus;
  workerEvents?: OpenCodeEventSource;
  eventCoalesceMs?: number;
  dormantAfterMs?: number;
  dormantPollIntervalMs?: number;
  onReport?: (report: SupervisorReport) => void;
  onEvent?: (event: RuntimeEvent | SupervisorEvent) => void;
}

export interface PairRuntimeStatusSet {
  status: RuntimePairStatus;
  metadata: {
    lastRuntimeStartAt?: string;
    lastRuntimeStopAt?: string;
    lastRuntimeError?: string;
  };
}

export class PairRuntime {
  private readonly store: RelayStore;
  private readonly logger: SupervisorLogger | undefined;
  private readonly clock: () => Date;
  private readonly pollIntervalMs: number;
  private readonly sleep: SleepFn;
  private readonly wakeBus: WakeBus;
  private readonly observationLock = new FifoMutex();
  private readonly eventCoalesceMs: number;
  private readonly dormantAfterMs: number;
  private readonly dormantPollIntervalMs: number;

  private supervisor: Supervisor | undefined;
  private abortController = new AbortController();
  private loopTask: Promise<void> = Promise.resolve();
  private eventTask: Promise<void> = Promise.resolve();
  private plannerEventTask: Promise<void> = Promise.resolve();
  private lastReport: SupervisorReport | undefined;
  private lastError: string | undefined;
  private phase: PairRuntimeState = "STOPPED";
  private firstObservation: Promise<void> = Promise.resolve();
  private resolveFirstObservation?: () => void;
  private wakeVersion = 0;
  private wakeWaiter?: () => void;
  private unsubscribeWake?: () => void;
  private pendingWorkerEvent?: {
    type: string;
    observedAt: string;
    seq?: number;
    messageId?: string;
  };
  private _stopEmitted = false;
  private eventCoalesceTimer?: ReturnType<typeof setTimeout>;
  private schedulerMode: SchedulerMode = "ACTIVE";
  private idleSinceMs?: number;

  constructor(private readonly options: PairRuntimeOptions) {
    this.store = options.store;
    this.logger = options.logger;
    this.clock = options.clock ?? (() => new Date());
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.sleep = options.sleep ?? interruptibleSleep;
    this.wakeBus = options.wakeBus ?? new WakeBus();
    this.eventCoalesceMs = options.eventCoalesceMs ?? 25;
    this.dormantAfterMs = options.dormantAfterMs ?? 30 * 60_000;
    this.dormantPollIntervalMs = options.dormantPollIntervalMs ?? 5 * 60_000;
  }

  get pairId(): string {
    return this.options.pair.pairId;
  }

  get state(): PairRuntimeState {
    return this.phase;
  }

  get lastReportSnapshot() {
    return this.lastReport;
  }

  get latestError(): string | undefined {
    return this.lastError;
  }

  async start(): Promise<void> {
    if (this.phase === "RUNNING" || this.phase === "STARTING" || this.phase === "STOPPING") {
      return;
    }

    this.lastError = undefined;
    this.lastReport = undefined;
    this.abortController = new AbortController();
    this.options.worker.setAbortSignal?.(this.abortController.signal);
    this.firstObservation = new Promise<void>((resolve) => {
      this.resolveFirstObservation = resolve;
    });
    const startedAt = this.clock().toISOString();

    this.phase = "STARTING";
    this.emit("PAIR_RUNTIME_STARTED", this.pairId, { reason: "Pair runtime loop started.", details: { startedAt } });
    this.store.touchRuntimeState({
      pairId: this.pairId,
      runtimeEnabled: true,
      lastRuntimeStartAt: startedAt,
      lastRuntimeError: undefined
    });
    this.setSchedulerMode("ACTIVE");

    this.supervisor = new Supervisor({
      pair: this.options.pair,
      worker: this.options.worker,
      planner: this.options.planner,
      store: this.store,
      clock: this.clock,
      logger: this.logger,
      pollIntervalMs: this.pollIntervalMs,
      stuckAfterMs: this.options.stuckAfterMs,
      stabilityMs: this.options.stabilityMs,
      mode: this.options.mode,
      recovery: this.options.recovery,
      onEvent: (event) => this.options.onEvent?.(event)
    });
    this.supervisor.setAbortSignal(this.abortController.signal);

    this.unsubscribeWake = this.wakeBus.subscribe(this.pairId, (signal) => {
      if (signal.source === "chatgpt" && this.schedulerMode === "DORMANT_WATCH") {
        this.setSchedulerMode("ACTIVE");
      }
      if (this.schedulerMode === "ACTIVE" || signal.source === "chatgpt") {
        this.signalWake();
      }
    });
    this.eventTask = this.consumeWorkerEvents();
    this.plannerEventTask = this.consumePlannerEvents();
    this.loopTask = this.runLoop();
    await this.whenRunning();
  }

  async stop(): Promise<void> {
    this.phase = "STOPPING";
    this.abortController.abort();
    if (this.eventCoalesceTimer) {
      clearTimeout(this.eventCoalesceTimer);
      this.eventCoalesceTimer = undefined;
      this.pendingWorkerEvent = undefined;
    }
    this.signalWake();
    this.supervisor?.stop();
    await Promise.all([this.loopTask, this.eventTask, this.plannerEventTask]);
    this.unsubscribeWake?.();
    this.unsubscribeWake = undefined;
    this.phase = "STOPPED";
    const stoppedAt = this.clock().toISOString();
    const alreadyStopped = this.store.getRuntimeState(this.pairId)?.runtimeEnabled === false;
    if (!alreadyStopped) {
      this.store.touchRuntimeState({
        pairId: this.pairId,
        runtimeEnabled: false,
        lastRuntimeStopAt: stoppedAt
      });
    }
    if (!this._stopEmitted) {
      this._stopEmitted = true;
      this.emit("PAIR_RUNTIME_STOPPED", this.pairId, {
        reason: "Pair runtime loop stopped.",
        details: { stoppedAt }
      });
    }
  }

  pause(): void {
    this.store.touchSupervisorState({ pairId: this.pairId, paused: true });
  }

  resume(): void {
    this.store.touchSupervisorState({ pairId: this.pairId, paused: false });
    this.signalWake();
  }

  async observeOnce(): Promise<SupervisorReport | undefined> {
    if (!this.supervisor || this.phase === "STOPPED" || this.phase === "STOPPING") {
      return undefined;
    }
    return this.reconcileOnce();
  }

  status(): RuntimePairStatus {
    let continuity: SupervisorContinuity | undefined;
    let metadata: RuntimeMetadata | undefined;
    try {
      continuity = this.store.getSupervisorState(this.pairId);
    } catch {
      continuity = undefined;
    }
    try {
      metadata = this.store.getRuntimeState(this.pairId);
    } catch {
      metadata = undefined;
    }
    const snapshot = this.lastReport?.snapshot;

    let worker: PeerHealth = "unknown";
    let planner: PeerHealth = "unknown";
    let workerActivity: PeerActivity | undefined;
    let plannerActivity: PeerActivity | undefined;
    let workerFailureReason: PeerFailureReason | undefined;
    let plannerFailureReason: PeerFailureReason | undefined;
    let workerObserved = false;
    let plannerObserved = false;
    if (snapshot) {
      workerObserved = snapshot.worker.reachable || (snapshot.worker.detail?.length ?? 0) > 0;
      plannerObserved =
        Array.isArray(snapshot.planner.detail) && snapshot.planner.detail.length > 0
          ? true
          : snapshot.planner.reachable || snapshot.planner.conversationReachable;
      const workerResult = workerHealth(snapshot.worker);
      worker = workerResult.health;
      workerActivity = workerResult.activity;
      workerFailureReason = workerResult.failureReason;
      const plannerResult = plannerHealth(snapshot.planner);
      planner = plannerResult.health;
      plannerActivity = plannerResult.activity;
      plannerFailureReason = plannerResult.failureReason;
    }

    const supervisorState = continuity?.lastSupervisorState ?? this.lastReport?.state;
    const recovering = isRecovering(supervisorState, this.lastReport);

    return {
      pairId: this.pairId,
      runtimeState: this.phase,
      supervisorState,
      worker,
      planner,
      workerActivity,
      plannerActivity,
      workerFailureReason,
      plannerFailureReason,
      recovering,
      workerObserved,
      plannerObserved,
      lastObservedAt: continuity?.lastObservedAt ?? this.lastReport?.observedAt,
      paused: continuity?.paused ?? false,
      lastError: this.lastError ?? metadata?.lastRuntimeError ?? continuity?.lastRecoveryError,
      enabled: this.options.pair.enabled,
      schedulerMode: metadata?.schedulerMode ?? this.schedulerMode
    };
  }

  private async runLoop(): Promise<void> {
    try {
      while (this.wantsLoop()) {
        const wakeVersionBeforeObservation = this.wakeVersion;
        let report: SupervisorReport;
        try {
          report = await this.reconcileOnce();
      } catch (error) {
        this.fail(error, "RUNTIME_OBSERVATION_ERROR");
        return;
      }
      this.updateSchedulerMode(report);

      if (this.phase === "STARTING") {
        this.phase = "RUNNING";
        this.resolveFirstObservation?.();
      }
        if (!this.wantsLoop()) {
          break;
        }
        if (await this.stopRequestedExternally()) {
          break;
        }
        if (this.wakeVersion !== wakeVersionBeforeObservation) {
          continue;
        }
        try {
          await this.waitForWakeOrPoll(this.wakeVersion);
        } catch {
          break;
        }
      }
    } finally {
      if (this.phase === "STARTING") {
        this.phase = "STOPPED";
      }
      this.resolveFirstObservation?.();
    }
  }

  private async reconcileOnce(): Promise<SupervisorReport> {
    return this.observationLock.run(async () => {
      const report = await this.supervisor!.observeOnce();
      this.dispatchReport(report);
      return report;
    });
  }

  private async consumeWorkerEvents(): Promise<void> {
    const source = this.options.workerEvents;
    if (!source) {
      return;
    }

    try {
      for await (const event of source.subscribe(
        this.options.pair.worker.sessionId,
        this.abortController.signal
      )) {
        this.queueWorkerWake(event);
      }
    } catch (error) {
      if (!this.abortController.signal.aborted) {
        this.emit("EVENT_SOURCE_DEGRADED", this.pairId, {
          reason: "OpenCode event source disconnected; polling fallback remains active.",
          details: { source: "opencode", error: messageOf(error) }
        });
      }
    }
  }

  private async consumePlannerEvents(): Promise<void> {
    const subscribe = this.options.planner.subscribePlannerEvents;
    if (!subscribe) return;
    try {
      for await (const event of subscribe.call(
        this.options.planner,
        this.options.pair.planner,
        this.abortController.signal
      )) {
        this.wakeBus.emit({
          pairId: this.pairId,
          source: "chatgpt",
          reason: event.type,
          observedAt: event.observedAt,
          messageId: event.messageId
        });
      }
    } catch (error) {
      if (!this.abortController.signal.aborted) {
        this.emit("EVENT_SOURCE_DEGRADED", this.pairId, {
          reason: "ChatGPT page observer disconnected; dormant polling fallback remains active.",
          details: { source: "chatgpt", error: messageOf(error) }
        });
      }
    }
  }

  private queueWorkerWake(event: {
    type: string;
    observedAt: string;
    seq?: number;
    messageId?: string;
  }): void {
    this.pendingWorkerEvent = event;
    if (this.eventCoalesceTimer) {
      return;
    }

    this.eventCoalesceTimer = setTimeout(() => {
      this.eventCoalesceTimer = undefined;
      const latest = this.pendingWorkerEvent;
      this.pendingWorkerEvent = undefined;
      if (!latest || this.abortController.signal.aborted) {
        return;
      }
      this.wakeBus.emit({
        pairId: this.pairId,
        source: "opencode",
        reason: latest.type,
        observedAt: latest.observedAt,
        seq: latest.seq,
        messageId: latest.messageId
      });
    }, this.eventCoalesceMs);
  }

  private signalWake(): void {
    this.wakeVersion += 1;
    this.wakeWaiter?.();
  }

  private async waitForWakeOrPoll(expectedWakeVersion: number): Promise<void> {
    if (this.wakeVersion !== expectedWakeVersion || this.abortController.signal.aborted) {
      return;
    }

    let resolveWake: () => void = () => undefined;
    const wake = new Promise<void>((resolve) => {
      resolveWake = resolve;
      this.wakeWaiter = resolve;
    });
    if (this.wakeVersion !== expectedWakeVersion || this.abortController.signal.aborted) {
      resolveWake();
    }

    try {
      await Promise.race([
        wake,
        this.sleep(
          this.schedulerMode === "DORMANT_WATCH" ? this.dormantPollIntervalMs : this.pollIntervalMs,
          this.abortController.signal
        ).catch(() => undefined)
      ]);
    } finally {
      if (this.wakeWaiter === resolveWake) {
        this.wakeWaiter = undefined;
      }
    }
  }

  private wantsLoop(): boolean {
    return this.phase !== "STOPPED" && this.phase !== "STOPPING";
  }

  private async stopRequestedExternally(): Promise<boolean> {
    try {
      const metadata = this.store.getRuntimeState(this.pairId);
      if (metadata?.runtimeEnabled === false) {
        this.phase = "STOPPED";
        this._stopEmitted = true;
        const stoppedAt = this.clock().toISOString();
        this.store.touchRuntimeState({ pairId: this.pairId, lastRuntimeStopAt: stoppedAt });
        this.emit("PAIR_RUNTIME_STOPPED", this.pairId, { reason: "Pair runtime stop was requested." });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private whenRunning(): Promise<void> {
    if (this.phase === "RUNNING") {
      return Promise.resolve();
    }
    if (this.phase === "ERROR" || this.phase === "STOPPED") {
      return Promise.reject(new Error(this.lastError ?? "Pair runtime is not running."));
    }
    return this.firstObservation.then(() => {
      if (this.phase === "ERROR") {
        throw new Error(this.lastError ?? "Pair runtime failed to start.");
      }
    });
  }

  private onTick(report: SupervisorReport, previousReport: SupervisorReport | undefined): void {
    if (
      this.phase === "RUNNING" &&
      previousReport &&
      isTerminalFailure(previousReport.state) &&
      !isTerminalFailure(report.state)
    ) {
      this.emit("PAIR_RUNTIME_RECOVERED", this.pairId, {
        reason: `Pair supervisor left ${previousReport.state} and is now ${report.state}.`
      });
    }
    this.options.onReport?.(report);
  }

  private dispatchReport(report: SupervisorReport): void {
    const previousReport = this.lastReport;
    this.lastReport = report;
    this.onTick(report, previousReport);
  }

  private fail(error: unknown, errorCode: string): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    this.phase = "ERROR";
    this.abortController.abort();
    if (this.eventCoalesceTimer) {
      clearTimeout(this.eventCoalesceTimer);
      this.eventCoalesceTimer = undefined;
      this.pendingWorkerEvent = undefined;
    }
    this.signalWake();
    this.supervisor?.stop();
    const failedAt = this.clock().toISOString();
    this.store.touchRuntimeState({
      pairId: this.pairId,
      runtimeEnabled: false,
      lastRuntimeError: message
    });
    this.emit("PAIR_RUNTIME_FAILED", this.pairId, {
      reason: message,
      details: { errorCode, failedAt, message }
    });
    this.resolveFirstObservation?.();
  }

  private updateSchedulerMode(report: SupervisorReport): void {
    if (report.state === "IDLE") {
      this.idleSinceMs ??= Date.parse(report.observedAt);
      if (Date.parse(report.observedAt) - this.idleSinceMs >= this.dormantAfterMs) {
        this.setSchedulerMode("DORMANT_WATCH", "extended-idle");
      }
      return;
    }
    this.idleSinceMs = undefined;
    const recoveryExhausted =
      report.state === "STUCK" &&
      (!report.recovery ||
        report.recovery.intervention ||
        report.recovery.attemptCount >= (this.options.recovery?.maxAttempts ?? 3));
    if (recoveryExhausted || (report.state === "FAILED" && report.snapshot.planner.reachable)) {
      this.setSchedulerMode("DORMANT_WATCH", report.state.toLowerCase());
    }
  }

  private setSchedulerMode(mode: SchedulerMode, reason?: string): void {
    if (this.schedulerMode === mode && this.store.getRuntimeState(this.pairId)?.schedulerMode === mode) return;
    const previousMode = this.schedulerMode;
    this.schedulerMode = mode;
    this.store.touchSchedulerMode({
      pairId: this.pairId,
      schedulerMode: mode,
      changedAt: this.clock().toISOString(),
      dormantReason: reason
    });
    this.emit("SCHEDULER_MODE_CHANGED", this.pairId, {
      reason: mode === "DORMANT_WATCH" ? `Pair is armed in dormant watch (${reason ?? "idle"}).` : "Pair resumed active supervision.",
      details: { previousMode, schedulerMode: mode, dormantReason: reason }
    });
  }

  private emit(
    type: RuntimeEvent["type"],
    pairId: string | undefined,
    event: Omit<RuntimeEvent, "time" | "type" | "pairId">
  ): void {
    const runtimeEvent: RuntimeEvent = {
      time: this.clock().toISOString(),
      type,
      pairId,
      ...event
    };
    this.logger?.write(runtimeEvent);
    this.options.onEvent?.(runtimeEvent);
  }
}

function workerHealth(
  observation: { reachable: boolean; sessionExists: boolean; sessionActive: boolean }
): { health: PeerHealth; activity?: PeerActivity; failureReason?: PeerFailureReason } {
  if (!observation.reachable) {
    return { health: "failed", failureReason: "transport" };
  }
  if (!observation.sessionExists) {
    return { health: "failed", failureReason: "session" };
  }
  return { health: "connected", activity: observation.sessionActive ? "working" : "idle" };
}

function plannerHealth(
  observation: {
    rateLimitedUntil?: number;
    reachable: boolean;
    authenticated: boolean;
    conversationReachable: boolean;
    composerAvailable: boolean;
    generating: boolean;
  }
): { health: PeerHealth; activity?: PeerActivity; failureReason?: PeerFailureReason } {
  if (observation.rateLimitedUntil !== undefined) return { health: "degraded" };
  if (!observation.reachable) {
    return { health: "failed", failureReason: "transport" };
  }
  if (!observation.authenticated || !observation.conversationReachable) {
    return { health: "failed", failureReason: "session" };
  }
  if (!observation.composerAvailable) {
    return { health: "degraded" };
  }
  return { health: "connected", activity: observation.generating ? "working" : "idle" };
}

/**
 * True while the pair's most recent recovery attempt is actively in progress: eligible for
 * recovery, not yet succeeded, and not yet exhausted/requiring intervention. This distinguishes
 * "Connection lost · Recovering…" from a plain failed state where recovery is exhausted or has
 * not (yet) run.
 */
function isRecovering(
  supervisorState: SupervisorState | undefined,
  report: SupervisorReport | undefined
): boolean {
  if (supervisorState !== "DISCONNECTED" && supervisorState !== "FAILED" && supervisorState !== "STUCK") {
    return false;
  }
  const recovery = report?.recovery;
  if (!recovery) {
    return false;
  }
  return recovery.policy !== "none" && recovery.eligible && recovery.performed &&
    !recovery.recovered && !recovery.intervention;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
