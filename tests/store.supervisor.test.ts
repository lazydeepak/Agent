import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRelayStore } from "../src/persistence/store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function freshDbPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-supervisor-store-"));
  tempDirs.push(directory);
  return join(directory, "agent-relay.sqlite");
}

const V1_DDL = `
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
CREATE UNIQUE INDEX idx_relay_identity
  ON relay_records (pair_id, direction, source_message_id, source_hash);
CREATE INDEX idx_relay_pair ON relay_records (pair_id, direction);
CREATE TABLE pair_state (
  pair_id TEXT PRIMARY KEY,
  last_worker_message_id TEXT,
  last_planner_message_id TEXT,
  last_successful_relay_at TEXT,
  last_direction TEXT,
  last_error TEXT
);
CREATE TABLE schema_version (
  version INTEGER NOT NULL
);
`;

describe("SqliteRelayStore supervisor continuity", () => {
  it("initializes the supervisor schema and continuity round-trips", async () => {
    const dbPath = await freshDbPath();
    const store = new SqliteRelayStore(dbPath);
    await store.init();

    store.touchSupervisorState({ pairId: "kisab-main", lastSupervisorState: "WORKING", paused: false });
    store.touchSupervisorState({ pairId: "kisab-main", lastWorkerActivityAt: "2026-08-31T10:00:00.000Z" });

    const state = store.getSupervisorState("kisab-main");
    expect(state).toMatchObject({
      pairId: "kisab-main",
      lastSupervisorState: "WORKING",
      lastWorkerActivityAt: "2026-08-31T10:00:00.000Z",
      paused: false
    });
    store.close();
  });

  it("returns undefined supervisor state for an untouched pair", async () => {
    const dbPath = await freshDbPath();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    expect(store.getSupervisorState("kisab-main")).toBeUndefined();
    store.close();
  });

  it("persists pause across a restart", async () => {
    const dbPath = await freshDbPath();

    const first = new SqliteRelayStore(dbPath);
    await first.init();
    first.touchSupervisorState({ pairId: "kisab-main", paused: true, lastSupervisorState: "IDLE" });
    first.close();

    const second = new SqliteRelayStore(dbPath);
    await second.init();
    expect(second.getSupervisorState("kisab-main")).toMatchObject({ paused: true, lastSupervisorState: "IDLE" });
    second.close();
  });

  it("resume flips pause back to false", async () => {
    const dbPath = await freshDbPath();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    store.touchSupervisorState({ pairId: "kisab-main", paused: true });
    store.touchSupervisorState({ pairId: "kisab-main", paused: false });
    expect(store.getSupervisorState("kisab-main")?.paused).toBe(false);
    store.close();
  });

  it("migrates a version 1 database to version 3 and preserves relay records", async () => {
    const dbPath = await freshDbPath();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(V1_DDL);
    legacy.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
    legacy
      .prepare(
        `INSERT INTO relay_records
           (pair_id, direction, source_message_id, source_hash, status, first_seen_at)
         VALUES ('kisab-main', 'worker-to-planner', 'msg_abc', 'hash-1', 'DELIVERED', '2026-08-31T09:00:00.000Z')`
      )
      .run();
    legacy.close();

    const store = new SqliteRelayStore(dbPath);
    await store.init();

    expect(store.findRecord({
      pairId: "kisab-main",
      direction: "worker-to-planner",
      sourceMessageId: "msg_abc",
      sourceHash: "hash-1"
    })?.status).toBe("DELIVERED");

    store.touchSupervisorState({
      pairId: "kisab-main",
      lastSupervisorState: "COMPLETED",
      recoveryPolicy: "safe",
      recoveryAttemptCount: 3,
      lastRecoveryErrorCode: "OPENCODE_SESSION_MISSING",
      lastRecoveryError: "The configured OpenCode session no longer exists."
    });
    expect(store.getSupervisorState("kisab-main")).toMatchObject({
      lastSupervisorState: "COMPLETED",
      recoveryPolicy: "safe",
      recoveryAttemptCount: 3,
      lastRecoveryErrorCode: "OPENCODE_SESSION_MISSING"
    });

    await store.init();
    expect(store.getSupervisorState("kisab-main")?.lastSupervisorState).toBe("COMPLETED");
    store.close();
  });

  it("defaults the recovery policy to safe and round-trips recovery metadata across restarts", async () => {
    const dbPath = await freshDbPath();

    const first = new SqliteRelayStore(dbPath);
    await first.init();
    first.touchSupervisorState({ pairId: "kisab-main", lastSupervisorState: "DISCONNECTED" });
    first.touchSupervisorState({
      pairId: "kisab-main",
      recoveryAttemptCount: 2,
      lastRecoveryAttemptAt: "2026-08-31T10:00:00.000Z",
      lastRecoverySuccessAt: "2026-08-31T09:00:00.000Z"
    });
    expect(first.getSupervisorState("kisab-main")).toMatchObject({
      recoveryPolicy: "safe",
      recoveryAttemptCount: 2,
      lastRecoverySuccessAt: "2026-08-31T09:00:00.000Z"
    });
    first.close();

    const second = new SqliteRelayStore(dbPath);
    await second.init();
    expect(second.getSupervisorState("kisab-main")).toMatchObject({
      lastSupervisorState: "DISCONNECTED",
      recoveryPolicy: "safe",
      recoveryAttemptCount: 2,
      lastRecoveryAttemptAt: "2026-08-31T10:00:00.000Z"
    });
    second.close();
  });

  it("clears the last recovery error without touching other recovery metadata", async () => {
    const dbPath = await freshDbPath();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    store.touchSupervisorState({
      pairId: "kisab-main",
      recoveryPolicy: "safe",
      recoveryAttemptCount: 1,
      lastRecoveryErrorCode: "OPENCODE_UNREACHABLE",
      lastRecoveryError: "OpenCode server was unreachable."
    });

    store.clearSupervisorRecoveryError("kisab-main");

    const state = store.getSupervisorState("kisab-main");
    expect(state?.lastRecoveryErrorCode).toBeUndefined();
    expect(state?.lastRecoveryError).toBeUndefined();
    expect(state?.recoveryPolicy).toBe("safe");
    expect(state?.recoveryAttemptCount).toBe(1);
    store.close();
  });

  it("rejects a database that is newer than the supported schema", async () => {
    const dbPath = await freshDbPath();
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE schema_version (version INTEGER NOT NULL);");
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(99);
    db.close();

    const store = new SqliteRelayStore(dbPath);
    await expect(store.init()).rejects.toThrow(/newer than supported/i);
    store.close();
  });
});