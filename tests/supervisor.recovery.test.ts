import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import type { BackoffPolicy } from "../src/recovery/index.js";
import { MemorySupervisorLogger } from "../src/supervisor/events.js";
import { Supervisor } from "../src/supervisor/supervisor.js";
import type { RelayableMessage, WorkerIdentity, WorkerObservation } from "../src/types.js";
import { ControllableWorker, RecordingBrowserManager, makePair, noopSleep } from "./helpers.js";

const INSTANT_BACKOFF: BackoffPolicy = { delaysMs: [1, 1, 1] };
const tempDirs: string[] = [];
let now = Date.parse("2026-08-31T10:00:00.000Z");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-sup-recovery-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();
  return store;
}

function clock(): () => Date {
  return () => new Date(now);
}

function advance(ms: number): void {
  now += ms;
}

class FlakyWorker extends ControllableWorker {
  observeOnceShallFail = false;

  override async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    if (this.observeOnceShallFail) {
      this.observeOnceShallFail = false;
      throw new Error("transient observation failure (test)");
    }
    return super.observeWorkerSession(worker);
  }
}

function recoveryOptions(store: RelayStore, worker: ControllableWorker) {
  return {
    policy: "safe" as const,
    browser: new RecordingBrowserManager("external"),
    maxAttempts: 5,
    backoff: INSTANT_BACKOFF,
    sleep: async () => {}
  };
}

