import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRelayStore } from "../src/persistence/store.js";
import { canonicalizeText, hashText } from "../src/persistence/canonical.js";
import { canonicalRelayIdentity } from "../src/persistence/canonical.js";
import type { CanonicalRelayIdentity } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function freshStore(): Promise<{ dbPath: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-store-"));
  tempDirs.push(directory);
  const dbPath = join(directory, "agent-relay.sqlite");
  return { dbPath, cleanup: () => rm(directory, { force: true, recursive: true }) };
}

const identity = (overrides: Partial<CanonicalRelayIdentity> = {}): CanonicalRelayIdentity => ({
  pairId: "kisab-main",
  direction: "worker-to-planner",
  sourceMessageId: "msg_abc",
  sourceHash: hashText("Build the next slice"),
  ...overrides
});

describe("canonical text hashing", () => {
  it("normalizes line endings before hashing", () => {
    expect(canonicalizeText("a\r\nb\r\nc")).toBe("a\nb\nc");
    expect(hashText("a\r\nb")).toBe(hashText("a\nb"));
  });

  it("trims insignificant whitespace and collapses blank runs", () => {
    expect(canonicalizeText("  hello   \n\n\nworld  ")).toBe("hello\n\nworld");
    expect(hashText("hello\n\nworld")).toBe(hashText("  hello   \n\n\nworld  "));
  });

  it("is deterministic across calls and processes", () => {
    expect(hashText("same text")).toBe(hashText("same text"));
    expect(hashText("same text")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not include timestamps in the hash", () => {
    expect(hashText("message body")).toBe(hashText("message body"));
  });
});

describe("SqliteRelayStore schema", () => {
  it("initializes schema idempotently", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const first = new SqliteRelayStore(dbPath);
      await first.init();
      await first.init();
      first.close();

      const second = new SqliteRelayStore(dbPath);
      await second.init();
      expect(() => second.close()).not.toThrow();
    } finally {
      await cleanup();
    }
  });

  it("fails with an actionable error for a corrupted/invalid DB file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-corrupt-"));
    tempDirs.push(directory);
    const dbPath = join(directory, "agent-relay.sqlite");
    await writeFile(dbPath, "this is not a sqlite database", "utf8");

    const store = new SqliteRelayStore(dbPath);
    await expect(store.init()).rejects.toThrow(/invalid or corrupted/i);
    store.close();
  });

  it("additively migrates a v4 database to v5, preserving existing rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-migrate-"));
    tempDirs.push(directory);
    const dbPath = join(directory, "agent-relay.sqlite");

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE relay_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pair_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        source_timestamp INTEGER,
        target_id TEXT,
        status TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        delivered_at TEXT,
        last_attempt_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE TABLE pair_state (
        pair_id TEXT PRIMARY KEY,
        last_worker_message_id TEXT,
        last_planner_message_id TEXT,
        last_successful_relay_at TEXT,
        last_direction TEXT,
        last_error TEXT
      );
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      CREATE TABLE supervisor_state (pair_id TEXT PRIMARY KEY);
      CREATE TABLE runtime_state (
        pair_id TEXT PRIMARY KEY,
        runtime_enabled INTEGER NOT NULL DEFAULT 0,
        last_runtime_start_at TEXT,
        last_runtime_stop_at TEXT,
        last_runtime_error TEXT
      );
      INSERT INTO schema_version (version) VALUES (4);
      INSERT INTO runtime_state (pair_id, runtime_enabled) VALUES ('kisab-main', 1);
      INSERT INTO relay_records
        (pair_id, direction, source_message_id, source_hash, status, first_seen_at)
        VALUES ('kisab-main', 'worker-to-planner', 'msg_abc', 'hash-1', 'DELIVERED', '2026-01-01T00:00:00.000Z');
    `);
    legacy.close();

    const store = new SqliteRelayStore(dbPath);
    await store.init();

    const migrated = store.getRuntimeState("kisab-main");
    expect(migrated?.runtimeEnabled).toBe(true);
    expect(migrated?.schedulerMode).toBeUndefined();

    store.touchSchedulerMode({ pairId: "kisab-main", schedulerMode: "DORMANT_WATCH" });
    expect(store.getRuntimeState("kisab-main")?.schedulerMode).toBe("DORMANT_WATCH");

    expect(store.listRecords("kisab-main")).toHaveLength(1);
    store.close();
  });
});

describe("SqliteRelayStore ledger", () => {
  it("creates and finds a DISCOVERED record by canonical identity", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      const created = store.createRecord(identity(), 1234);
      expect(created).toMatchObject({
        pairId: "kisab-main",
        direction: "worker-to-planner",
        sourceMessageId: "msg_abc",
        status: "DISCOVERED",
        attemptCount: 0,
        sourceTimestamp: 1234
      });

      const found = store.findRecord(identity());
      expect(found?.id).toBe(created.id);
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("tracks delivery status transitions and attempt counts", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createRecord(identity());
      store.updateStatus(identity(), "DELIVERING", {});
      store.recordDelivered(identity(), "conversation-1");

      const final = store.findRecord(identity());
      expect(final?.status).toBe("DELIVERED");
      expect(final?.deliveredAt).toBeTruthy();
      expect(final?.targetId).toBe("conversation-1");
      expect(final?.attemptCount).toBe(2);
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("persists failures with an error message", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createRecord(identity());
      store.recordFailure(identity(), "composer unavailable");

      const record = store.findRecord(identity());
      expect(record?.status).toBe("FAILED");
      expect(record?.error).toBe("composer unavailable");
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("isolates records by pair and direction", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();

      store.createRecord(identity());
      store.recordDelivered(identity(), "conv-a");

      const otherPair = identity({ pairId: "kisab-secondary" });
      store.createRecord(otherPair);
      store.recordDelivered(otherPair, "conv-b");

      const otherDirection = identity({ direction: "planner-to-worker" });
      store.createRecord(otherDirection);
      store.recordDelivered(otherDirection, "ses_worker_1");

      expect(store.findRecord(identity())?.status).toBe("DELIVERED");
      expect(store.findRecord(otherPair)?.targetId).toBe("conv-b");
      expect(store.findRecord(otherDirection)?.targetId).toBe("ses_worker_1");
      expect(store.listRecords("kisab-main")).toHaveLength(2);
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("restart/new process instance still sees prior delivery state", async () => {
    const { dbPath } = await freshStore();
    const first = new SqliteRelayStore(dbPath);
    await first.init();
    first.createRecord(identity());
    first.recordDelivered(identity(), "conversation-1");
    first.close();

    const second = new SqliteRelayStore(dbPath);
    await second.init();
    const record = second.findRecord(identity());
    expect(record?.status).toBe("DELIVERED");
    expect(record?.targetId).toBe("conversation-1");
    second.close();
  });

  it("records and reads pair runtime metadata", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.touchPairState({ pairId: "kisab-main", lastWorkerMessageId: "msg_abc" });
      store.touchPairState({ pairId: "kisab-main", lastDirection: "worker-to-planner" });

      const state = store.getPairState("kisab-main");
      expect(state).toMatchObject({
        pairId: "kisab-main",
        lastWorkerMessageId: "msg_abc",
        lastDirection: "worker-to-planner"
      });
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("detects a changed content hash for the same message id as a distinct record", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createRecord(identity());
      store.recordDelivered(identity(), "conv-a");

      const changed = identity({ sourceHash: hashText("Build a different slice") });
      store.createRecord(changed);

      expect(store.listRecords("kisab-main")).toHaveLength(2);
      store.close();
    } finally {
      await cleanup();
    }
  });
});

describe("scheduler mode persistence", () => {
  it("round-trips scheduler mode, change timestamp, and dormant reason", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.touchSchedulerMode({
        pairId: "kisab-main",
        schedulerMode: "DORMANT_WATCH",
        changedAt: "2026-01-01T00:00:00.000Z",
        dormantReason: "EXTENDED_IDLE"
      });

      const state = store.getRuntimeState("kisab-main");
      expect(state).toMatchObject({
        pairId: "kisab-main",
        schedulerMode: "DORMANT_WATCH",
        schedulerModeChangedAt: "2026-01-01T00:00:00.000Z",
        dormantReason: "EXTENDED_IDLE"
      });
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("switching to ACTIVE clears the dormant reason", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.touchSchedulerMode({
        pairId: "kisab-main",
        schedulerMode: "DORMANT_WATCH",
        dormantReason: "EXTENDED_IDLE"
      });
      store.touchSchedulerMode({
        pairId: "kisab-main",
        schedulerMode: "ACTIVE"
      });

      const state = store.getRuntimeState("kisab-main");
      expect(state?.schedulerMode).toBe("ACTIVE");
      expect(state?.dormantReason).toBeUndefined();
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("persists scheduler mode across reopen/restart", async () => {
    const { dbPath } = await freshStore();
    const first = new SqliteRelayStore(dbPath);
    await first.init();
    first.touchSchedulerMode({
      pairId: "kisab-main",
      schedulerMode: "DORMANT_WATCH",
      dormantReason: "WORKER_FAILED"
    });
    first.close();

    const second = new SqliteRelayStore(dbPath);
    await second.init();
    const state = second.getRuntimeState("kisab-main");
    expect(state?.schedulerMode).toBe("DORMANT_WATCH");
    expect(state?.dormantReason).toBe("WORKER_FAILED");
    second.close();
  });

  it("returns undefined scheduler mode for an untouched runtime_state entry", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.touchRuntimeState({ pairId: "kisab-main", runtimeEnabled: true });

      const state = store.getRuntimeState("kisab-main");
      expect(state?.schedulerMode).toBeUndefined();
      expect(state?.schedulerModeChangedAt).toBeUndefined();
      store.close();
    } finally {
      await cleanup();
    }
  });
});

describe("pair data purge", () => {
  it("removes all of the removed pair's rows and leaves other pairs untouched", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();

      store.createRecord(identity());
      store.recordDelivered(identity(), "conv-a");
      store.createCycle({
        pairId: "kisab-main",
        plannerSourceMessageId: "chat-1",
        workerDispatchMessageId: "opencode-user-1"
      });
      store.touchPairState({ pairId: "kisab-main", lastWorkerMessageId: "msg_abc" });
      store.touchSupervisorState({ pairId: "kisab-main", lastSupervisorState: "IDLE" });
      store.touchRuntimeState({ pairId: "kisab-main", runtimeEnabled: false });

      store.createRecord(identity({ pairId: "b-main", sourceMessageId: "msg_b" }));
      store.touchPairState({ pairId: "b-main", lastWorkerMessageId: "msg_b" });
      store.touchRuntimeState({ pairId: "b-main", runtimeEnabled: false });

      store.purgePairData("kisab-main");

      expect(store.getPairState("kisab-main")).toBeUndefined();
      expect(store.getSupervisorState("kisab-main")).toBeUndefined();
      expect(store.getRuntimeState("kisab-main")).toBeUndefined();
      expect(store.listRecords("kisab-main")).toHaveLength(0);
      expect(store.listCycles("kisab-main")).toHaveLength(0);
      expect(store.listAllPairIds()).toEqual(["b-main"]);

      expect(store.getPairState("b-main")?.lastWorkerMessageId).toBe("msg_b");
      expect(store.findRecord(identity({ pairId: "b-main", sourceMessageId: "msg_b" }))?.status).toBe("DISCOVERED");

      store.close();
    } finally {
      await cleanup();
    }
  });

  it("rolls back on a failed purge", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createRecord(identity());
      store.touchRuntimeState({ pairId: "kisab-main", runtimeEnabled: false });
      store.touchPairState({ pairId: "kisab-main", lastWorkerMessageId: "msg_abc" });

      const rawDb = (store as unknown as { db: DatabaseSync }).db;
      rawDb.exec("DROP TABLE relay_records;");
      expect(() => store.purgePairData("kisab-main")).toThrow();

      expect(store.getRuntimeState("kisab-main")).toBeDefined();
      expect(store.getPairState("kisab-main")).toBeDefined();

      store.close();
    } finally {
      await cleanup();
    }
  });
});

describe("resume state persistence", () => {
  it("round-trips the resume-after-restart flag per pair", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      expect(store.listResumeState()).toEqual([]);

      store.touchResumeState({ pairId: "kisab-main", resumeAfterRestart: true });
      store.touchResumeState({ pairId: "b-main", resumeAfterRestart: false });

      expect(store.listResumeState()).toEqual([{ pairId: "kisab-main", resumeAfterRestart: true }]);
      expect(store.getRuntimeState("kisab-main")?.resumeAfterRestart).toBe(true);
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("clearing resume after restart removes the pair from the resume list", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.touchResumeState({ pairId: "kisab-main", resumeAfterRestart: true });
      store.touchResumeState({ pairId: "kisab-main", resumeAfterRestart: false });
      expect(store.listResumeState()).toEqual([]);
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("persists the resume flag across reopen/restart", async () => {
    const { dbPath } = await freshStore();
    const first = new SqliteRelayStore(dbPath);
    await first.init();
    first.touchResumeState({ pairId: "kisab-main", resumeAfterRestart: true });
    first.close();

    const second = new SqliteRelayStore(dbPath);
    await second.init();
    expect(second.listResumeState()).toEqual([{ pairId: "kisab-main", resumeAfterRestart: true }]);
    second.close();
  });
});

describe("relay cycle persistence", () => {
  it("creates a cycle and reads it back by planner source and worker dispatch", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createCycle({
        pairId: "kisab-main",
        plannerSourceMessageId: "chat-1",
        workerDispatchMessageId: "opencode-user-1",
        dispatchedAt: "2026-01-01T00:00:00.000Z"
      });

      const byPlanner = store.getCycleByPlannerSource("kisab-main", "chat-1");
      expect(byPlanner).toMatchObject({
        pairId: "kisab-main",
        plannerSourceMessageId: "chat-1",
        workerDispatchMessageId: "opencode-user-1",
        dispatchedAt: "2026-01-01T00:00:00.000Z",
        cycleStatus: "DISPATCHED"
      });

      const byWorker = store.getCycleByWorkerDispatch("kisab-main", "opencode-user-1");
      expect(byWorker?.id).toBe(byPlanner?.id);
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("updates a cycle with the worker response and delivery completion", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createCycle({
        pairId: "kisab-main",
        plannerSourceMessageId: "chat-1",
        workerDispatchMessageId: "opencode-user-1"
      });

      const updated = store.updateCycle("kisab-main", "chat-1", {
        workerResponseMessageId: "opencode-assistant-1",
        workerCompletedAt: "2026-01-01T00:01:00.000Z",
        plannerDeliveryRecordId: 42,
        cycleStatus: "DELIVERED"
      });

      expect(updated).toMatchObject({
        workerResponseMessageId: "opencode-assistant-1",
        workerCompletedAt: "2026-01-01T00:01:00.000Z",
        plannerDeliveryRecordId: 42,
        cycleStatus: "DELIVERED"
      });
      store.close();
    } finally {
      await cleanup();
    }
  });

  it("persists cycles across reopen/restart", async () => {
    const { dbPath } = await freshStore();
    const first = new SqliteRelayStore(dbPath);
    await first.init();
    first.createCycle({
      pairId: "kisab-main",
      plannerSourceMessageId: "chat-1",
      workerDispatchMessageId: "opencode-user-1"
    });
    first.updateCycle("kisab-main", "chat-1", { cycleStatus: "WORKER_RESPONDED" });
    first.close();

    const second = new SqliteRelayStore(dbPath);
    await second.init();
    const cycle = second.getCycleByPlannerSource("kisab-main", "chat-1");
    expect(cycle?.cycleStatus).toBe("WORKER_RESPONDED");
    expect(second.listCycles("kisab-main")).toHaveLength(1);
    second.close();
  });

  it("enforces uniqueness on (pair_id, planner_source_message_id)", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createCycle({
        pairId: "kisab-main",
        plannerSourceMessageId: "chat-1",
        workerDispatchMessageId: "opencode-user-1"
      });

      expect(() =>
        store.createCycle({
          pairId: "kisab-main",
          plannerSourceMessageId: "chat-1",
          workerDispatchMessageId: "opencode-user-2"
        })
      ).toThrow();

      store.close();
    } finally {
      await cleanup();
    }
  });

  it("enforces uniqueness on (pair_id, worker_dispatch_message_id)", async () => {
    const { dbPath, cleanup } = await freshStore();
    try {
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      store.createCycle({
        pairId: "kisab-main",
        plannerSourceMessageId: "chat-1",
        workerDispatchMessageId: "opencode-user-1"
      });

      expect(() =>
        store.createCycle({
          pairId: "kisab-main",
          plannerSourceMessageId: "chat-2",
          workerDispatchMessageId: "opencode-user-1"
        })
      ).toThrow();

      store.close();
    } finally {
      await cleanup();
    }
  });
});
