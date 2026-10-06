import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { StaticOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import { hashText } from "../src/persistence/canonical.js";
import { classifyWorkerMessage } from "../src/relay/message-classifier.js";
import { Supervisor } from "../src/supervisor/supervisor.js";
import type { RelayableMessage, WorkerObservation } from "../src/types.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-planner-question-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();
  return store;
}

describe("classifyWorkerMessage", () => {
  it("classifies an explicit question mark as a question", () => {
    expect(classifyWorkerMessage("The build failed with a type error. Should I fix src/types.ts first?")).toBe("question");
    expect(classifyWorkerMessage("What should I do next?")).toBe("question");
  });

  it("classifies a line-start or in-text question phrase as a question", () => {
    expect(classifyWorkerMessage("Please clarify which approach to use for the pending refactor.")).toBe("question");
    expect(classifyWorkerMessage("I am not sure whether to split this into two modules.")).toBe("question");
  });

  it("does not misclassify ordinary progress reports", () => {
    expect(classifyWorkerMessage("Implemented the sorting module and added tests. All checks pass.")).toBe("report");
    expect(classifyWorkerMessage("All checks pass. Done.")).toBe("report");
    expect(classifyWorkerMessage("")).toBe("report");
  });
});

describe("worker-to-planner question routing", () => {
  it("relays a worker question to the planner exactly once", async () => {
    const store = await openStore();
    const question = assistantMessage("question-1", "Should I fix src/types.ts before refactoring the relay?", 1770000000000);
    const worker = new ScriptedWorkerAdapter([question]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay", stabilityMs: 0 });

    try {
      const first = await supervisor.observeOnce();
      expect(first.relays[0]).toMatchObject({
        direction: "worker-to-planner",
        status: "DELIVERED",
        classification: "question",
        sourceMessage: { id: "question-1" }
      });
      expect(planner.sentMessages).toHaveLength(1);
      expect(planner.sentMessages[0]?.message.id).toBe("question-1");
      expect(store.findRecord(identity("kisab-main", "question-1", question.text))?.classification).toBe("question");

      const second = await supervisor.observeOnce();
      expect(second.relays).toHaveLength(0);
      expect(planner.sentMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("returns the planner answer into the same worker session", async () => {
    const store = await openStore();
    const question = assistantMessage("question-1", "Should I fix src/types.ts before refactoring the relay?", 1770000000000);
    const worker = new ScriptedWorkerAdapter([question]);
    const plannerMessages: RelayableMessage[] = [];
    const planner = new FakeChatGPTBrowserAdapter(plannerMessages);
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay", stabilityMs: 0 });

    try {
      const first = await supervisor.observeOnce();
      expect(first.relays[0]?.classification).toBe("question");
      expect(planner.sentMessages).toHaveLength(1);

      plannerMessages.push({
        id: "answer-1",
        source: "planner",
        role: "assistant",
        text: "Fix src/types.ts first, then rerun the typecheck.",
        createdAt: 1770000660000
      });

      const second = await supervisor.observeOnce();
      expect(second.relays[0]).toMatchObject({
        direction: "planner-to-worker",
        status: "DELIVERED",
        sourceMessage: { id: "answer-1" }
      });
      expect(worker.sentPlannerMessages.at(-1)?.message.id).toBe("answer-1");
    } finally {
      store.close();
    }
  });

  it("does not misclassify or stall an ordinary report", async () => {
    const store = await openStore();
    const report = assistantMessage("report-1", "Implemented the sorting module and added tests. All checks pass.", 1770000000000);
    const worker = new ScriptedWorkerAdapter([report]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay", stabilityMs: 0 });

    try {
      const first = await supervisor.observeOnce();
      expect(first.relays[0]).toMatchObject({
        direction: "worker-to-planner",
        status: "DELIVERED",
        classification: "report"
      });
      expect(planner.sentMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("does not relay the same question twice across repeated observations", async () => {
    const store = await openStore();
    const question = assistantMessage("question-1", "Should I move the classifier into its own module?", 1770000000000);
    const worker = new ScriptedWorkerAdapter([question]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay", stabilityMs: 0 });

    try {
      await supervisor.observeOnce();
      const repeated = await supervisor.observeOnce();
      const again = await supervisor.observeOnce();
      expect(repeated.relays).toHaveLength(0);
      expect(again.relays).toHaveLength(0);
      expect(planner.sentMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("preserves a pending question across pause/resume and routes it on resume", async () => {
    const store = await openStore();
    store.touchSupervisorState({ pairId: "kisab-main", paused: true, lastObservedAt: "2026-08-31T09:00:00.000Z" });
    const question = assistantMessage("question-1", "Should I restructure the persistence layer before the migration?", 1770000000000);
    const worker = new ScriptedWorkerAdapter([question]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay", stabilityMs: 0 });

    try {
      const paused = await supervisor.observeOnce();
      expect(paused.state).toBe("PAUSED");
      expect(paused.relays).toHaveLength(0);
      expect(planner.sentMessages).toHaveLength(0);

      store.touchSupervisorState({ pairId: "kisab-main", paused: false });
      const resumed = await supervisor.observeOnce();
      expect(resumed.relays[0]).toMatchObject({
        direction: "worker-to-planner",
        status: "DELIVERED",
        classification: "question"
      });
      expect(planner.sentMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("does not re-send a stale historical question after a supervisor restart", async () => {
    const store = await openStore();
    store.touchSupervisorState({
      pairId: "kisab-main",
      baselineWorkerMessageId: "historical-question",
      baselineWorkerMessageCreatedAt: 1780000000000,
      lastObservedAt: "2026-08-31T09:00:00.000Z"
    });
    const stale = assistantMessage("stale-question", "Should I rewrite the whole validator?", 1770000000000);
    const worker = new ScriptedWorkerAdapter([stale]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay", stabilityMs: 0 });

    try {
      const first = await supervisor.observeOnce();
      expect(first.relays[0]).toMatchObject({
        direction: "worker-to-planner",
        status: "HELD",
        classification: "question"
      });
      expect(first.relays[0]?.reason).toContain("baseline");
      expect(planner.sentMessages).toHaveLength(0);

      const second = await supervisor.observeOnce();
      expect(second.relays[0]?.status).toBe("HELD");
      expect(planner.sentMessages).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("relays a fresh question that is not covered by the baseline", async () => {
    const store = await openStore();
    store.touchSupervisorState({
      pairId: "kisab-main",
      baselineWorkerMessageId: "historical-question",
      baselineWorkerMessageCreatedAt: 1780000000000,
      lastObservedAt: "2026-08-31T09:00:00.000Z"
    });
    const fresh = assistantMessage("fresh-question", "Should I now split the store into two files?", 1790000000000);
    const worker = new ScriptedWorkerAdapter([fresh]);
    const planner = new FakeChatGPTBrowserAdapter();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, mode: "relay", stabilityMs: 0 });

    try {
      const report = await supervisor.observeOnce();
      expect(report.relays[0]).toMatchObject({
        direction: "worker-to-planner",
        status: "DELIVERED",
        classification: "question"
      });
      expect(planner.sentMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

class ScriptedWorkerAdapter extends StaticOpenCodeAdapter {
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

function assistantMessage(id: string, text: string, createdAt?: number): RelayableMessage {
  return {
    id,
    source: "worker",
    role: "assistant",
    text,
    createdAt
  };
}

function identity(
  pairId: string,
  sourceMessageId: string,
  text: string
): { pairId: string; direction: "worker-to-planner"; sourceMessageId: string; sourceHash: string } {
  return {
    pairId,
    direction: "worker-to-planner",
    sourceMessageId,
    sourceHash: hashText(text)
  };
}