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

  // v1.1 §7.3–7.4 — when both sides have pending work, the operator selects the
  // starting side; with no selection both relays hold (never choose automatically).
  let relayWorker = workerReportPending;
  let relayPlanner = plannerInstructionPending;

  if (workerReportPending && plannerInstructionPending) {
    const side = input.cycle.startingSide ?? null;
    if (!side) {
      relayWorker = false;
      relayPlanner = false;
    } else if (side === "planner") {
      relayWorker = false;
    } else {
      relayPlanner = false;
    }
  }

  return {
    relayWorkerToPlanner: input.mode === "relay" && !input.paused && relayWorker,
    relayPlannerToWorker: input.mode === "relay" && !input.paused && relayPlanner
  };
}