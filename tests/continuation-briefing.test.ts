import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildResumeDecision,
  classifyResumeConsistency,
  collectResumeEvidence,
  type ResumeEvidence
} from "../src/application/continuation-briefing.js";
import { SqliteRelayStore } from "../src/persistence/index.js";
import { PlannerSeedingService, type PlannerSeedingContext } from "../src/application/planner-seeding-service.js";
import { hashText } from "../src/persistence/canonical.js";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import type { RuntimeAdapterOptions } from "../src/runtime/index.js";
import type { SessionPair } from "../src/types.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function freshStore(): Promise<SqliteRelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-resume-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent.sqlite"));
  await store.init();
  return store;
}

const cleanEvidence = (overrides: Partial<ResumeEvidence> = {}): ResumeEvidence => ({
  pairId: "p1",
  outstandingDeliveries: 0,
  unresolvedStartupOperation: false,
  gapsMarkerPresent: false,
  failedWorkerReports: 0,
  lastPlannerSideSyncedMessageId: "planner-msg-9",
  ...overrides
});

describe("classifyResumeConsistency", () => {
  it("proves direct continuation when no uncertainty is recorded", () => {
    const result = classifyResumeConsistency(cleanEvidence());
    expect(result).toEqual({ consistency: "proven", uncertainties: [] });
    const decision = buildResumeDecision(cleanEvidence());
    expect(decision.consistency).toBe("proven");
    expect(decision.text).toMatch(/Resume relay resumed|Agent relay resumed/);
    expect(decision.text).not.toContain("CHECKPOINT");
  });

  it("refuses continuation when deliveries are outstanding", () => {
    const result = classifyResumeConsistency(cleanEvidence({ outstandingDeliveries: 2 }));
    expect(result.consistency).toBe("unproven");
    expect(result.uncertainties[0]).toContain("2 delivery(ies)");
  });

  it("refuses continuation when a startup operation is open", () => {
    const result = classifyResumeConsistency(cleanEvidence({ unresolvedStartupOperation: true }));
    expect(result.consistency).toBe("unproven");
    expect(result.uncertainties.join(" ")).toMatch(/startup\/resume activation/);
  });

  it("refuses continuation when event history is marked with gaps", () => {
    const result = classifyResumeConsistency(cleanEvidence({ gapsMarkerPresent: true }));
    expect(result.consistency).toBe("unproven");
  });

  it("refuses continuation when the latest cycle has no worker completion", () => {
    const result = classifyResumeConsistency(
      cleanEvidence({
        latestCycle: {
          plannerSourceMessageId: "pm1",
          workerDispatchMessageId: "wd1",
          cycleStatus: "DISPATCHED"
        }
      })
    );
    expect(result.consistency).toBe("unproven");
    expect(result.uncertainties.join(" ")).toContain("wd1");
  });

  it("accepts a fully delivered cycle", () => {
    const result = classifyResumeConsistency(
      cleanEvidence({
        latestCycle: {
          plannerSourceMessageId: "pm1",
          workerDispatchMessageId: "wd1",
          cycleStatus: "DELIVERED",
          workerCompletedAt: "2026-11-18T00:00:00.000Z",
          workerResponseMessageId: "wr1"
        }
      })
    );
    expect(result.consistency).toBe("proven");
  });

  it("refuses continuation for unverified termination dispositions", () => {
    for (const disposition of ["terminated_unverified", "held", "awaiting_operator"]) {
      const result = classifyResumeConsistency(cleanEvidence({ incidentDisposition: disposition }));
      expect(result.consistency).toBe("unproven");
    }
  });

  it("refuses continuation when worker reports are marked failed", () => {
    const result = classifyResumeConsistency(cleanEvidence({ failedWorkerReports: 1 }));
    expect(result.consistency).toBe("unproven");
  });
});

