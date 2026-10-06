import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChatGPTBrowserAdapter } from "../../src/adapters/chatgpt/index.js";
import { SqliteRelayStore, type RelayStore } from "../../src/persistence/index.js";
import { MemorySupervisorLogger } from "../../src/supervisor/events.js";
import { Supervisor } from "../../src/supervisor/supervisor.js";
import type {
  PlannerIdentity,
  PlannerObservation,
  RelayableMessage,
  SupervisorState,
  WorkerIdentity,
  WorkerObservation
} from "../../src/types.js";
import { ControllableWorker, makePair } from "../helpers.js";

export interface StalePlannerEvidence {
  cycle1State: SupervisorState;
  cycle2State: SupervisorState;
  cycle2PlannerObserved: boolean;
  cycle2SnapshotConversationReachable: boolean;
  cycle2SnapshotLatestPlannerMessageId: string | undefined;
  cycle3State: SupervisorState;
  cycle3PlannerObserved: boolean;
  plannerObserveCallsAfterCycle2: number;
  plannerObserveCallsAfterCycle3: number;
  events: string[];
}

export async function runStalePlannerRegression(): Promise<StalePlannerEvidence> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-stale-planner-"));
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();

  let now = Date.parse("2026-09-03T10:00:00.000Z");
  const clock = () => new Date(now);
  const advanceClock = (ms: number) => {
    now += ms;
  };

  const pair = makePair();
  pair.planner.readiness = {
    "planner.conversationReachable": "Conversation still loading (planner state A)."
  };

  const worker = new HoldingWorkerAdapter([
    { id: "req-1", source: "planner", role: "user", text: "Implement slice one" }
  ]);
  const planner = new ScriptedChatGPTAdapter([
    { id: "instr-1", source: "planner", role: "assistant", text: "Slice one instruction" }
  ]);
  const logger = new MemorySupervisorLogger();
  const supervisor = new Supervisor({
    pair,
    worker,
    planner,
    store,
    logger,
    clock,
    mode: "relay",
    stabilityMs: 0
  });

  try {
    const cycle1 = await supervisor.observeOnce();
    assert.equal(cycle1.plannerObserved, true, "cycle 1 must observe the planner baseline (state A)");
    assert.equal(cycle1.state, "FAILED", "cycle 1 must classify the unhealthy planner state A");
    assert.equal(cycle1.snapshot.planner.conversationReachable, false, "cycle 1 snapshot must carry state A");
    assert.equal(planner.observeCalls, 1, "cycle 1 must call the planner observer exactly once");
    assert.equal(cycle1.relays.length, 0, "cycle 1 must not relay while the planner is unhealthy");

    const release = deferred();
    const started = deferred();
    worker.armHold(started.resolve, release.promise);
    const observeCallsBeforeCycle2 = planner.observeCalls;

    const cycle2Promise = supervisor.observeOnce();
    await started.promise;
    assert.equal(worker.holdEntered, true, "worker observation must be held pending before mutation");

    pair.planner.readiness = {};
    planner.setMessages([
      { id: "instr-1", source: "planner", role: "assistant", text: "Slice one instruction" },
      { id: "instr-2", source: "planner", role: "assistant", text: "Slice two instruction" }
    ]);
    const mutationProbe = await planner.observePlannerConversation(pair.planner);
    assert.equal(
      mutationProbe.conversationReachable,
      true,
      "planner source must be healthy (state B) while worker observation is held"
    );
    assert.equal(mutationProbe.latestPlannerMessageId, "instr-2", "planner source must expose the new message");

    release.resolve();
    const cycle2 = await cycle2Promise;
    assert.equal(cycle2.snapshot.worker.gathering, true, "released worker observation must still be gathering");
    assert.equal(
      cycle2.plannerObserved,
      true,
      "cycle 2 must refresh the planner when the cached observation is blocking"
    );
    assert.equal(
      cycle2.snapshot.planner.conversationReachable,
      true,
      "cycle 2 must not reuse stale blocking planner health"
    );
    assert.equal(cycle2.snapshot.planner.latestPlannerMessageId, "instr-2", "cycle 2 must observe planner state B");
    assert.equal(cycle2.state, "WORKING", "cycle 2 must classify the gathering worker against healthy planner B");
    assert.equal(cycle2.relays.length, 0, "cycle 2 must not relay while the worker is gathering");
    const plannerObserveCallsAfterCycle2 = planner.observeCalls;
    assert.equal(
      plannerObserveCallsAfterCycle2,
      observeCallsBeforeCycle2 + 2,
      "cycle 2 must add exactly one planner observation (the scenario probe plus the supervisor refresh)"
    );

    advanceClock(5_000);
    const cycle3 = await supervisor.observeOnce();
    assert.equal(
      cycle3.plannerObserved,
      false,
      "cycle 3 must reuse a healthy cached planner observation while the worker is gathering"
    );
    assert.equal(cycle3.state, "WORKING", "cycle 3 must stay WORKING from the healthy cache");
    assert.equal(cycle3.relays.length, 0, "cycle 3 must not relay while the worker is gathering");
    const plannerObserveCallsAfterCycle3 = planner.observeCalls;
    assert.equal(
      plannerObserveCallsAfterCycle3,
      plannerObserveCallsAfterCycle2,
      "a healthy cached planner observation must not trigger an extra planner read on a gathering poll"
    );

    return {
      cycle1State: cycle1.state,
      cycle2State: cycle2.state,
      cycle2PlannerObserved: cycle2.plannerObserved === true,
      cycle2SnapshotConversationReachable: cycle2.snapshot.planner.conversationReachable,
      cycle2SnapshotLatestPlannerMessageId: cycle2.snapshot.planner.latestPlannerMessageId,
      cycle3State: cycle3.state,
      cycle3PlannerObserved: Boolean(cycle3.plannerObserved),
      plannerObserveCallsAfterCycle2,
      plannerObserveCallsAfterCycle3,
      events: logger.events.map((event) => event.type)
    };
  } finally {
    store.close();
    await rm(directory, { force: true, recursive: true });
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class HoldingWorkerAdapter extends ControllableWorker {
  holdEntered = false;
  private notifyStarted: (() => void) | undefined;
  private waitForRelease: Promise<void> | undefined;

  armHold(notifyStarted: () => void, waitForRelease: Promise<void>): void {
    this.holdEntered = false;
    this.notifyStarted = notifyStarted;
    this.waitForRelease = waitForRelease;
  }

  override async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    const notifyStarted = this.notifyStarted;
    const waitForRelease = this.waitForRelease;
    if (notifyStarted && waitForRelease) {
      this.notifyStarted = undefined;
      this.waitForRelease = undefined;
      this.holdEntered = true;
      notifyStarted();
      await waitForRelease;
    }
    return super.observeWorkerSession(worker);
  }
}

