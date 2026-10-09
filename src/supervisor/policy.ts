/**
 * Agent-relay codebase — module explanation / info.
 * File: src/supervisor/policy.ts
 * Purpose: Source module for policy.ts.
 */
import type { ObservationSnapshot, SupervisorState } from "../types.js";
import type { CycleContext } from "./classifier.js";

export type SuperviseMode = "observe" | "relay";

export interface RelayDecisions {
  relayWorkerToPlanner: boolean;
  relayPlannerToWorker: boolean;
}

export interface PolicyInput {
  mode: SuperviseMode;
  state: SupervisorState;
  cycle: CycleContext;
  snapshot: ObservationSnapshot;
  paused: boolean;
  workerRelayStable: boolean;
}

export function decideRelays(input: PolicyInput): RelayDecisions {
  const workerReportPending =
    input.state === "WORKING" &&
    input.cycle.workerReportPending &&
    input.workerRelayStable &&
    !input.snapshot.worker.gathering;

  const plannerInstructionPending =
    input.state === "WORKING" &&
    input.cycle.plannerInstructionPending &&
    !input.snapshot.planner.generating &&
    !input.snapshot.worker.gathering;

  // When both sides have pending work, prefer the absolute latest message globally
  // to maintain a deterministic "ping-pong" sequence.
  let relayWorker = workerReportPending;
  let relayPlanner = plannerInstructionPending;

  if (workerReportPending && plannerInstructionPending) {
    const workerTime = input.cycle.pendingWorkerMessageCreatedAt ?? 0;
    const plannerTime = input.cycle.pendingPlannerMessageCreatedAt ?? 0;
    if (workerTime > plannerTime) {
      relayPlanner = false;
    } else {
      relayWorker = false;
    }
  }

  return {
    relayWorkerToPlanner: input.mode === "relay" && !input.paused && relayWorker,
    relayPlannerToWorker: input.mode === "relay" && !input.paused && relayPlanner
  };
}