describe("collectResumeEvidence against a real store", () => {
  it("reports clean state for an empty ledger", async () => {
    const store = await freshStore();
    try {
      const evidence = collectResumeEvidence(store, "p1");
      expect(evidence.outstandingDeliveries).toBe(0);
      expect(evidence.unresolvedStartupOperation).toBe(false);
      expect(evidence.gapsMarkerPresent).toBe(false);
      expect(evidence.failedWorkerReports).toBe(0);
      expect(evidence.latestCycle).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("detects outstanding deliveries, failed reports and unresolved startup operations", async () => {
    const store = await freshStore();
    try {
      const outstanding = { pairId: "p1", direction: "planner-to-worker" as const, sourceMessageId: "m1", sourceHash: hashText("x") };
      const failed = { pairId: "p1", direction: "worker-to-planner" as const, sourceMessageId: "m2", sourceHash: hashText("y") };
      store.createRecord(outstanding);
      store.updateStatus(outstanding, "DELIVERING", {});
      store.createRecord(failed);
      store.updateStatus(failed, "FAILED", { error: "boom" });
      store.createStartupOperation({ pairId: "p1", mode: "resume", plannerSessionId: "c1", workerSessionId: "s1", maxAttempts: 3 });

      const evidence = collectResumeEvidence(store, "p1");
      expect(evidence.outstandingDeliveries).toBe(1);
      expect(evidence.failedWorkerReports).toBe(1);
      expect(evidence.unresolvedStartupOperation).toBe(true);
    } finally {
      store.close();
    }
  });

  it("marks the event window as gapped when the supervisor error carries the marker", async () => {
    const store = await freshStore();
    try {
      store.touchSupervisorState({ pairId: "p1", lastError: "UNRECOVERABLE_GAPS:worker-events" });
      const evidence = collectResumeEvidence(store, "p1");
      expect(evidence.gapsMarkerPresent).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("PlannerSeedingService.seedResume", () => {
  function makeService(pair: SessionPair, store: SqliteRelayStore) {
    const events: Array<{ type: string; pairId: string | undefined; details?: Record<string, unknown> }> = [];
    const ctx: PlannerSeedingContext = {
      relay: true,
      getPairDetail: (id) => (id === pair.pairId ? pair : undefined),
      adapterOptions: () => ({} as RuntimeAdapterOptions),
      assertPairStopped: () => undefined,
      ensureBrowserLocks: () => ({ lockFor: () => ({ run: async (fn: () => Promise<void>) => fn() }) }) as never,
      ensureStore: () => store,
      recordEvent: (type, pairId, extras) => {
        events.push({ type, pairId, details: extras?.details });
      },
      updatePairConfig: async () => undefined
    };
    return { svc: new PlannerSeedingService(ctx), events };
  }

  it("sends direct continuation for a clean ledger and records mode=resume", async () => {
    const store = await freshStore();
    try {
      const pair = makePair({ pairId: "p1" });
      const { svc, events } = makeService(pair, store);
      const result = await svc.seedResume("p1");
      expect(result.consistency).toBe("proven");
      expect(result.promptVersion).toBe("resume-direct-1");
      expect(events.map((event) => event.type)).toContain("RESUME_CONTINUATION_SENT");
      const open = store.getOpenStartupOperation("p1");
      expect(open?.mode).toBe("resume");
      expect(open?.status).toBe("pending");
    } finally {
      store.close();
    }
  });

  it("sends a checkpoint briefing listing state and uncertainties for a dirty ledger", async () => {
    const store = await freshStore();
    try {
      const ident = { pairId: "p1", direction: "planner-to-worker" as const, sourceMessageId: "m1", sourceHash: hashText("x") };
      store.createRecord(ident); // left outstanding in DELIVERING-like state? createRecord starts DISCOVERED...
      store.createCycle({ pairId: "p1", plannerSourceMessageId: "pm1", workerDispatchMessageId: "wd1" });
      store.touchSupervisorState({ pairId: "p1", lastError: "UNRECOVERABLE_GAPS:worker-events" });
      const pair = makePair({ pairId: "p1" });
      const { svc, events } = makeService(pair, store);
      const result = await svc.seedResume("p1");
      expect(result.consistency).toBe("unproven");
      expect(result.promptVersion).toBe("resume-briefing-1");
      expect(result.uncertainties?.join(" ")).toContain("UNRECOVERABLE_GAPS");
      expect(events.map((event) => event.type)).toContain("RESUME_BRIEFING_SENT");
      const payload = events.find((event) => event.type === "RESUME_BRIEFING_SENT");
      expect(payload?.details?.uncertainties).toBeDefined();
      expect(payload?.details?.latestCycleStatus).toBe("DISPATCHED");
    } finally {
      store.close();
    }
  });

  it("captures the worker report reference in the briefing text", async () => {
    const store = await freshStore();
    try {
      const cycle = store.createCycle({ pairId: "p1", plannerSourceMessageId: "pm1", workerDispatchMessageId: "wd1" });
      store.updateCycle("p1", "pm1", { workerResponseMessageId: "wr1", workerCompletedAt: new Date().toISOString() });
      // Worker report exists, but keep gaps marker so we take the briefing path.
      store.touchSupervisorState({ pairId: "p1", lastError: "UNRECOVERABLE_GAPS:planner-events" });
      const pair = makePair({ pairId: "p1" });
      const { svc, events } = makeService(pair, store);
      // Spy on the adapter to capture the message text.
      const sent: string[] = [];
      const originalSend = FakeChatGPTBrowserAdapter.prototype.sendWorkerMessage;
      FakeChatGPTBrowserAdapter.prototype.sendWorkerMessage = (async function (this: FakeChatGPTBrowserAdapter, planner: never, message: never) {
        sent.push((message as { text: string }).text);
        return originalSend.call(this, planner, message);
      }) as never;
      try {
        const result = await svc.seedResume("p1");
        expect(result.consistency).toBe("unproven");
      } finally {
        FakeChatGPTBrowserAdapter.prototype.sendWorkerMessage = originalSend;
      }
      expect(sent[0]).toContain("wd1");
      expect(sent[0]).toContain("wr1");
      expect(sent[0]).toContain("POSSIBLE PRIOR DELIVERY");
      expect(sent[0]).toContain("CHECKPOINT");
      void cycle;
      void events;
    } finally {
      store.close();
    }
  });

  it("holds the resume operation and raises intervention when delivery fails", async () => {
    const store = await freshStore();
    try {
      const pair = makePair({ pairId: "p1" });
      const { svc, events } = makeService(pair, store);
      const originalSend = FakeChatGPTBrowserAdapter.prototype.sendWorkerMessage;
      const wedged = (): Promise<never> => Promise.reject(new Error("composer wedged"));
      FakeChatGPTBrowserAdapter.prototype.sendWorkerMessage = wedged as never;
      try {
        await expect(svc.seedResume("p1")).rejects.toMatchObject({ code: "RESUME_HOLD" });
      } finally {
        FakeChatGPTBrowserAdapter.prototype.sendWorkerMessage = originalSend;
      }
      expect(events.map((event) => event.type)).toContain("INTERVENTION_REQUIRED");
      const open = store.getOpenStartupOperation("p1");
      expect(open?.mode).toBe("resume");
      expect(open?.status).toBe("hold");
    } finally {
      store.close();
    }
  });
});
