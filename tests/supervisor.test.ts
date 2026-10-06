import { SubmissionNotAttemptedError } from "../src/relay/delivery-error.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { StaticOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import { ChatGptSubmissionGate } from "../src/relay/chatgpt-gate.js";
import { MemorySupervisorLogger, type SupervisorEvent } from "../src/supervisor/events.js";
import { Supervisor } from "../src/supervisor/supervisor.js";
import type { PlannerIdentity, PlannerObservation, RelayableMessage, RelayReceipt, WorkerObservation } from "../src/types.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];
let now = Date.parse("2026-08-31T10:00:00.000Z");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-supervisor-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();
  return store;
}

function clock(): () => Date {
  return () => new Date(now);
}

function advanceClock(ms: number): void {
  now += ms;
}

describe("Supervisor", () => {
  for (const [text, state] of [["RELAY_COMPLETE\nFinished the bounded task.", "COMPLETED"], ["**RELAY_BLOCKED**\nCredentials required.", "FAILED"]] as const) {
    it(`honors ${state} planner control without feeding it back to the worker`, async () => {
      const store = await openStore();
      const worker = new StaticOpenCodeAdapter();
      const planner = new FakeChatGPTBrowserAdapter([{ id: "control", source: "planner", role: "assistant", text }]);
      try {
        const report = await new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay" }).observeOnce();
        expect(report.state).toBe(state);
        expect(report.relays).toHaveLength(0);
        expect(worker.sentPlannerMessages).toHaveLength(0);
      } finally { store.close(); }
    });
  }
  it("does not swallow a planner reply that arrives during worker-report submission", async () => {
    const store = await openStore();
    const messages: RelayableMessage[] = [{ id: "prior", source: "planner", role: "assistant", text: "Prior instruction" }];
    const planner = new FakeChatGPTBrowserAdapter(messages);
    const send = planner.sendWorkerMessage.bind(planner);
    planner.sendWorkerMessage = async (identity, message) => {
      const receipt = await send(identity, message);
      messages.push({ id: "fast-reply", source: "planner", role: "assistant", text: "Next instruction" });
      return receipt;
    };
    store.touchSupervisorState({ pairId: "kisab-main", lastPlannerSideSyncedMessageId: "prior" });
    const worker = new StaticOpenCodeAdapter([assistantMessage("report", "Done")]);
    const supervisor = new Supervisor({ pair: makePair(), store, planner, worker, mode: "relay", stabilityMs: 0 });
    try {
      expect((await supervisor.observeOnce()).relays[0]?.status).toBe("DELIVERED");
      expect(store.getSupervisorState("kisab-main")?.lastPlannerSideSyncedMessageId).toBe("prior");
      expect((await supervisor.observeOnce()).relays[0]?.sourceMessage?.id).toBe("fast-reply");
      expect(worker.sentPlannerMessages).toHaveLength(1);
    } finally { store.close(); }
  });
  it("blocks both relay directions while any delivery remains uncertain", async () => {
    const store = await openStore();
    const identity = { pairId: "kisab-main", direction: "worker-to-planner" as const,
      sourceMessageId: "uncertain-report", sourceHash: "uncertain-hash" };
    store.createRecord(identity);
    store.updateStatus(identity, "DELIVERING", {});
    const planner = new FakeChatGPTBrowserAdapter([{ id: "new-instruction", source: "planner", role: "assistant", text: "Continue" }]);
    const worker = new StaticOpenCodeAdapter();
    const supervisor = new Supervisor({ pair: makePair(), store, planner, worker, mode: "relay" });
    try {
      const report = await supervisor.observeOnce();
      expect(report.state).toBe("FAILED");
      expect(report.reason).toContain("reconciliation");
      expect(report.relays).toHaveLength(0);
      expect(worker.sentPlannerMessages).toHaveLength(0);
      expect(planner.sentMessages).toHaveLength(0);
    } finally { store.close(); }
  });
  it("observes read-only by default, persists continuity, and only emits one state change", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([assistantMessage("report-1", "Build the next slice")]);
    const planner = new FakeChatGPTBrowserAdapter();
    const logger = new MemorySupervisorLogger();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      logger,
      clock: clock(),
      mode: "observe",
      stabilityMs: 0
    });

    const first = await supervisor.observeOnce();
    expect(first.state).toBe("WORKING");
    expect(first.relays).toHaveLength(0);
    expect(planner.sentMessages).toHaveLength(0);
    expect(store.getSupervisorState("kisab-main")?.lastSupervisorState).toBe("WORKING");

    const second = await supervisor.observeOnce();
    expect(second.state).toBe("WORKING");
    expect(planner.sentMessages).toHaveLength(0);
    expect(logger.events.filter((event) => event.type === "STATE_CHANGED")).toHaveLength(1);
    store.close();
  });

  it("relays a new worker report exactly once, then skips subsequent observes", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([assistantMessage("report-1", "Build the next slice")]);
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
      stabilityMs: 0

    });

    const first = await supervisor.observeOnce();
    expect(first.relays).toHaveLength(1);
    expect(first.relays[0]?.status).toBe("DELIVERED");
    expect(first.state).toBe("IDLE");
    expect(planner.sentMessages).toHaveLength(1);

    const second = await supervisor.observeOnce();
    expect(second.relays).toHaveLength(0);
    expect(second.state).toBe("IDLE");
    expect(planner.sentMessages).toHaveLength(1);
    expect(worker.sentPlannerMessages).toHaveLength(0);
    store.close();
  });

  it("does not relay an older report while the worker is mid-task", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([
      assistantMessage("report-1", "Build the next slice"),
      { source: "planner", id: "req-2", role: "user", text: "New instruction" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0

    });

    const report = await supervisor.observeOnce();
    expect(report.state).toBe("WORKING");
    expect(report.relays).toHaveLength(0);
    expect(planner.sentMessages).toHaveLength(0);
    store.close();
  });

  it("relays a new worker report as progress and delivers a second report", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([assistantMessage("report-1", "First slice")]);
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
      stabilityMs: 0

    });

    const first = await supervisor.observeOnce();
    expect(first.relays[0]?.sourceMessage?.id).toBe("report-1");

    advanceClock(60_000);
    worker.setMessages([assistantMessage("report-1", "First slice"), assistantMessage("report-2", "Second slice")]);

    const second = await supervisor.observeOnce();
    expect(second.relays[0]?.sourceMessage?.id).toBe("report-2");
    expect(planner.sentMessages).toHaveLength(2);
    store.close();
  });

  it("relays a new planner instruction into the worker exactly once", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter();
    const planner = new FakeChatGPTBrowserAdapter([
      { source: "planner", id: "instr-1", role: "user", text: "Implement the next slice" }
    ]);
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0

    });

    const first = await supervisor.observeOnce();
    expect(first.relays).toHaveLength(1);
    expect(first.relays[0]?.direction).toBe("planner-to-worker");
    expect(first.relays[0]?.status).toBe("DELIVERED");
    expect(worker.sentPlannerMessages).toHaveLength(1);

    const second = await supervisor.observeOnce();
    expect(second.relays).toHaveLength(0);
    expect(worker.sentPlannerMessages).toHaveLength(1);
    store.close();
  });

  it("relays only the completed worker response attributed to the dispatched planner instruction", async () => {
    const store = await openStore();
    const worker = new AttributedOpenCodeAdapter();
    const planner = new FakeChatGPTBrowserAdapter([
      { source: "planner", id: "instr-attributed", role: "user", text: "Implement the next slice" }
    ]);
    const supervisor = new Supervisor({
      pair: makePair(), worker, planner, store, clock: clock(), mode: "relay", stabilityMs: 60_000
    });

    const dispatched = await supervisor.observeOnce();
    expect(dispatched.relays[0]?.direction).toBe("planner-to-worker");
    expect(store.getCycleByPlannerSource("kisab-main", "instr-attributed")).toMatchObject({
      workerDispatchMessageId: "dispatch-attributed",
      cycleStatus: "DISPATCHED"
    });

    worker.response = assistantMessage("response-attributed", "Completed result");
    const delivered = await supervisor.observeOnce();
    expect(delivered.relays[0]).toMatchObject({
      direction: "worker-to-planner",
      status: "DELIVERED",
      sourceMessage: { id: "response-attributed" }
    });
    expect(planner.sentMessages.at(-1)?.message.id).toBe("response-attributed");
    expect(store.getCycleByPlannerSource("kisab-main", "instr-attributed")).toMatchObject({
      workerResponseMessageId: "response-attributed",
      cycleStatus: "DELIVERED"
    });
    store.close();
  });

  it("marks an attributed worker provider error FAILED instead of waiting forever", async () => {
    const store = await openStore();
    const worker = new AttributedOpenCodeAdapter();
    const planner = new FakeChatGPTBrowserAdapter([
      { source: "planner", id: "instr-failing", role: "user", text: "Implement" }
    ]);
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, clock: clock(), mode: "relay", stabilityMs: 0 });
    await supervisor.observeOnce();
    worker.failure = "Provider request failed with HTTP 429";
    const failed = await supervisor.observeOnce();
    expect(failed.state).toBe("FAILED");
    expect(failed.relays).toHaveLength(0);
    expect(store.getCycleByPlannerSource("kisab-main", "instr-failing")?.cycleStatus).toBe("FAILED");
    store.close();
  });

  it("does not relay anything while the pair is paused", async () => {
    const store = await openStore();
    store.touchSupervisorState({ pairId: "kisab-main", paused: true });
    const worker = new ScriptedOpenCodeAdapter([assistantMessage("report-1", "Build the next slice")]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0

    });

    const report = await supervisor.observeOnce();
    expect(report.state).toBe("PAUSED");
    expect(report.relays).toHaveLength(0);
    expect(planner.sentMessages).toHaveLength(0);
    expect(worker.sentPlannerMessages).toHaveLength(0);
    store.close();
  });

  it("allows the first submission, then holds a second report behind the throttle until the interval passes", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([assistantMessage("report-1", "Build the next slice")]);
    const planner = new FakeChatGPTBrowserAdapter();
    const gate = new ChatGptSubmissionGate({
      minIntervalMs: 30_000,
      backoffInitialMs: 30_000,
      now: () => now,
      sleep: async () => {}
    });
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0,
      chatgptGate: gate
    });

    const first = await supervisor.observeOnce();
    expect(first.relays[0]?.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(1);

    advanceClock(10_000);
    worker.setMessages([assistantMessage("report-1", "First slice"), assistantMessage("report-2", "Second slice")]);
    const held = await supervisor.observeOnce();
    expect(held.relays[0]?.status).toBe("HELD");
    expect(planner.sentMessages).toHaveLength(1);

    advanceClock(25_000);
    const delivered = await supervisor.observeOnce();
    expect(delivered.relays[0]?.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(2);
    store.close();
  });

  it("enters bounded backoff on a rate-limited submission and recovers after the backoff", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([assistantMessage("report-1", "Build the next slice")]);
    const planner = new RateLimitedChatGPTBrowserAdapter();
    const gate = new ChatGptSubmissionGate({
      minIntervalMs: 30_000,
      backoffInitialMs: 30_000,
      backoffMaxMs: 30_000,
      now: () => now,
      sleep: async () => {}
    });
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0,
      chatgptGate: gate
    });

    advanceClock(30_000);
    const first = await supervisor.observeOnce();
    expect(first.relays[0]?.status).toBe("FAILED");
    expect(planner.attempts).toBe(1);

    advanceClock(10_000);
    const held = await supervisor.observeOnce();
    expect(held.relays[0]?.status).toBe("RATE_LIMITED");
    expect(planner.attempts).toBe(1);

    advanceClock(30_000);
    const recovered = await supervisor.observeOnce();
    expect(recovered.relays[0]?.status).toBe("DELIVERED");
    expect(planner.attempts).toBe(2);
    store.close();
  });

  it("stops polling the ChatGPT conversation while the worker is gathering", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([
      { source: "planner", id: "req-1", role: "user", text: "Implement slice one" }
    ]);
    const planner = new CountingChatGPTBrowserAdapter();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0
    });

    const first = await supervisor.observeOnce();
    expect(first.plannerObserved).toBe(true);
    expect(planner.observeCalls).toBe(1);

    advanceClock(5_000);
    const second = await supervisor.observeOnce();
    expect(second.plannerObserved).toBe(false);
    expect(planner.observeCalls).toBe(1);
    store.close();
  });

  it("re-observes the ChatGPT conversation once the worker stops gathering", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([
      { source: "planner", id: "req-1", role: "user", text: "Implement slice one" },
      assistantMessage("report-1", "Done with slice one")
    ]);
    const planner = new CountingChatGPTBrowserAdapter();
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "relay",
      stabilityMs: 0
    });

    const first = await supervisor.observeOnce();
    expect(first.plannerObserved).toBe(true);
    expect(planner.observeCalls).toBe(1);

    advanceClock(10_000);
    const relayed = await supervisor.observeOnce();
    expect(relayed.plannerObserved).toBe(true);
    expect(planner.observeCalls).toBe(2);
    store.close();
  });

  it("treats the first observation as a silent baseline, then emits session and message deltas", async () => {
    const store = await openStore();
    const worker = new ScriptedOpenCodeAdapter([assistantMessage("report-1", "First slice")]);
    const planner = new FakeChatGPTBrowserAdapter();
    const forwarded: SupervisorEvent[] = [];
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "observe",
      stabilityMs: 0,
      onEvent: (event) => forwarded.push(event)
    });

    await supervisor.observeOnce();
    expect(forwarded.map((event) => event.type)).not.toContain("WORKER_MESSAGE_OBSERVED");

    advanceClock(60_000);
    worker.setMessages([assistantMessage("report-1", "First slice"), assistantMessage("report-2", "Second slice")]);
    await supervisor.observeOnce();

    const messageEvent = forwarded.find((event) => event.type === "WORKER_MESSAGE_OBSERVED");
    expect(messageEvent?.details).toMatchObject({
      messageId: "report-2"
    });
    store.close();
  });

  it("emits a session disconnect when the worker becomes unreachable and reconnect when it returns", async () => {
    const store = await openStore();
    const worker = new FilteringOpenCodeAdapter(true);
    const planner = new FakeChatGPTBrowserAdapter();
    const forwarded: SupervisorEvent[] = [];
    const supervisor = new Supervisor({
      pair: makePair(),
      worker,
      planner,
      store,
      clock: clock(),
      mode: "observe",
      stabilityMs: 0,
      onEvent: (event) => forwarded.push(event)
    });

    await supervisor.observeOnce();
    expect(forwarded.map((event) => event.type)).not.toContain("WORKER_SESSION_DISCONNECTED");

    worker.setReachable(false);
    advanceClock(60_000);
    await supervisor.observeOnce();
    expect(forwarded.map((event) => event.type)).toContain("WORKER_SESSION_DISCONNECTED");

    worker.setReachable(true);
    advanceClock(60_000);
    await supervisor.observeOnce();
    expect(forwarded.map((event) => event.type)).toContain("WORKER_SESSION_CONNECTED");
    store.close();
  });
});

