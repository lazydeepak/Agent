import type {
  ObservationSnapshot,
  SupervisorContinuity,
  SupervisorState
} from "../types.js";
import { isBusyState } from "./state.js";

export const DEFAULT_STUCK_AFTER_MS = 10 * 60_000;

export interface CycleContext {
  ambiguousDelivery?: boolean;
  currentCyclePlannerMessageId?: string;
  workerResponseMessageId?: string;
  workerFailed?: boolean;
  workerReportPending: boolean;
  plannerInstructionPending: boolean;
  pendingWorkerMessageCreatedAt?: number;
  pendingPlannerMessageCreatedAt?: number;
  lastWorkerRelaySourceMessageId?: string;
  lastWorkerRelayAt?: string;
  lastPlannerRelaySourceMessageId?: string;
  lastPlannerRelayAt?: string;
}

export interface ClassifyOptions {
  stuckAfterMs?: number;
}

export interface ClassifyInput {
  snapshot: ObservationSnapshot;
  cycle: CycleContext;
  continuity: SupervisorContinuity;
  options?: ClassifyOptions;
}

export interface Classification {
  state: SupervisorState;
  reason: string;
}

export function emptyCycleContext(): CycleContext {
  return {
    workerReportPending: false,
    plannerInstructionPending: false
  };
}

export function classify(input: ClassifyInput): Classification {
  const { snapshot, cycle, continuity, options = {} } = input;
  const stuckAfterMs = options.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const now = Date.parse(snapshot.observedAt);
  const worker = snapshot.worker;
  const planner = snapshot.planner;

  if (continuity.paused) {
    return { state: "PAUSED", reason: "Relay is stopped." };
  }

  if (cycle.ambiguousDelivery) {
    return {
      state: "FAILED",
      reason:
        "Delivery state is uncertain and requires verification."
    };
  }

  if (!worker.reachable) {
    return { state: "DISCONNECTED", reason: disconnectedReason("Worker", worker.detail) };
  }

  if (worker.sessionExists && planner.rateLimitedUntil !== undefined && planner.rateLimitedUntil > now) {
    return { state: "WAITING_PLANNER", reason: `Planner is rate-limited until ${new Date(planner.rateLimitedUntil).toISOString()}.` };
  }

  if (!planner.reachable) {
    return { state: "DISCONNECTED", reason: disconnectedReason("Planner", planner.detail) };
  }

  if (worker.sessionExists === false) {
    return { state: "FAILED", reason: "Worker session does not exist." };
  }

  if (planner.authenticated === false) {
    return { state: "FAILED", reason: "Planner is not authenticated." };
  }

  if (planner.conversationReachable === false) {
    return { state: "FAILED", reason: "Planner conversation is not reachable." };
  }

  if (planner.composerAvailable === false) {
    return { state: "FAILED", reason: "Planner composer is not available." };
  }

  if (cycle.workerFailed) {
    return { state: "FAILED", reason: "Worker step failed." };
  }

  if (worker.waitingForInput) {
    return { state: "WAITING_INPUT", reason: "Worker is waiting for input." };
  }

  if (!planner.generating && !worker.gathering && planner.latestPlannerControl) {
    return planner.latestPlannerControl === "complete"
      ? { state: "COMPLETED", reason: "Work marked as complete." }
      : { state: "FAILED", reason: "Blocker reported." };
  }

  const pendingWork = Boolean(
    worker.gathering ||
      cycle.workerReportPending ||
      cycle.plannerInstructionPending ||
      planner.generating
  );

  if (stuckAfterMs > 0 && pendingWork) {
    const busyPreviously = isBusyState(continuity.lastSupervisorState);
    const idleSinceMs = idleSinceMsFor(continuity, now);
    if (busyPreviously && idleSinceMs >= stuckAfterMs) {
      return {
        state: "STUCK",
        reason: `No activity for ${Math.round(idleSinceMs / 1000)}s.`
      };
    }
  }

  if (worker.gathering) {
    if (cycle.lastPlannerRelaySourceMessageId) {
      return { state: "WAITING_WORKER", reason: "Worker is processing instruction." };
    }
    return { state: "WORKING", reason: "Worker is active." };
  }

  if (cycle.workerReportPending) {
    return { state: "WORKING", reason: "Ready to relay worker report." };
  }

  if (planner.generating) {
    return { state: "WAITING_PLANNER", reason: "Planner is generating." };
  }

  if (cycle.plannerInstructionPending) {
    return { state: "WORKING", reason: "Ready to relay planner instruction." };
  }

  if (cycleCompleted(cycle)) {
    return { state: "COMPLETED", reason: "Cycle completed." };
  }

  const cycleStarted = Boolean(
    cycle.currentCyclePlannerMessageId ||
      cycle.lastPlannerRelaySourceMessageId ||
      cycle.lastWorkerRelaySourceMessageId
  );

  if (!cycleStarted) {
    return { state: "READY", reason: "Ready." };
  }

  return { state: "IDLE", reason: "Idle." };
}

function idleSinceMsFor(continuity: SupervisorContinuity, now: number): number {
  const references = [
    continuity.stateChangedAt,
    continuity.lastWorkerActivityAt,
    continuity.lastPlannerActivityAt
  ]
    .map((value) => (value ? Date.parse(value) : 0))
    .filter((timestamp) => timestamp > 0);

  const newestReference = references.length > 0 ? Math.max(...references) : now;
  return Math.max(0, now - newestReference);
}

function cycleCompleted(cycle: CycleContext): boolean {
  return Boolean(
    cycle.currentCyclePlannerMessageId &&
      cycle.lastPlannerRelaySourceMessageId === cycle.currentCyclePlannerMessageId &&
      cycle.lastWorkerRelaySourceMessageId &&
      cycle.lastWorkerRelayAt &&
      cycle.lastPlannerRelayAt &&
      Date.parse(cycle.lastWorkerRelayAt) >= Date.parse(cycle.lastPlannerRelayAt)
  );
}

function disconnectedReason(owner: "Worker" | "Planner", detail?: string[]): string {
  const suffix = detail && detail.length > 0 ? ` (${detail.join("; ")})` : "";
  return `${owner} endpoint is not reachable${suffix}.`;
}
