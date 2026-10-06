import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArchiveError, PairArchive, type ArchivedPairPayload } from "../src/persistence/index.js";
import type { RelayRecord } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function payload(pairId: string, archivedAt: string, overrides?: Partial<ArchivedPairPayload>): ArchivedPairPayload {
  const record: RelayRecord = {
    id: 1,
    pairId,
    direction: "planner-to-worker",
    sourceMessageId: `m-${pairId}`,
    sourceHash: `hash-${pairId}`,
    status: "DELIVERED",
    firstSeenAt: archivedAt,
    attemptCount: 1
  };
  return {
    pairId,
    archivedAt,
    config: {
      pairId,
      enabled: true,
      worker: { type: "opencode", sessionId: "s_1", repoPath: "/repo/one" },
      planner: { type: "chatgpt-browser", conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1" }
    },
    records: [record],
    cycles: [],
    state: {},
    ...overrides
  };
}

async function makeArchive(): Promise<{ archive: PairArchive; dir: string }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-archive-"));
  tempDirs.push(directory);
  const archive = new PairArchive(join(directory, "archive"));
  await archive.init();
  return { archive, dir: join(directory, "archive") };
}

describe("PairArchive", () => {
  it("archives a payload to a single JSON artifact and lists it back with summary counts", async () => {
    const { archive } = await makeArchive();
    const ref = await archive.archive(payload("kisab-main", "2026-09-13T12:00:00.000Z"));
    expect(ref).toMatch(/^kisab-main-2026-09-13T12-00-00\.000-\.json$/);

    const listed = await archive.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      ref,
      pairId: "kisab-main",
      archivedAt: "2026-09-13T12:00:00.000Z",
      recordCount: 1,
      cycleCount: 0,
      hasState: false
    });

    const read = await archive.read(ref);
    expect(read.config.worker.sessionId).toBe("s_1");
  });

  it("deletes an artifact idempotently and a manually deleted file leaves no listing pollution", async () => {
    const { archive, dir } = await makeArchive();
    const ref = await archive.archive(payload("kisab-main", "2026-09-13T12:00:00.000Z"));

    await archive.remove(ref);
    expect(await archive.list()).toEqual([]);

    const second = await archive.archive(payload("other-main", "2026-09-13T13:00:00.000Z"));
    await rm(join(dir, second), { force: true });
    expect(await archive.list()).toEqual([]);
  });

  it("skips corrupt artifacts and non-JSON files while listing", async () => {
    const { archive, dir } = await makeArchive();
    await archive.archive(payload("good-main", "2026-09-13T12:00:00.000Z"));
    await writeFile(join(dir, "corrupt-main-2026-09-13T13.00.00.000-.json"), "{ not json", "utf8");
    await writeFile(join(dir, "notes.txt"), "ignored", "utf8");

    const listed = await archive.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].pairId).toBe("good-main");
  });

  it("rejects path traversal and non-JSON references for read and remove", async () => {
    const { archive } = await makeArchive();
    await archive.archive(payload("kisab-main", "2026-09-13T12:00:00.000Z"));

    await expect(archive.read("../kisab-main.json")).rejects.toBeInstanceOf(ArchiveError);
    await expect(archive.read("kisab-main")).rejects.toBeInstanceOf(ArchiveError);
    await expect(archive.remove("sub/dir/kisab-main.json")).rejects.toBeInstanceOf(ArchiveError);
    await expect(archive.remove("")).rejects.toBeInstanceOf(ArchiveError);
  });

  it("refuses operations before init and throws a not-found error for missing reads", async () => {
    const { archive } = await makeArchive();
    const uninitialized = new PairArchive(join(tmpdir(), "does-not-matter"));
    await expect(uninitialized.list()).rejects.toBeInstanceOf(ArchiveError);
    await expect(archive.read("missing-main-2026-09-13T12.00.00.000-.json")).rejects.toThrow("was not found");
  });

  it("lists newest first and survives a folder removed externally", async () => {
    const { archive, dir } = await makeArchive();
    const older = await archive.archive(payload("a-main", "2026-09-12T10:00:00.000Z"));
    const newer = await archive.archive(payload("b-main", "2026-09-13T10:00:00.000Z"));
    expect(await archive.list()).toEqual([
      expect.objectContaining({ ref: newer }),
      expect.objectContaining({ ref: older })
    ]);
    await rm(dir, { force: true, recursive: true });
    await expect(archive.list()).resolves.toEqual([]);
  });
});