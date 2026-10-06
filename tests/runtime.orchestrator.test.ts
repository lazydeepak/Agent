import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { SqliteRelayStore } from "../src/persistence/store.js";
import type { RelayStore } from "../src/persistence/index.js";
import { RuntimeOrchestrator } from "../src/runtime/orchestrator.js";
import { MemorySupervisorLogger } from "../src/supervisor/events.js";
import type { RelayableMessage, SessionPair, WorkerIdentity, WorkerObservation } from "../src/types.js";
import { ControllableWorker, makePair } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("RuntimeOrchestrator", () => {
  it("runs two pairs concurrently, each with its own supervisor loop", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const ticks = new Map<string, number>();
      const orchestrator = makeOrchestrator(store, twoPairs(), ticks);

      await orchestrator.startAll();
      try {
        const status = orchestrator.getStatus();
        expect(status.running).toBe(2);
        expect(status.enabled).toBe(2);
        expect(status.healthy).toBe(2);

        await waitFor(() => {
          const a = orchestrator.getPairStatus("kisab-main");
          const b = orchestrator.getPairStatus("susankhya-main");
          return a?.supervisorState !== undefined && b?.supervisorState !== undefined;
        });

        const aTicks = ticks.get("kisab-main") ?? 0;
        const bTicks = ticks.get("susankhya-main") ?? 0;
        await waitFor(() => (ticks.get("kisab-main") ?? 0) > aTicks);
        await waitFor(() => (ticks.get("susankhya-main") ?? 0) > bTicks);
        expect(ticks.get("kisab-main")).toBeGreaterThan(aTicks);
        expect(ticks.get("susankhya-main")).toBeGreaterThan(bTicks);
      } finally {
        await orchestrator.stopAll();
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("allows a blocked pair to stall without delaying a healthy pair", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const pairA = makePair();
      const pairB = makePair({
        pairId: "susankhya-main",
        worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-2",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
        }
      });

      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gatedWorker = new GatedWorker(gate);
      const bTicker = new TickerWorker();

      const orchestrator = new RuntimeOrchestrator({
        pairs: [pairA, pairB],
        store,
        logger: new MemorySupervisorLogger(),
        perPairLogs: false,
        pollIntervalMs: 5,
        adapterFor: (pair) =>
          pair.pairId === "kisab-main"
            ? { worker: gatedWorker, planner: new FakeChatGPTBrowserAdapter() }
            : { worker: bTicker, planner: new FakeChatGPTBrowserAdapter() }
      });

      await orchestrator.startAll();
      try {
        await waitFor(() => bTicker.tickCount() > 5, 10_000);
        expect(gatedWorker.blocked).toBe(true);
        release();
        await gatedWorker.released();
      } finally {
        await orchestrator.stopAll();
        release();
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("stops one pair without stopping another", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const ticks = new Map<string, number>();
      const orchestrator = makeOrchestrator(store, twoPairs(), ticks);

      await orchestrator.startAll();
      try {
        await orchestrator.stopPair("kisab-main");

        expect(orchestrator.getPairStatus("kisab-main")?.runtimeState).toBe("STOPPED");
        expect(orchestrator.getPairStatus("susankhya-main")?.runtimeState).toBe("RUNNING");

        const bTicksBefore = ticks.get("susankhya-main") ?? 0;
        await waitFor(() => (ticks.get("susankhya-main") ?? 0) > bTicksBefore);
        expect(store.getRuntimeState("kisab-main")?.runtimeEnabled).toBe(false);
      } finally {
        await orchestrator.stopAll();
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("keeps a peer-failure pair isolated and the other pair healthy", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const workers = new Map<string, ControllableWorker>();
      const orchestrator = new RuntimeOrchestrator({
        pairs: twoPairs(),
        store,
        logger: new MemorySupervisorLogger(),
        perPairLogs: false,
        pollIntervalMs: 5,
        adapterFor: (pair) => {
          const worker = new ControllableWorker();
          workers.set(pair.pairId, worker);
          return { worker, planner: new FakeChatGPTBrowserAdapter() };
        }
      });

      await orchestrator.startAll();
      try {
        await waitFor(() => orchestrator.getPairStatus("susankhya-main")?.supervisorState !== undefined);
        workers.get("kisab-main")?.setUnreachable();

        await waitFor(() => orchestrator.getPairStatus("kisab-main")?.supervisorState === "DISCONNECTED");
        expect(orchestrator.getPairStatus("susankhya-main")?.runtimeState).toBe("RUNNING");
        expect(orchestrator.getPairStatus("susankhya-main")?.worker).toBe("connected");

        const summary = orchestrator.getStatus();
        const kisab = summary.pairs.find((status) => status.pairId === "kisab-main");
        expect(kisab?.worker).toBe("failed");
        expect(kisab?.workerFailureReason).toBe("transport");
        expect(summary.failed).toBe(1);
        expect(summary.healthy).toBe(1);
      } finally {
        await orchestrator.stopAll();
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("reports a reachable idle worker as connected+idle, not degraded", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const worker = new ControllableWorker();
      worker.setSessionActive(false);
      const orchestrator = new RuntimeOrchestrator({
        pairs: [makePair()],
        store,
        logger: new MemorySupervisorLogger(),
        perPairLogs: false,
        pollIntervalMs: 5,
        adapterFor: () => ({ worker, planner: new FakeChatGPTBrowserAdapter() })
      });

      await orchestrator.startPair("kisab-main");
      try {
        await waitFor(() => orchestrator.getPairStatus("kisab-main")?.supervisorState !== undefined);
        const status = orchestrator.getPairStatus("kisab-main");
        expect(status?.worker).toBe("connected");
        expect(status?.workerActivity).toBe("idle");
        expect(orchestrator.getStatus().healthy).toBe(1);
        expect(orchestrator.getStatus().degraded).toBe(0);
      } finally {
        await orchestrator.stopPair("kisab-main");
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("reports an actively generating worker as connected+working", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const worker = new ControllableWorker();
      worker.setSessionActive(true);
      const orchestrator = new RuntimeOrchestrator({
        pairs: [makePair()],
        store,
        logger: new MemorySupervisorLogger(),
        perPairLogs: false,
        pollIntervalMs: 5,
        adapterFor: () => ({ worker, planner: new FakeChatGPTBrowserAdapter() })
      });

      await orchestrator.startPair("kisab-main");
      try {
        await waitFor(() => orchestrator.getPairStatus("kisab-main")?.supervisorState !== undefined);
        const status = orchestrator.getPairStatus("kisab-main");
        expect(status?.worker).toBe("connected");
        expect(status?.workerActivity).toBe("working");
      } finally {
        await orchestrator.stopPair("kisab-main");
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("distinguishes a missing session (session-level) from an unreachable server (transport-level)", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const worker = new ControllableWorker();
      worker.setSessionMissing();
      const orchestrator = new RuntimeOrchestrator({
        pairs: [makePair()],
        store,
        logger: new MemorySupervisorLogger(),
        perPairLogs: false,
        pollIntervalMs: 5,
        adapterFor: () => ({ worker, planner: new FakeChatGPTBrowserAdapter() })
      });

      await orchestrator.startPair("kisab-main");
      try {
        await waitFor(() => orchestrator.getPairStatus("kisab-main")?.worker === "failed");
        const status = orchestrator.getPairStatus("kisab-main");
        expect(status?.worker).toBe("failed");
        expect(status?.workerFailureReason).toBe("session");
      } finally {
        await orchestrator.stopPair("kisab-main");
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("contains a catastrophic pair-level failure without terminating the runtime", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const pairB = makePair({
        pairId: "susankhya-main",
        worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-2",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
        }
      });
      const pairA = makePair();
      const wrapped = throwingStoreFor(store, "kisab-main");
      const orchestrator = new RuntimeOrchestrator({
        pairs: [pairB, pairA],
        store: wrapped,
        logger: new MemorySupervisorLogger(),
        perPairLogs: false,
        pollIntervalMs: 5,
        adapterFor: () => ({ worker: new ControllableWorker(), planner: new FakeChatGPTBrowserAdapter() })
      });

      await orchestrator.startPair("susankhya-main");
      await expect(orchestrator.startPair("kisab-main")).rejects.toThrow(/failed to start/);

      expect(orchestrator.getPairStatus("kisab-main")?.runtimeState).toBe("ERROR");
      expect(orchestrator.getPairStatus("susankhya-main")?.runtimeState).toBe("RUNNING");
      expect(store.getRuntimeState("kisab-main")?.runtimeEnabled).toBe(false);
      expect(store.getRuntimeState("kisab-main")?.lastRuntimeError).toContain("simulated store failure");

      await orchestrator.stopAll();
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("pauses one pair without pausing another", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const orchestrator = makeOrchestrator(store, twoPairs(), new Map());

      await orchestrator.startAll();
      try {
        orchestrator.pausePair("kisab-main");
        await waitFor(() => orchestrator.getPairStatus("kisab-main")?.supervisorState === "PAUSED");

        expect(orchestrator.getPairStatus("kisab-main")?.paused).toBe(true);
        expect(orchestrator.getPairStatus("susankhya-main")?.paused).toBe(false);
        expect(orchestrator.getPairStatus("susankhya-main")?.runtimeState).toBe("RUNNING");

        orchestrator.resumePair("kisab-main");
        await waitFor(() => orchestrator.getPairStatus("kisab-main")?.paused === false);
      } finally {
        await orchestrator.stopAll();
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("does not leak relay signals across pairs", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const pairA = makePair();
      const pairB = makePair({
        pairId: "susankhya-main",
        worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-2",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
        }
      });

      const workerA = new ControllableWorker([assistantMessage("m_a", "Build the next slice", 1_000)]);
      const workerB = new ControllableWorker();
      const plannerA = new FakeChatGPTBrowserAdapter();
      const plannerB = new FakeChatGPTBrowserAdapter();

      const orchestrator = new RuntimeOrchestrator({
        pairs: [pairA, pairB],
        store,
        logger: new MemorySupervisorLogger(),
        perPairLogs: false,
        pollIntervalMs: 5,
        relay: true,
        stabilityMs: 0,
        adapterFor: (pair) =>
          pair.pairId === "kisab-main"
            ? { worker: workerA, planner: plannerA }
            : { worker: workerB, planner: plannerB }
      });

      await orchestrator.startAll();
      try {
        await waitFor(() => receivedSourceIds(plannerA).length > 0);

        expect(receivedSourceIds(plannerA)).toEqual(["m_a"]);
        expect(receivedSourceIds(plannerB)).toEqual([]);
        expect(workerA.sentPlannerMessages).toHaveLength(0);
        expect(workerB.sentPlannerMessages).toHaveLength(0);

        const recordsOfA = store.listRecords("kisab-main");
        const recordsOfB = store.listRecords("susankhya-main");
        expect(recordsOfA).toHaveLength(1);
        expect(recordsOfA[0].direction).toBe("worker-to-planner");
        expect(recordsOfA[0].status).toBe("DELIVERED");
        expect(recordsOfB).toHaveLength(0);

        workerB.setMessages([assistantMessage("m_b", "Shipped the payment slice", 2_000)]);
        await waitFor(() => receivedSourceIds(plannerB).length > 0);

        expect(receivedSourceIds(plannerA)).toEqual(["m_a"]);
        expect(receivedSourceIds(plannerB)).toEqual(["m_b"]);
        expect(workerA.sentPlannerMessages).toHaveLength(0);
        expect(store.listRecords("susankhya-main")[0].status).toBe("DELIVERED");
      } finally {
        await orchestrator.stopAll();
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("emits pair-scoped runtime events and stops cleanly", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const logger = new MemorySupervisorLogger();
      const orchestrator = makeOrchestrator(store, twoPairs(), new Map(), logger);

      const events: string[] = [];
      orchestrator.subscribeEvents((event) => events.push(event.type));

      await orchestrator.startAll();
      await orchestrator.stopAll();

      expect(events).toContain("RUNTIME_STARTED");
      expect(events).toContain("RUNTIME_STOPPED");
      expect(events.filter((type) => type === "PAIR_RUNTIME_STARTED")).toHaveLength(2);
      expect(events.filter((type) => type === "PAIR_RUNTIME_STOPPED")).toHaveLength(2);

      const pairEvents = logger.events.filter((event) => event.type === "PAIR_RUNTIME_STARTED");
      expect(pairEvents).toHaveLength(2);
      for (const event of pairEvents) {
        expect(event.pairId).toBeTruthy();
      }
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("persists runtime metadata and requires an explicit start after a restart", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const pairs = twoPairs();
      const first = makeOrchestrator(store, pairs, new Map());
      await first.startAll();
      await first.stopAll();

      const metadataA = store.getRuntimeState("kisab-main");
      expect(metadataA?.runtimeEnabled).toBe(false);
      expect(metadataA?.lastRuntimeStartAt).toBeTruthy();
      expect(metadataA?.lastRuntimeStopAt).toBeTruthy();

      const rebooted = makeOrchestrator(store, pairs, new Map());
      expect(rebooted.getStatus().running).toBe(0);
      for (const pair of pairs) {
        expect(rebooted.getPairStatus(pair.pairId)?.runtimeState).toBe("STOPPED");
      }
      await rebooted.shutdown();
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);

  it("stops cleanly with no leaked loop activity after shutdown", async () => {
    const { store, cleanup } = await freshStore();
    try {
      const ticks = new Map<string, number>();
      const orchestrator = makeOrchestrator(store, twoPairs(), ticks);

      await orchestrator.startAll();
      await waitFor(() => (ticks.get("kisab-main") ?? 0) > 0);
      await orchestrator.shutdown();

      const aAfter = ticks.get("kisab-main") ?? 0;
      const bAfter = ticks.get("susankhya-main") ?? 0;
      await sleep(30);
      expect(ticks.get("kisab-main")).toBe(aAfter);
      expect(ticks.get("susankhya-main")).toBe(bAfter);
    } finally {
      store.close();
      await cleanup();
    }
  }, 20_000);
});

function twoPairs(): SessionPair[] {
  return [
    makePair(),
    makePair({
      pairId: "susankhya-main",
      worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
      planner: {
        type: "chatgpt-browser",
        conversationId: "planner-conversation-2",
        conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
      }
    })
  ];
}

function assistantMessage(id: string, text: string, createdAt: number): RelayableMessage {
  return { id, source: "worker", role: "assistant", text, createdAt };
}

function receivedSourceIds(planner: FakeChatGPTBrowserAdapter): string[] {
  return planner.sentMessages.map(({ message }) => message.id);
}

async function freshStore(): Promise<{ store: RelayStore; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-runtime-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();
  return { store, cleanup: () => rm(directory, { force: true, recursive: true }) };
}

function makeOrchestrator(
  store: RelayStore,
  pairs: SessionPair[],
  tickCounter: Map<string, number>,
  logger = new MemorySupervisorLogger()
): RuntimeOrchestrator {
  return new RuntimeOrchestrator({
    pairs,
    store,
    logger,
    perPairLogs: false,
    pollIntervalMs: 5,
    adapterFor: (pair) => {
      const worker = new TickerWorker(tickCounter, pair.pairId);
      return { worker, planner: new FakeChatGPTBrowserAdapter() };
    }
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(5);
  }
  throw new Error("Timed out waiting for runtime condition.");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function throwingStoreFor(store: RelayStore, failingPairId: string): RelayStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "getSupervisorState") {
        return (pairId: string) => {
          if (pairId === failingPairId) {
            throw new Error("simulated store failure");
          }
          if (typeof value === "function") {
            return (value as (id: string) => never).call(target, pairId);
          }
          return value;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

class TickerWorker extends ControllableWorker {
  private ticks = 0;

  constructor(
    private readonly counter?: Map<string, number>,
    private readonly pairId = "ticker"
  ) {
    super();
  }

  tickCount(): number {
    return this.ticks;
  }

  override async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    const result = await super.observeWorkerSession(worker);
    this.ticks += 1;
    this.counter?.set(this.pairId, this.ticks);
    return result;
  }
}

class GatedWorker extends ControllableWorker {
  blocked = true;
  private firstCall = true;
  private readonly releasedPromise: Promise<void>;

  constructor(private readonly gate: Promise<void>) {
    super();
    this.releasedPromise = gate.then(() => {
      this.blocked = false;
    });
  }

  released(): Promise<void> {
    return this.releasedPromise;
  }

  override async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    if (!this.firstCall) {
      await this.gate;
    }
    this.firstCall = false;
    return super.observeWorkerSession(worker);
  }
}