class ScriptedChatGPTAdapter extends FakeChatGPTBrowserAdapter {
  observeCalls = 0;
  private script: RelayableMessage[];

  constructor(script: RelayableMessage[] = []) {
    super(script);
    this.script = [...script];
  }

  setMessages(messages: RelayableMessage[]): void {
    this.script = [...messages];
  }

  override async getLatestPlannerMessage(): Promise<RelayableMessage | undefined> {
    return this.script.at(-1);
  }

  override async observePlannerConversation(planner: PlannerIdentity): Promise<PlannerObservation> {
    this.observeCalls += 1;
    const observation = await super.observePlannerConversation(planner);
    const latest = this.script.at(-1);
    return {
      ...observation,
      latestPlannerMessageId: latest?.id,
      latestPlannerMessageCreatedAt: latest?.createdAt
    };
  }
}

if (process.env.VITEST) {
  const { describe, expect, it } = await import("vitest");

  describe("supervisor stale planner recovery", () => {
    it("refreshes blocking cached planner health during worker gathering and keeps healthy caches quiet", async () => {
      const evidence = await runStalePlannerRegression();
      expect(evidence.cycle1State).toBe("FAILED");
      expect(evidence.cycle2State).toBe("WORKING");
      expect(evidence.cycle2PlannerObserved).toBe(true);
      expect(evidence.cycle2SnapshotConversationReachable).toBe(true);
      expect(evidence.cycle2SnapshotLatestPlannerMessageId).toBe("instr-2");
      expect(evidence.cycle3State).toBe("WORKING");
      expect(evidence.cycle3PlannerObserved).toBe(false);
      expect(evidence.plannerObserveCallsAfterCycle3).toBe(evidence.plannerObserveCallsAfterCycle2);
    });
  });
} else {
  const evidence = await runStalePlannerRegression();
  console.log(JSON.stringify(evidence, null, 2));
  console.log("stale-planner regression: PASS");
}
