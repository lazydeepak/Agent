import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRelayStore } from "../src/persistence/index.js";
import type { SessionPair } from "../src/types.js";

function pairWithProjectId(projectPairId: string, repoPath: string): SessionPair {
  return {
    pairId: "pair-test",
    enabled: true,
    projectPairId,
    worker: { type: "opencode" as const, sessionId: "ses_test", repoPath },
    planner: { type: "chatgpt-browser" as const, conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" }
  };
}

const tempDirs: string[] = [];

describe("project-aware pair/session foundation", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(async (path) => {
      try { await rm(path, { force: true, recursive: true }); } catch {}
    }));
  });
  it("preserves projectPairId through supervisor persistence and reads it back", async () => {
    const store = new SqliteRelayStore(":memory:");
    await store.init();
    await store.touchSupervisorState({ pairId: "pair-test", projectPairId: "project-main", lastSupervisorState: "READY", paused: false });
    const read = await store.getSupervisorState("pair-test");
    expect(read?.projectPairId).toBe("project-main");
    await store.close();
  });

  it("pair relay state preserves optional projectPairId", async () => {
    const store = new SqliteRelayStore(":memory:");
    await store.init();
    await store.touchPairState({ pairId: "pair-test", projectPairId: "project-main", lastWorkerMessageId: "msg-1" });
    const state = await store.getPairState("pair-test");
    expect(state?.projectPairId).toBe("project-main");
    await store.close();
  });

  it("existing session pair config accepts optional projectPairId without validation failure", async () => {
    const { parsePairsConfig } = await import("../src/sessions/pairs.js");
    const config = parsePairsConfig({
      pairs: [
        pairWithProjectId("project-main", "/tmp/repo")
      ]
    });
    expect(config.pairs[0]?.projectPairId).toBe("project-main");
  });

  it("distinct repositories with different projectPairIds remain independent", async () => {
    const config1 = pairWithProjectId("project-a", "/tmp/repo-a");
    const config2 = pairWithProjectId("project-b", "/tmp/repo-b");
    expect(config1.projectPairId).toBe("project-a");
    expect(config2.projectPairId).toBe("project-b");
    expect(config1.pairId).toBe(config2.pairId);
  });

  it("pair config creation and edit preserve projectPairId through persistence", async () => {
    const { PairConfigRepository } = await import("../src/application/pair-config-repository.js");
    const dir = await mkdtemp(join(tmpdir(), "agent-relay-test-pair-"));
    tempDirs.push(dir);
    const repoPath = join(dir, "test.json");
    const repo = new PairConfigRepository(repoPath);
    const original: SessionPair = {
      pairId: `test-pair-${Date.now()}`,
      enabled: true,
      projectPairId: "project-test",
      worker: { type: "opencode" as const, sessionId: "s1", repoPath: "/tmp/repo" },
      planner: { type: "chatgpt-browser" as const, conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" }
    };
    await repo.addPair(original);
    const loaded = await repo.load();
    expect(loaded.pairs[0]?.projectPairId).toBe("project-test");
    await repo.updatePair(original.pairId, { worker: { repoPath: "/tmp/repo-v2" } });
    const edited = await repo.load();
    expect(edited.pairs[0]?.projectPairId).toBe("project-test");
  });
});
