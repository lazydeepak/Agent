import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter, type ChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { StaticOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import { hashText } from "../src/persistence/canonical.js";
import { relayPlannerToWorker, relayWorkerToPlanner } from "../src/relay/index.js";
import type { ReadinessCheck, RelayReceipt, RelayableMessage } from "../src/types.js";
import { makePair } from "./helpers.js";
import { SubmissionNotAttemptedError } from "../src/relay/delivery-error.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-relay-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();
  return store;
}

describe("relayWorkerToPlanner with persistence", () => {
  it("delivers the first worker message and persists a DELIVERED record", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: "Build the next slice" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    const result = await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });

    expect(result.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(1);

    const record = store.findRecord(
      expectIdentity("kisab-main", "worker-to-planner", "msg_abc", "Build the next slice")
    );
    expect(record?.status).toBe("DELIVERED");
    expect(store.getPairState("kisab-main")?.lastWorkerMessageId).toBe("msg_abc");
    store.close();
  });

  it("skips an identical second attempt as SKIPPED_DUPLICATE without sending again", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: "Build the next slice" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    const first = await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });
    const second = await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });

    expect(first.status).toBe("DELIVERED");
    expect(second.status).toBe("SKIPPED_DUPLICATE");
    expect(planner.sentMessages).toHaveLength(1);
    store.close();
  });

  it("handles the same text but a different stable upstream id as a distinct deliverable", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: "Same text content" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });

    const workerWithNewId = new StaticOpenCodeAdapter([
      { id: "msg_xyz", source: "worker", role: "assistant", text: "Same text content" }
    ]);
    const result = await relayWorkerToPlanner(makePair(), { worker: workerWithNewId, planner }, { persistence: { store } });

    expect(result.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(2);
    store.close();
  });

  it("delivers again when the same message id has changed content", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: "Original content" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });

    const workerChanged = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: "Changed content" }
    ]);
    const result = await relayWorkerToPlanner(makePair(), { worker: workerChanged, planner }, { persistence: { store } });

    expect(result.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(2);
    store.close();
  });

  it("persists a failed delivery and allows a later retry to succeed", async () => {
    const store = await openStore();
    const planner = new FakeChatGPTBrowserAdapter();
    const planText = "Build the next slice";
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: planText }
    ]);

    const failingPlanner = new ThrowingChatGPTBrowserAdapter(new SubmissionNotAttemptedError("composer unavailable"));
    const failed = await relayWorkerToPlanner(makePair(), { worker, planner: failingPlanner }, { persistence: { store } });

    expect(failed.status).toBe("FAILED");
    const record = store.findRecord(expectIdentity("kisab-main", "worker-to-planner", "msg_abc", planText));
    expect(record?.status).toBe("FAILED");
    expect(record?.error).toContain("composer unavailable");

    const retry = await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });
    expect(retry.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(1);
    store.close();
  });

  it("does not blindly resend an ambiguous DELIVERING prior attempt", async () => {
    const store = await openStore();
    const planText = "Build the next slice";
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: planText }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();
    store.createRecord(expectIdentity("kisab-main", "worker-to-planner", "msg_abc", planText));
    store.updateStatus(expectIdentity("kisab-main", "worker-to-planner", "msg_abc", planText), "DELIVERING", {});

    const result = await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });

    expect(result.status).toBe("AMBIGUOUS");
    expect(planner.sentMessages).toHaveLength(0);
    store.close();
  });

  it("--force bypasses duplicate suppression and records a new attempt", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_abc", source: "worker", role: "assistant", text: "Build the next slice" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });
    const forced = await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store }, force: true });

    expect(forced.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(2);
    store.close();
  });
});

describe("relayPlannerToWorker with persistence", () => {
  it("delivers the first planner message and skips the identical second", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter();
    const message: RelayableMessage = {
      id: "cli-100",
      source: "planner",
      role: "user",
      text: "Implement the next small slice"
    };
    const plannerMessage = (id: string): RelayableMessage => ({ ...message, id });

    const first = await relayPlannerToWorker(
      makePair(),
      { worker, planner: new FakeChatGPTBrowserAdapter([plannerMessage("cli-100")]) },
      { persistence: { store } }
    );
    expect(first.status).toBe("DELIVERED");
    expect(worker.sentPlannerMessages).toHaveLength(1);

    const second = await relayPlannerToWorker(
      makePair(),
      { worker, planner: new FakeChatGPTBrowserAdapter([plannerMessage("cli-100")]) },
      { persistence: { store } }
    );
    expect(second.status).toBe("SKIPPED_DUPLICATE");
    expect(worker.sentPlannerMessages).toHaveLength(1);
    store.close();
  });

  it("isolates direction: planner-to-worker does not collide with worker-to-planner", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter([
      { id: "cli-100", source: "worker", role: "assistant", text: "Worker report" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter([
      { id: "cli-100", source: "planner", role: "user", text: "Worker report" }
    ]);

    await relayPlannerToWorker(makePair(), { worker, planner }, { persistence: { store } });
    await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } });

    expect(worker.sentPlannerMessages).toHaveLength(1);
    expect(planner.sentMessages).toHaveLength(1);
    expect(store.listRecords("kisab-main")).toHaveLength(2);
    store.close();
  });
});