function assistantMessage(id: string, text: string): RelayableMessage {
  return {
    id,
    source: "worker",
    role: "assistant",
    text
  };
}

class ScriptedOpenCodeAdapter extends StaticOpenCodeAdapter {
  private script: RelayableMessage[];

  constructor(script: RelayableMessage[] = []) {
    super(script);
    this.script = script;
  }

  setMessages(messages: RelayableMessage[]): void {
    this.script = messages;
  }

  override async getLatestAssistantMessage(): Promise<RelayableMessage | undefined> {
    return [...this.script].reverse().find((message) => message.role === "assistant");
  }

  override async observeWorkerSession(): Promise<WorkerObservation> {
    const latest = this.script.at(-1);
    const assistant = [...this.script].reverse().find((message) => message.role === "assistant");

    return {
      reachable: true,
      sessionExists: true,
      sessionActive: true,
      gathering: latest?.role === "user",
      latestMessageId: latest?.id,
      latestMessageRole: latest?.role === "user" || latest?.role === "assistant" ? latest.role : undefined,
      latestMessageCreatedAt: latest?.createdAt,
      lastAssistantMessageId: assistant?.id,
      lastAssistantMessageCreatedAt: assistant?.createdAt,
      detail: []
    };
  }
}

class RateLimitedChatGPTBrowserAdapter extends FakeChatGPTBrowserAdapter {
  attempts = 0;
  failNext = true;

