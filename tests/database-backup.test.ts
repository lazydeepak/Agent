import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDesktopService } from "./helpers.js";
import { SqliteRelayStore } from "../src/persistence/index.js";
import { hashText } from "../src/persistence/canonical.js";
import type { SessionPair } from "../src/types.js";
import type { RelayEngine } from "../src/application/relay-engine.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const makePair = (pairId: string): SessionPair => ({
  pairId,
  enabled: true,
  worker: {
    type: "opencode",
    sessionId: `ses_worker_${pairId}`,
    repoPath: `/Users/x/${pairId}`,
    server: { baseUrl: "http://127.0.0.1:4096" }
  },
  planner: {
    type: "chatgpt-browser",
    conversationId: `planner-${pairId}`,
    conversationUrl: `https://chatgpt.com/c/planner-${pairId}`
  }
});

async function makeContext(pairs: SessionPair[] = [makePair("kisab-main")]) {
  const directory = await mkdtemp(join(tmpdir(), "agent-restore-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  const dbPath = join(directory, "agent.sqlite");
  await writeFile(configPath, JSON.stringify({ pairs }), "utf8");
  process.env.AGENT_SETTINGS_PATH = join(directory, "settings.local.json");
  const service = createTestDesktopService({ configPath, dbPath, pollIntervalMs: 10 });
  const cleanup = () => rm(directory, { recursive: true, force: true });
  return { service, configPath, dbPath, directory, cleanup };
}

function recordIdentity(pairId: string, sourceMessageId: string) {
  return { pairId, direction: "worker-to-planner" as const, sourceMessageId, sourceHash: hashText(sourceMessageId) };
}

describe("DesktopApplicationService — database backup & restore", () => {
  it("creates an atomic backup, lists it, and reports database info", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      const store = ctx.service.getStore();
      expect(store).toBeDefined();
      store!.createRecord(recordIdentity("kisab-main", "m1"));

      const info = ctx.service.getDatabaseInfo();
      expect(info.databaseExists).toBe(true);
      expect(info.databasePath).toBe(ctx.dbPath);
      expect(info.schemaVersion).toBe(17);
      expect(info.expectedSchemaVersion).toBe(17);
      expect(info.tableCounts).toMatchObject({ relay_records: 1, permission_grants: 0 });

      const backup = ctx.service.backupDatabase();
      expect(backup.path).toMatch(/\/backups\/agent-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.sqlite$/);
      expect((await stat(backup.path)).size).toBeGreaterThan(0);

      // The backup contains the ledger as of backup time.
      const backupStore = new SqliteRelayStore(backup.path);
      await backupStore.init();
      expect(backupStore.listRecords("kisab-main")).toHaveLength(1);
      backupStore.close();

      const listed = ctx.service.listDatabaseBackups();
      expect(listed.some((entry) => backup.path.endsWith(entry.fileName))).toBe(true);
      expect(listed[0]?.sizeBytes).toBeGreaterThan(0);

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("restores a backup over the live database, snapshots the current one, and keeps records consistent", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      const store = ctx.service.getStore();
      store!.createRecord(recordIdentity("kisab-main", "before-backup"));
      const backup = ctx.service.backupDatabase();
      const backupFileName = backup.path.split("/").pop()!;

      // Write a record AFTER the backup — the restore must erase it from the live DB
      // and preserve it in the pre-restore snapshot.
      store!.createRecord(recordIdentity("kisab-main", "after-backup-only"));

      const result = ctx.service.restoreDatabase(backupFileName);
      expect(result.restoredFrom).toBe(backupFileName);
      expect(result.preRestoreBackup.endsWith(".sqlite")).toBe(true);

      // Fresh open of the live DB: only the pre-backup record remains.
      const restoredStore = new SqliteRelayStore(ctx.dbPath);
      try {
        const restoredIds = restoredStore.listRecords("kisab-main").map((row) => row.sourceMessageId);
        expect(restoredIds).toEqual(["before-backup"]);
      } finally {
        restoredStore.close();
      }

      // Pre-restore snapshot contains BOTH records.
      const preStore = new SqliteRelayStore(result.preRestoreBackup);
      try {
        const preIds = preStore.listRecords("kisab-main").map((row) => row.sourceMessageId).sort();
        expect(preIds).toEqual(["after-backup-only", "before-backup"]);
      } finally {
        preStore.close();
      }

      // Quarantine file preserves the replaced database next to the live one.
      const siblings = await readdir(dirname(ctx.dbPath));
      expect(siblings.some((name) => name.startsWith("agent.sqlite.pre-restore-"))).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it("refuses to restore while a pair is running", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-restore-blocked-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "agent.sqlite");
    await writeFile(configPath, JSON.stringify({ pairs: [makePair("kisab-main")] }), "utf8");
    const blockingEngine = {
      getStatus: () => ({ total: 1, enabled: 1, running: 1, healthy: 1, failed: 0, paused: 0, stopped: 0 }),
      setPlannerSeeding: () => undefined,
      subscribeEvents: () => () => undefined
    } as unknown as RelayEngine;
    const service = createTestDesktopService({ configPath, dbPath, pollIntervalMs: 10, relayEngine: blockingEngine });
    const backupDir = join(directory, "backups");
    await import("node:fs/promises").then((fs) => fs.mkdir(backupDir, { recursive: true }));
    const backupPath = join(backupDir, "agent-2026-11-18-00-00-00.sqlite");
    await writeFile(backupPath, "not a database");
    expect(() => service.restoreDatabase("agent-2026-11-18-00-00-00.sqlite")).toThrow(/still running/);
  });

  it("rejects traversal and unrecognised names before touching anything", async () => {
    const ctx = await makeContext();
    try {
      expect(() => ctx.service.restoreDatabase("../../etc/passwd.sqlite")).toThrow(/not a recognised Agent backup/);
      expect(() => ctx.service.restoreDatabase("pre-restore-oops.sqlite")).toThrow(/not a recognised Agent backup/);
      expect(() => ctx.service.restoreDatabase("agent-20261118-000000.sqlite")).toThrow(/not a recognised Agent backup/);
      expect(() => ctx.service.restoreDatabase("random.sqlite")).toThrow(/not a recognised Agent backup/);
    } finally {
      await ctx.cleanup();
    }
  });

  it("reports RESTORE_NOT_FOUND for a valid-looking name with no file", async () => {
    const ctx = await makeContext();
    try {
      expect(() => ctx.service.restoreDatabase("agent-2026-11-18-00-00-00.sqlite")).toThrow(/does not exist/);
    } finally {
      await ctx.cleanup();
    }
  });

  it("rejects a corrupt backup with RESTORE_INCOMPATIBLE and leaves the live database untouched", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      const store = ctx.service.getStore();
      store!.createRecord(recordIdentity("kisab-main", "keep-me"));
      const backupDir = join(ctx.directory, "backups");
      await import("node:fs/promises").then((fs) => fs.mkdir(backupDir, { recursive: true }));
      const corruptPath = join(backupDir, "agent-2026-11-18-00-00-00.sqlite");
      await writeFile(corruptPath, "this is not sqlite at all");
      expect(() => ctx.service.restoreDatabase("agent-2026-11-18-00-00-00.sqlite")).toThrow(/missing required relay tables/);

      // The live database was not swapped — the original record is still there.
      const check = new SqliteRelayStore(ctx.dbPath);
      try {
        expect(check.listRecords("kisab-main").map((row) => row.sourceMessageId)).toEqual(["keep-me"]);
      } finally {
        check.close();
      }
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("rejects a backup that has the SQLite magic but lacks the required tables", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      const backupDir = join(ctx.directory, "backups");
      await import("node:fs/promises").then((fs) => fs.mkdir(backupDir, { recursive: true }));
      const sqlitePath = join(backupDir, "agent-2026-11-18-00-00-01.sqlite");
      // A real empty SQLite database — valid magic, no relay tables.
      const DatabaseSync = (await import("node:sqlite")).DatabaseSync;
      const db = new DatabaseSync(sqlitePath);
      db.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY);");
      db.close();
      expect(() => ctx.service.restoreDatabase("agent-2026-11-18-00-00-01.sqlite")).toThrow(/missing required relay tables/);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });
});
