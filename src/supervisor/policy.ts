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

  return {
    relayWorkerToPlanner: input.mode === "relay" && !input.paused && workerReportPending,
    relayPlannerToWorker: input.mode === "relay" && !input.paused && plannerInstructionPending
  };
}