  override async sendWorkerMessage(planner: PlannerIdentity, message: RelayableMessage): Promise<RelayReceipt> {
    this.attempts += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new SubmissionNotAttemptedError("ChatGPT hit a temporary rate limit; you're making requests too quickly.");
    }
    return super.sendWorkerMessage(planner, message);
  }
}

class FilteringOpenCodeAdapter extends ScriptedOpenCodeAdapter {
  private reachableState = true;

  constructor(reachable: boolean) {
    super();
    this.reachableState = reachable;
  }

  setReachable(reachable: boolean): void {
    this.reachableState = reachable;
  }

  override async observeWorkerSession(): Promise<WorkerObservation> {
    const observation = await super.observeWorkerSession();
    return { ...observation, reachable: this.reachableState };
  }
}

class AttributedOpenCodeAdapter extends ScriptedOpenCodeAdapter {
  response?: RelayableMessage;
  failure?: string;
  dispatched = false;

  override async sendPlannerMessage(_worker: Parameters<StaticOpenCodeAdapter["sendPlannerMessage"]>[0], message: RelayableMessage) {
    this.dispatched = true;
    return {
      pairId: "",
      sourceMessageId: message.id,
      targetId: "dispatch-attributed",
      workerDispatchMessageId: "dispatch-attributed",
      delivered: true,
      deliveredAt: new Date(now).toISOString(),
      transport: "test"
    };
  }

  override async getAssistantResponseForDispatch(): Promise<RelayableMessage | undefined> {
    return this.response;
  }

  async getDispatchFailure(): Promise<string | undefined> {
    return this.failure;
  }

  override async observeWorkerSession(): Promise<WorkerObservation> {
    const response = this.response;
    return {
      reachable: true,
      sessionExists: true,
      sessionActive: Boolean(response),
      gathering: this.dispatched && !response && !this.failure,
      latestMessageId: response?.id ?? (this.dispatched ? "dispatch-attributed" : undefined),
      latestMessageRole: response ? "assistant" : (this.dispatched ? "user" : undefined),
      latestMessageCreatedAt: response?.createdAt,
      lastAssistantMessageId: response?.id,
      lastAssistantMessageCreatedAt: response?.createdAt,
      detail: []
    };
  }
}

class CountingChatGPTBrowserAdapter extends FakeChatGPTBrowserAdapter {
  observeCalls = 0;

  override async observePlannerConversation(planner: PlannerIdentity): Promise<PlannerObservation> {
    this.observeCalls += 1;
    return super.observePlannerConversation(planner);
  }
}
