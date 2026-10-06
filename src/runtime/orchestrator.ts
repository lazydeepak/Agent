import type { RelayStore } from "../persistence/index.js";
import type { RuntimeEvent, SupervisorEvent, SupervisorLogger } from "../supervisor/events.js";
import type { SupervisorRecoveryOptions, SupervisorReport } from "../supervisor/supervisor.js";
import { createPairAdapters } from "./adapters.js";
import type { PairAdapters, RuntimeAdapterOptions } from "./adapters.js";
import { MultiSinkSupervisorLogger } from "./logging.js";
import { PairRuntime } from "./pair-runtime.js";
import { PairRegistry } from "./registry.js";
import type { LockRegistry, SleepFn } from "./scheduler.js";
import { WakeBus } from "./wake-bus.js";
import type { PairRuntimeState, RuntimePairStatus, SessionPair } from "../types.js";

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export interface RuntimeOrchestratorOptions {
  pairs: SessionPair[];
  store: RelayStore;
  logger?: SupervisorLogger;
  clock?: () => Date;
  pollIntervalMs?: number;
  stuckAfterMs?: number;
  stabilityMs?: number;
  relay?: boolean;
  recoveryFor?: (pair: SessionPair) => SupervisorRecoveryOptions | undefined;
  adapterDefaults?: RuntimeAdapterOptions;
  adapterFor?: (pair: SessionPair) => PairAdapters;
  browserLocks?: LockRegistry;
  sleep?: SleepFn;
  perPairLogs?: boolean;
  onReport?: (report: SupervisorReport) => void;
}

export interface RuntimeStatusSummary {
  enabled: number;
  running: number;
  healthy: number;
  degraded: number;
  failed: number;
  pairs: RuntimePairStatus[];
}

export type OrchestratorEvent = RuntimeEvent | SupervisorEvent;

export class RuntimeOrchestrator {
  private readonly store: RelayStore;
  private registry: PairRegistry;
  private readonly clock: () => Date;
  private readonly options: RuntimeOrchestratorOptions;
  private readonly logger: SupervisorLogger | undefined;
  private readonly runtimes = new Map<string, PairRuntime>();
  private readonly listeners = new Set<(event: OrchestratorEvent) => void>();
  private activationEmitted = false;
  private readonly sleep: SleepFn | undefined;
  private readonly wakeBus = new WakeBus();

  constructor(options: RuntimeOrchestratorOptions) {
    this.options = options;
    this.store = options.store;
    this.clock = options.clock ?? (() => new Date());
    this.sleep = options.sleep;
    this.registry = new PairRegistry(options.pairs);
    this.logger =
      options.perPairLogs === false
        ? options.logger
        : new MultiSinkSupervisorLogger(options.logger ?? noopLogger());
  }

  listPairs(): SessionPair[] {
    return this.registry.list();
  }

  hasPair(pairId: string): boolean {
    return this.registry.has(pairId);
  }

  getPairStatus(pairId: string): RuntimePairStatus | undefined {
    const runtime = this.runtimes.get(pairId);
    if (runtime) {
      return runtime.status();
    }
    return this.persistedStatus(pairId);
  }

  getStatus(): RuntimeStatusSummary {
    const statuses = this.listPairs()
      .map((pair) => this.getPairStatus(pair.pairId))
      .filter(isDefined);
    const running = statuses.filter(
      (status) => status.runtimeState === "RUNNING" || status.runtimeState === "STARTING"
    );
    const healthy = running.filter(isHealthyRuntime);
    const failed = running.filter(isFailedRuntime);
    const degraded = running.filter((status) => !isHealthyRuntime(status) && !isFailedRuntime(status));
    return {
      enabled: this.registry.enabled().length,
      running: running.length,
      healthy: healthy.length,
      degraded: degraded.length,
      failed: failed.length,
      pairs: statuses
    };
  }