function expectIdentity(
  pairId: string,
  direction: "worker-to-planner" | "planner-to-worker",
  sourceMessageId: string,
  text: string
): { pairId: string; direction: "worker-to-planner" | "planner-to-worker"; sourceMessageId: string; sourceHash: string } {
  return {
    pairId,
    direction,
    sourceMessageId,
    sourceHash: hashText(text)
  };
}

class ThrowingChatGPTBrowserAdapter implements ChatGPTBrowserAdapter {
  constructor(private readonly error: Error) {}

  async checkReadiness(): Promise<ReadinessCheck[]> {
    return [];
  }
  async getLatestPlannerMessage(): Promise<RelayableMessage | undefined> {
    return undefined;
  }
  async sendWorkerMessage(): Promise<RelayReceipt> {
    throw this.error;
  }
}

describe("uncertain submission", () => {
  it("blocks retry after an accepted send disconnects, including after reopening the store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-uncertain-"));
    tempDirs.push(directory);
    const path = join(directory, "relay.sqlite");
    let store = new SqliteRelayStore(path);
    await store.init();
    const worker = new StaticOpenCodeAdapter([{ id: "uncertain", source: "worker", role: "assistant", text: "Done" }]);
    const planner = new FakeChatGPTBrowserAdapter();
    let sends = 0;
    planner.sendWorkerMessage = async () => { sends++; throw new Error("Disconnected after acceptance"); };
    try {
      expect((await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } })).status).toBe("AMBIGUOUS");
      expect(store.listRecords("kisab-main")[0]?.status).toBe("DELIVERING");
      store.close();
      store = new SqliteRelayStore(path);
      await store.init();
      expect((await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } })).status).toBe("AMBIGUOUS");
      expect(sends).toBe(1);
    } finally { store.close(); }
  });

  it("does not mark an unconfirmed receipt delivered", async () => {
    const store = await openStore();
    const worker = new StaticOpenCodeAdapter([{ id: "unconfirmed", source: "worker", role: "assistant", text: "Done" }]);
    const planner = new FakeChatGPTBrowserAdapter();
    planner.sendWorkerMessage = async () => ({ pairId: "", sourceMessageId: "unconfirmed", targetId: "target", delivered: false, deliveredAt: "", transport: "test" });
    try {
      expect((await relayWorkerToPlanner(makePair(), { worker, planner }, { persistence: { store } })).status).toBe("AMBIGUOUS");
      expect(store.listRecords("kisab-main")[0]?.status).toBe("DELIVERING");
    } finally { store.close(); }
  });
});

describe("relay attempt cap", () => {
  it("refuses to re-attempt a FAILED identity that has exhausted its cap", async () => {
    const store = await openStore();
    const pair = makePair();
    const planner = new FakeChatGPTBrowserAdapter();
    // A worker message that has a persisted FAILED record with an exhausted attempt count.
    let plannerMock: FakeChatGPTBrowserAdapter;

    // Pre-populate the ledger directly (as a long-ago delivery loop would leave it).
    const identity = {
      pairId: pair.pairId,
      direction: "worker-to-planner" as const,
      sourceMessageId: "msg_bad",
      sourceHash: hashText("boom")
    };
    store.createRecord(identity, Date.now());
    // Bump attempt_count beyond the cap without delivering.
    for (let i = 0; i < 22; i += 1) {
      store.updateStatus(identity, i === 0 ? "FAILED" : "FAILED", { error: "flaky" });
    }

    const deps = {
      worker: new StaticOpenCodeAdapter([
        { id: "msg_bad", source: "worker", role: "assistant", text: "boom" }
      ]),
      planner
    };
    const result = await relayWorkerToPlanner(pair, deps, { persistence: { store } });

    expect(result.status).toBe("HELD");
    expect(result.reason).toMatch(/cap 20/);
    expect(planner.sentMessages).toHaveLength(0);
  });
});