describe("Supervisor M8 recovery and stability behavior", () => {
  it("contains a disconnect during the second response read without changing the cycle or replaying", async () => {
    const store = await openStore();
    const pair = makePair();
    const worker = new ControllableWorker();
    store.createCycle({ pairId: pair.pairId, plannerSourceMessageId: "instruction", workerDispatchMessageId: "dispatch" });
    const before = store.listCycles(pair.pairId);
    vi.spyOn(worker, "getAssistantResponseForDispatch").mockRejectedValueOnce(new Error("response connection reset"));
    const supervisor = new Supervisor({ pair, worker, planner: new FakeChatGPTBrowserAdapter(), store, recovery: { policy: "safe" } });
    try {
      const report = await supervisor.observeOnce();
      expect(report.state).toBe("DISCONNECTED");
      expect(report.recovery?.recovered).toBe(true);
      expect(report.relays).toHaveLength(0);
      expect(store.listCycles(pair.pairId)).toEqual(before);
      expect(worker.sentPlannerMessages).toHaveLength(0);
      await expect(supervisor.observeOnce()).resolves.toBeDefined();
    } finally { store.close(); }
  });
  it("reaches recovery during an in-flight dispatch without reading the offline response or replaying its prompt", async () => {
    const store = await openStore();
    const pair = makePair();
    const worker = new ControllableWorker([{ id: "dispatch-1", source: "planner", role: "user", text: "Already sent" }]);
    worker.setUnreachable();
    const response = vi.spyOn(worker, "getAssistantResponseForDispatch").mockImplementation(async () => {
      if (!worker.reachable) throw new Error("offline response read");
      return undefined;
    });
    const planner = new FakeChatGPTBrowserAdapter();
    store.createCycle({ pairId: pair.pairId, plannerSourceMessageId: "instruction-1", workerDispatchMessageId: "dispatch-1" });
    const before = store.listCycles(pair.pairId);
    const supervisor = new Supervisor({ pair, worker, planner, store, mode: "relay", recovery: {
      policy: "safe", baseUrl: "http://127.0.0.1:4096", startServerLauncher: async () => {
        worker.reachable = true;
        return { endpoint: "http://127.0.0.1:4096", alreadyRunning: false };
      }
    } });
    try {
      const recovered = await supervisor.observeOnce();
      expect(recovered.recovery?.recovered).toBe(true);
      expect(response).not.toHaveBeenCalled();
      expect((await supervisor.observeOnce()).relays).toHaveLength(0);
      expect(response).not.toHaveBeenCalled();
      worker.setMessages([]);
      await supervisor.observeOnce();
      expect(response).toHaveBeenCalledWith(pair.worker, "dispatch-1", before[0].dispatchedAt);
      expect(store.listCycles(pair.pairId)).toEqual(before);
      expect(worker.sentPlannerMessages).toHaveLength(0);
      expect(planner.sentMessages).toHaveLength(0);
    } finally { store.close(); }
  });

  it("does not relay a worker report until it is stable across the stabilization window", async () => {
    const store = await openStore();
    const messages = (text: string): RelayableMessage[] => [
      { id: "report-1", source: "worker", role: "assistant", text }
    ];
    const worker = new ControllableWorker(messages("partial"));
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 2_000
    });

    const tick1 = await supervisor.observeOnce(); // t=0, first sighting
    expect(tick1.relays).toHaveLength(0);

    advance(1_000);
    worker.setMessages(messages("partial-ish")); // same id, new hash: stream still mutating
    const tick2 = await supervisor.observeOnce();
    expect(tick2.relays).toHaveLength(0);

    advance(1_000);
    const tick3 = await supervisor.observeOnce(); // t=2000 since last change? no: 1s elapsed only
    expect(tick3.relays).toHaveLength(0);

    advance(1_000);
    const tick4 = await supervisor.observeOnce(); // t=3000, stable for 2000ms
    expect(tick4.relays).toHaveLength(1);
    expect(tick4.relays[0]?.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(1);

    const continuity = store.getSupervisorState("kisab-main");
    expect(continuity?.candidateWorkerMessageId).toBe("report-1");
    store.close();
  });

  it("does not relay the worker report a second time after a restart", async () => {
    const store = await openStore();
    const worker = new ControllableWorker([
      { id: "report-1", source: "worker", role: "assistant", text: "Finished the slice", createdAt: 1_000 }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    const first = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0
    });
    const report = await first.observeOnce();
    expect(report.relays).toHaveLength(1);
    expect(report.relays[0]?.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(1);

    // Simulate a process restart: a brand new Supervisor instance over the same store.
    const restarted = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0
    });
    const afterRestart = await restarted.observeOnce();
    expect(afterRestart.relays).toHaveLength(0);
    expect(planner.sentMessages).toHaveLength(1);
    expect(worker.sentPlannerMessages).toHaveLength(0);
    store.close();
  });

  it("survives a restart in WAITING_PLANNER without resending the planner instruction", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    const planner = new FakeChatGPTBrowserAdapter();
    const pair = makePair({
      planner: { ...makePair().planner, readiness: { "planner.notGenerating": false } }
    });

    const first = new Supervisor({
      pair,
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0
    });
    const waiting = await first.observeOnce();
    expect(waiting.state).toBe("WAITING_PLANNER");
    expect(waiting.relays).toHaveLength(0);

    const restarted = new Supervisor({
      pair,
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0
    });
    const afterRestart = await restarted.observeOnce();
    expect(afterRestart.state).toBe("WAITING_PLANNER");
    expect(afterRestart.relays).toHaveLength(0);
    expect(worker.sentPlannerMessages).toHaveLength(0);
    store.close();
  });

  it("does not push a planner instruction while the planner is generating the next response", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    const planner = new FakeChatGPTBrowserAdapter([
      { id: "instr-2", source: "planner", role: "user", text: "Next instruction", createdAt: 1_000 }
    ]);
    const pair = makePair({
      planner: { ...makePair().planner, readiness: { "planner.notGenerating": false } }
    });
    const supervisor = new Supervisor({
      pair,
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0
    });

    const report = await supervisor.observeOnce();
    expect(report.state).toBe("WAITING_PLANNER");
    expect(report.relays).toHaveLength(0);
    expect(worker.sentPlannerMessages).toHaveLength(0);
    store.close();
  });

  it("recovers a transient worker observation failure and resumes observation on the next tick", async () => {
    const store = await openStore();
    const worker = new FlakyWorker([
      { id: "report-1", source: "worker", role: "assistant", text: "Finished the slice", createdAt: 1_000 }
    ]);
    worker.observeOnceShallFail = true;
    const observe = vi.spyOn(worker, "observeWorkerSession");
    const session = vi.spyOn(worker, "getSession");
    const create = vi.spyOn(worker, "createSession");
    const bind = vi.spyOn(worker, "bindSession");
    const list = vi.spyOn(worker, "listSessions");
    const planner = new FakeChatGPTBrowserAdapter();
    const logger = new MemorySupervisorLogger();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      logger,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0,
      recovery: recoveryOptions(store, worker)
    });

    const report = await supervisor.observeOnce();
    expect(report.state).toBe("DISCONNECTED");
    expect(report.recovery?.performed).toBe(true);
    expect(report.recovery?.recovered).toBe(true);
    expect(session).toHaveBeenCalledExactlyOnceWith(makePair().worker.sessionId);
    expect(report.relays).toHaveLength(0);
    expect(worker.sentPlannerMessages).toHaveLength(0);
    expect(logger.events.map((event) => event.type)).toContain("RECOVERY_SUCCEEDED");
    expect(logger.events.map((event) => event.type)).toContain("SESSION_RECONNECTED");

    // Next tick re-observes the healthy worker and relays the pending report once.
    advance(1);
    const resumed = await supervisor.observeOnce();
    expect(observe).toHaveBeenNthCalledWith(2, makePair().worker);
    expect(resumed.snapshot.worker.reachable).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(worker.sentPlannerMessages).toHaveLength(0);
    expect(resumed.relays).toHaveLength(1);
    expect(resumed.relays[0]?.status).toBe("DELIVERED");
    expect(resumed.state).toBe("IDLE");
    store.close();
  });

  it("nudges a stuck pair and keeps supervision active for the worker to resume", async () => {
    const store = await openStore();
    const worker = new ControllableWorker([
      { id: "user-1", source: "planner", role: "user", text: "Do the next step", createdAt: 1_000 }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();
    const logger = new MemorySupervisorLogger();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      logger,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0,
      stuckAfterMs: 500,
      recovery: recoveryOptions(store, worker)
    });

    await supervisor.observeOnce(); // establishes WORKING continuity
    advance(1_000);

    const stuck = await supervisor.observeOnce();
    expect(stuck.state).toBe("STUCK");
    expect(stuck.recovery?.intervention).toBe(false);
    expect(stuck.recovery?.recovered).toBe(false);
    expect(worker.sentPlannerMessages).toHaveLength(1);
    expect(logger.events.map((event) => event.type)).toContain("STUCK_DETECTED");
    expect(logger.events.map((event) => event.type)).toContain("RECOVERY_RETRY");

    // Progress clears STUCK after the bounded continuation nudge.
    worker.setMessages([
      { id: "user-1", source: "planner", role: "user", text: "Do the next step", createdAt: 1_000 },
      { id: "report-1", source: "worker", role: "assistant", text: "I made progress", createdAt: 4_000 }
    ]);
    advance(1_000);
    const progressed = await supervisor.observeOnce();
    expect(progressed.state).not.toBe("STUCK");
    expect(progressed.previousState).toBe("STUCK");
    // The worker's report is relayed to the planner; once delivered the pair is no
    // longer stuck and idles awaiting the next instruction.
    expect(progressed.relays.map((relay) => relay.status)).toEqual(["DELIVERED"]);
    expect(worker.sentPlannerMessages).toHaveLength(1);
    store.close();
  });

  it("still jumps straight to intervention for an unrecoverable missing session", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    worker.setSessionMissing();
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "observe",
      stabilityMs: 0,
      recovery: recoveryOptions(store, worker)
    });

    const report = await supervisor.observeOnce();
    expect(report.state).toBe("FAILED");
    expect(report.recovery?.intervention).toBe(true);
    expect(report.recovery?.recovered).toBe(false);
    const continuity = store.getSupervisorState("kisab-main");
    expect(continuity?.lastRecoveryErrorCode).toBe("OPENCODE_SESSION_MISSING");
    store.close();
  });
});
