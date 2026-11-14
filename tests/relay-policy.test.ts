import { describe, expect, it } from "vitest";
import { decideRelays } from "../src/supervisor/policy.js";
import type { CycleContext } from "../src/supervisor/classifier.js";
import type { ObservationSnapshot, SupervisorState } from "../src/types.js";

function snapshot(): ObservationSnapshot {
  return {
    pairId: "p",
    observedAt: "2026-08-31T10:00:00.000Z",
    worker: {
      reachable: true,
      sessionExists: true,
      sessionActive: true,
      gathering: false,
      detail: []
    },
    planner: {
      reachable: true,
      authenticated: true,
      conversationReachable: true,
      composerAvailable: true,
      generating: false,
      detail: []
    }
  };
}

function bothPending(overrides: Partial<CycleContext> = {}): CycleContext {
  return {
    workerReportPending: true,
    plannerInstructionPending: true,
    pendingWorkerMessageCreatedAt: 200,
    pendingPlannerMessageCreatedAt: 100,
    ...overrides
  };
}

function decide(cycle: CycleContext, state: SupervisorState = "WORKING") {
  return decideRelays({
    mode: "relay",
    state,
    cycle,
    snapshot: snapshot(),
    paused: false,
    workerRelayStable: true
  });
}

describe("decideRelays — v1.1 §7.3 both-busy starting side selection", () => {
  it("holds BOTH relays when both sides are pending and no starting side is selected", () => {
    expect(decide(bothPending({ startingSide: null }))).toEqual({
      relayWorkerToPlanner: false,
      relayPlannerToWorker: false
    });
    expect(decide(bothPending({ startingSide: undefined }))).toEqual({
      relayWorkerToPlanner: false,
      relayPlannerToWorker: false
    });
  });

  it("dispatches the operator-selected planner side only", () => {
    expect(decide(bothPending({ startingSide: "planner" }))).toEqual({
      relayWorkerToPlanner: false,
      relayPlannerToWorker: true
    });
  });

  it("dispatches the operator-selected worker side only", () => {
    expect(decide(bothPending({ startingSide: "worker" }))).toEqual({
      relayWorkerToPlanner: true,
      relayPlannerToWorker: false
    });
  });

  it("selection does not bypass ordinary gates (stability, gathering, paused)", () => {
    expect(decide(bothPending({ startingSide: "worker" }), "PAUSED")).toEqual({
      relayWorkerToPlanner: false,
      relayPlannerToWorker: false
    });
    expect(decide(bothPending({ startingSide: "planner" }), "READY")).toEqual({
      relayWorkerToPlanner: false,
      relayPlannerToWorker: false
    });
  });

  it("a single pending side dispatches normally without any selection", () => {
    expect(decide({ workerReportPending: false, plannerInstructionPending: true })).toEqual({
      relayWorkerToPlanner: false,
      relayPlannerToWorker: true
    });
    expect(decide({ workerReportPending: true, plannerInstructionPending: false })).toEqual({
      relayWorkerToPlanner: true,
      relayPlannerToWorker: false
    });
  });
});