  subscribeEvents(listener: (event: OrchestratorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startAll(): Promise<void> {
    const pairs = this.registry.enabled();

    const results = await Promise.allSettled(pairs.map((pair) => this.startPair(pair.pairId)));
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected.length > 0) {
      throw new RuntimeError(
        `${rejected.length} of ${pairs.length} runtime pair(s) failed to start. ${rejected
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
          .join(" ")}`
      );
    }
  }

  async startPair(pairId: string): Promise<void> {
    const pair = this.registry.get(pairId);
    if (!pair) {
      throw new RuntimeError(`Unknown pairId "${pairId}".`);
    }
    if (!pair.enabled) {
      throw new RuntimeError(`Pair "${pairId}" is disabled in the runtime registry.`);
    }

    const existing = this.runtimes.get(pairId);
    if (existing && existing.state !== "STOPPED" && existing.state !== "ERROR") {
      return;
    }
    if (this.starting.has(pairId)) {
      return;
    }
    this.starting.add(pairId);
    if (existing) {
      this.runtimes.delete(pairId);
    }

    try {
      if (!this.activationEmitted) {
        this.emitRuntimeEvent("RUNTIME_STARTED", undefined, {
          reason: "Runtime activation started.",
          details: { startedAt: this.clock().toISOString() }
        });
        this.activationEmitted = true;
      }

      const adapters =
        this.options.adapterFor?.(pair) ??
        createPairAdapters(pair, this.options.adapterDefaults ?? { browserLocks: this.options.browserLocks });

      const runtime = new PairRuntime({
        pair,
        store: this.store,
        worker: adapters.worker,
        planner: adapters.planner,
        logger: this.logger,
        clock: this.clock,
        pollIntervalMs: this.options.pollIntervalMs,
        stuckAfterMs: this.options.stuckAfterMs,
        stabilityMs: this.options.stabilityMs,
        mode: this.options.relay ? "relay" : "observe",
        recovery: this.options.recoveryFor?.(pair),
        sleep: this.sleep,
        wakeBus: this.wakeBus,
        workerEvents: adapters.workerEvents,
        onReport: this.options.onReport,
        onEvent: (event) => this.broadcast(event)
      });

      this.runtimes.set(pairId, runtime);
      try {
        await runtime.start();
      } catch (error) {
        this.runtimes.set(pairId, runtime);
        this.emitRuntimeEvent("PAIR_RUNTIME_FAILED", pairId, {
          reason: error instanceof Error ? error.message : String(error)
        });
        throw new RuntimeError(
          `Pair "${pairId}" failed to start: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } finally {
      this.starting.delete(pairId);
    }
  }

  async stopPair(pairId: string): Promise<void> {
    const runtime = this.runtimes.get(pairId);
    if (!runtime) {
      if (this.registry.has(pairId)) {
        const stoppedAt = this.clock().toISOString();
        this.store.touchRuntimeState({ pairId, runtimeEnabled: false, lastRuntimeStopAt: stoppedAt });
        this.emitRuntimeEvent("PAIR_RUNTIME_STOPPED", pairId, { reason: "Pair runtime was already stopped." });
        return;
      }
      throw new RuntimeError(`Unknown pairId "${pairId}".`);
    }
    await runtime.stop();
    this.runtimes.delete(pairId);
  }

  pausePair(pairId: string): void {
    const runtime = this.runtimes.get(pairId);
    if (runtime) {
      runtime.pause();
      return;
    }
    if (this.registry.has(pairId)) {
      this.store.touchSupervisorState({ pairId, paused: true });
      return;
    }
    throw new RuntimeError(`Unknown pairId "${pairId}".`);
  }

  resumePair(pairId: string): void {
    const runtime = this.runtimes.get(pairId);
    if (runtime) {
      runtime.resume();
      return;
    }
    if (this.registry.has(pairId)) {
      this.store.touchSupervisorState({ pairId, paused: false });
      return;
    }
    throw new RuntimeError(`Unknown pairId "${pairId}".`);
  }

  async stopAll(): Promise<void> {
    const results = await Promise.allSettled([...this.runtimes.keys()].map((pairId) => this.stopPair(pairId)));
    for (const result of results) {
      if (result.status === "rejected") {
        this.emitRuntimeEvent("PAIR_RUNTIME_FAILED", undefined, {
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    }
    this.emitRuntimeEvent("RUNTIME_STOPPED", undefined, {});
    this.activationEmitted = false;
  }

  async shutdown(): Promise<void> {
    await this.stopAll();
    this.logger?.close();
  }

  reconfigurePairs(candidatePairs: SessionPair[]): void {
    for (const pair of this.listPairs()) {
      const status = this.getPairStatus(pair.pairId);
      if (!status) continue;
      const activeStates = ["STARTING", "RUNNING", "PAUSED", "STOPPING"];
      if (activeStates.includes(status.runtimeState)) {
        throw new RuntimeError(
          `Pair "${pair.pairId}" must be stopped before editing, rebinding, or removing it. Stop the pair first.`
        );
      }
    }
    const newRegistry = new PairRegistry(candidatePairs);
    this.registry = newRegistry;
  }

  private readonly starting = new Set<string>();

  private persistedStatus(pairId: string): RuntimePairStatus {
    const pair = this.registry.get(pairId);
    const continuity = this.store.getSupervisorState(pairId);
    const metadata = this.store.getRuntimeState(pairId);
    return {
      pairId,
      // Persisted enabled state reflects a runtime owned by another live process
      // (CLI runtime start sets it; explicit stop clears it), so a status query
      // from a fresh process reports it truthfully instead of always STOPPED.
      runtimeState: metadata?.runtimeEnabled ? "RUNNING" : "STOPPED",
      supervisorState: continuity?.lastSupervisorState,
      worker: "unknown",
      planner: "unknown",
      recovering: false,
      workerObserved: false,
      plannerObserved: false,
      lastObservedAt: continuity?.lastObservedAt,
      paused: continuity?.paused ?? false,
      lastError: metadata?.lastRuntimeError ?? continuity?.lastRecoveryError,
      enabled: pair?.enabled ?? false,
      schedulerMode: metadata?.schedulerMode
    };
  }

  private emitRuntimeEvent(
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
    this.broadcast(runtimeEvent);
  }

  private broadcast(event: OrchestratorEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function isHealthyRuntime(status: RuntimePairStatus): boolean {
  return (
    status.runtimeState === "RUNNING" &&
    status.supervisorState !== "DISCONNECTED" &&
    status.supervisorState !== "FAILED" &&
    status.supervisorState !== "STUCK" &&
    status.worker !== "failed" &&
    status.planner !== "failed"
  );
}

export function isFailedRuntime(status: RuntimePairStatus): boolean {
  return (
    status.runtimeState === "ERROR" ||
    (status.runtimeState === "RUNNING" &&
      (status.supervisorState === "DISCONNECTED" ||
        status.supervisorState === "FAILED" ||
        status.supervisorState === "STUCK" ||
        status.worker === "failed" ||
        status.planner === "failed"))
  );
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function noopLogger(): SupervisorLogger {
  return {
    write(): void {
      // no-op
    },
    close(): void {
      // no-op
    }
  };
}
