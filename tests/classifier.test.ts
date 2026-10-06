import { describe, expect, it } from "vitest";
import { classify, emptyCycleContext, type CycleContext } from "../src/supervisor/classifier.js";
import type {
  ObservationSnapshot,
  PlannerObservation,
  SupervisorContinuity,
  WorkerObservation
} from "../src/types.js";

const T0 = "2026-08-31T10:00:00.000Z";
const T_MINUS_20 = "2026-08-31T09:40:00.000Z";
const T_MINUS_1 = "2026-08-31T09:59:00.000Z";

describe("supervisor classifier", () => {
  it("reports PAUSED when the pair is paused", () => {
    const result = classify({
      snapshot: healthySnapshot(),
      cycle: emptyCycleContext(),
      continuity: continuity({ paused: true })
    });
    expect(result.state).toBe("PAUSED");
  });

  it("reports DISCONNECTED when the worker endpoint is unreachable", () => {
    const result = classify({
      snapshot: healthySnapshot({
        worker: { reachable: false, detail: ["health: connection refused"] }
      }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("DISCONNECTED");
    expect(result.reason).toContain("connection refused");
  });

  it("reports DISCONNECTED when the planner endpoint is unreachable", () => {
    const result = classify({
      snapshot: healthySnapshot({
        planner: { reachable: false, detail: ["snapshot: CDP connection refused"] }
      }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("DISCONNECTED");
  });

  it("reports FAILED when the worker session is missing but the server is reachable", () => {
    const result = classify({
      snapshot: healthySnapshot({ worker: { sessionExists: false } }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("FAILED");
    expect(result.reason).toContain("session does not exist");
  });

  it("reports FAILED when the planner is not authenticated", () => {
    const result = classify({
      snapshot: healthySnapshot({ planner: { authenticated: false } }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("FAILED");
  });

  it("reports FAILED when the planner conversation is not reachable", () => {
    const result = classify({
      snapshot: healthySnapshot({ planner: { conversationReachable: false } }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("FAILED");
  });

  it("reports FAILED when the planner composer is unavailable", () => {
    const result = classify({
      snapshot: healthySnapshot({ planner: { composerAvailable: false } }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("FAILED");
  });

  it("reports WORKING when the worker is gathering a report and no instruction was delivered", () => {
    const result = classify({
      snapshot: healthySnapshot({
        worker: { gathering: true, latestMessageRole: "user", latestMessageId: "req-1" }
      }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("WORKING");
  });

  it("reports WAITING_WORKER when the worker is gathering after a delivered instruction", () => {
    const result = classify({
      snapshot: healthySnapshot({
        worker: { gathering: true, latestMessageRole: "user", latestMessageId: "req-1" }
      }),
      cycle: {
        ...emptyCycleContext(),
        lastPlannerRelaySourceMessageId: "instr-1"
      },
      continuity: continuity()
    });
    expect(result.state).toBe("WAITING_WORKER");
  });

  it("reports WORKING when a new worker report is ready to relay", () => {
    const result = classify({
      snapshot: healthySnapshot({
        worker: { lastAssistantMessageId: "report-2" }
      }),
      cycle: { ...emptyCycleContext(), workerReportPending: true },
      continuity: continuity()
    });
    expect(result.state).toBe("WORKING");
  });

  it("reports WAITING_PLANNER when the planner is generating", () => {
    const result = classify({
      snapshot: healthySnapshot({ planner: { generating: true } }),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("WAITING_PLANNER");
  });

  it("reports WORKING when a new planner instruction is ready to relay", () => {
    const result = classify({
      snapshot: healthySnapshot(),
      cycle: { ...emptyCycleContext(), plannerInstructionPending: true },
      continuity: continuity()
    });
    expect(result.state).toBe("WORKING");
  });

  it("reports COMPLETED when the instruction and a later report were both relayed", () => {
    const cycle: CycleContext = {
      ...emptyCycleContext(),
      currentCyclePlannerMessageId: "instr-1",
      lastPlannerRelaySourceMessageId: "instr-1",
      lastPlannerRelayAt: "2026-08-31T09:00:00.000Z",
      lastWorkerRelaySourceMessageId: "report-1",
      lastWorkerRelayAt: "2026-08-31T09:30:00.000Z"
    };
    const result = classify({
      snapshot: healthySnapshot(),
      cycle,
      continuity: continuity()
    });
    expect(result.state).toBe("COMPLETED");
  });

  it("reports READY when everything is quiescent and no cycle has started", () => {
    const result = classify({
      snapshot: healthySnapshot(),
      cycle: emptyCycleContext(),
      continuity: continuity()
    });
    expect(result.state).toBe("READY");
  });

  it("reports IDLE when quiescent with prior relay history but no completed cycle", () => {
    const result = classify({
      snapshot: healthySnapshot(),
      cycle: { ...emptyCycleContext(), lastPlannerRelaySourceMessageId: "instr-1" },
      continuity: continuity()
    });
    expect(result.state).toBe("IDLE");
  });

  it("reports STUCK when busy evidence exists and no progress for the stuck threshold", () => {
    const result = classify({
      snapshot: healthySnapshot({
        worker: {
          gathering: true,
          latestMessageRole: "user",
          latestMessageId: "req-1",
          latestMessageCreatedAt: Date.parse(T_MINUS_20)
        }
      }),
      cycle: emptyCycleContext(),
      continuity: continuity({
        lastSupervisorState: "WORKING",
        stateChangedAt: T_MINUS_20,
        lastWorkerActivityAt: T_MINUS_20
      }),
      options: { stuckAfterMs: 10 * 60_000 }
    });
    expect(result.state).toBe("STUCK");
  });

  it("does not report STUCK while worker activity is recent", () => {
    const result = classify({
      snapshot: healthySnapshot({
        worker: {
          gathering: true,
          latestMessageRole: "user",
          latestMessageId: "req-1",
          latestMessageCreatedAt: Date.parse(T_MINUS_1)
        }
      }),
      cycle: emptyCycleContext(),
      continuity: continuity({
        lastSupervisorState: "WORKING",
        stateChangedAt: T_MINUS_1,
        lastWorkerActivityAt: T_MINUS_1
      }),
      options: { stuckAfterMs: 10 * 60_000 }
    });
    expect(result.state).toBe("WORKING");
  });

  it("does not report STUCK without prior busy evidence", () => {
    const result = classify({
      snapshot: healthySnapshot({
        worker: {
          gathering: true,
          latestMessageRole: "user",
          latestMessageId: "req-1",
          latestMessageCreatedAt: Date.parse(T_MINUS_20)
        }
      }),
      cycle: emptyCycleContext(),
      continuity: continuity({
        lastSupervisorState: "IDLE",
        stateChangedAt: T_MINUS_20,
        lastWorkerActivityAt: T_MINUS_20
      }),
      options: { stuckAfterMs: 10 * 60_000 }
    });
    expect(result.state).toBe("WORKING");
  });
});

function continuity(overrides: Partial<SupervisorContinuity> = {}): SupervisorContinuity {
  return {
    pairId: "kisab-main",
    paused: false,
    ...overrides
  };
}

function healthySnapshot(overrides: {
  worker?: Partial<WorkerObservation>;
  planner?: Partial<PlannerObservation>;
  observedAt?: string;
} = {}): ObservationSnapshot {
  return {
    pairId: "kisab-main",
    observedAt: overrides.observedAt ?? T0,
    worker: {
      reachable: true,
      sessionExists: true,
      sessionActive: true,
      gathering: false,
      ...overrides.worker
    },
    planner: {
      reachable: true,
      authenticated: true,
      conversationReachable: true,
      composerAvailable: true,
      generating: false,
      ...overrides.planner
    }
  };
}