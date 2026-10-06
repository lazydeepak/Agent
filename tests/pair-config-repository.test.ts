import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPairsConfig } from "../src/sessions/pairs.js";
import { PairConfigError, PairConfigRepository, type PairEdits } from "../src/application/pair-config-repository.js";
import type { SessionPair } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function makePair(pairId: string, sessionId: string, conversationId: string): SessionPair {
  return {
    pairId,
    enabled: true,
    worker: { type: "opencode", sessionId, repoPath: `/Users/x/${pairId}` },
    planner: {
      type: "chatgpt-browser",
      conversationId,
      conversationUrl: `https://chatgpt.com/c/${conversationId}`
    }
  };
}

describe("PairConfigRepository", () => {
  it("loads an existing config and preserves unrelated pairs", async () => {
    const { repo, cleanup } = await freshRepository([makePair("a", "s_a", "c_a"), makePair("b", "s_b", "c_b")]);
    try {
      const config = await repo.load();
      expect(config.pairs.map((pair) => pair.pairId)).toEqual(["a", "b"]);
    } finally {
      await cleanup();
    }
  });

  it("returns an empty config when the file does not exist", async () => {
    const { repo, cleanup } = await freshRepository([]);
    try {
      expect(await repo.exists()).toBe(false);
      expect(await repo.load()).toEqual({ pairs: [] });
    } finally {
      await cleanup();
    }
  });

  it("loads an existing empty pairs config without a schema failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-relay-empty-"));
    tempDirs.push(dir);
    const configPath = join(dir, "pairs.json");
    await writeFile(configPath, `${JSON.stringify({ pairs: [] })}\n`, "utf8");
    const repo = new PairConfigRepository(configPath);
    try {
      expect(await repo.load()).toEqual({ pairs: [] });
      const viaCli = await loadPairsConfig(configPath);
      expect(viaCli.pairs).toEqual([]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("creates the first pair from an existing empty config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-relay-empty-"));
    tempDirs.push(dir);
    const configPath = join(dir, "pairs.json");
    await writeFile(configPath, `${JSON.stringify({ pairs: [] })}\n`, "utf8");
    const repo = new PairConfigRepository(configPath);
    try {
      const config = await repo.addPair(makePair("first", "s_1", "c_1"));
      expect(config.pairs).toHaveLength(1);
      const viaCli = await loadPairsConfig(configPath);
      expect(viaCli.pairs[0].pairId).toBe("first");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("removing the last pair leaves the config reloadable", async () => {
    const { repo, configPath, cleanup } = await freshRepository([makePair("only", "s_1", "c_1")]);
    try {
      await repo.removePair("only");
      expect(await repo.load()).toEqual({ pairs: [] });
      const viaCli = await loadPairsConfig(configPath);
      expect(viaCli.pairs).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("adds a pair and creates a loadable config file", async () => {
    const { repo, configPath, cleanup } = await freshRepository([]);
    try {
      const config = await repo.addPair(makePair("kisab-main", "s_1", "c_1"));
      expect(config.pairs).toHaveLength(1);
      const onDisk = JSON.parse(await readFile(configPath, "utf8"));
      expect(onDisk.pairs[0].pairId).toBe("kisab-main");
      const viaCli = await loadPairsConfig(configPath);
      expect(viaCli.pairs[0].pairId).toBe("kisab-main");
    } finally {
      await cleanup();
    }
  });

  it("updates worker and planner fields while keeping the pairId", async () => {
    const { repo, cleanup } = await freshRepository([makePair("a", "s_a", "c_a")]);
    try {
      const config = await repo.updatePair("a", {
        worker: { sessionId: "s_a2" },
        planner: { conversationId: "c_a2", conversationUrl: "https://chatgpt.com/c/c_a2" },
        enabled: false
      });
      const pair = config.pairs[0];
      expect(pair?.pairId).toBe("a");
      expect(pair?.worker.sessionId).toBe("s_a2");
      expect(pair?.planner.conversationId).toBe("c_a2");
      expect(pair?.enabled).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("preserves unexposed endpoint settings when editing endpoint URLs", async () => {
    const pair = makePair("a", "s_a", "c_a");
    pair.worker.server = {
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      passwordEnv: "OPENCODE_PASSWORD"
    };
    pair.planner.browser = {
      cdpUrl: "http://127.0.0.1:9222",
      executablePath: "/Applications/Chrome.app/Contents/MacOS/Chrome",
      userDataDir: "/tmp/profile",
      headless: false,
      timeoutMs: 15_000
    };
    const { repo, cleanup } = await freshRepository([pair]);
    try {
      const config = await repo.updatePair("a", {
        worker: { server: { baseUrl: "http://127.0.0.1:5000" } },
        planner: { browser: { cdpUrl: "http://127.0.0.1:9333" } }
      });
      expect(config.pairs[0]?.worker.server).toEqual({
        baseUrl: "http://127.0.0.1:5000",
        username: "opencode",
        passwordEnv: "OPENCODE_PASSWORD"
      });
      expect(config.pairs[0]?.planner.browser).toEqual({
        cdpUrl: "http://127.0.0.1:9333",
        executablePath: "/Applications/Chrome.app/Contents/MacOS/Chrome",
        userDataDir: "/tmp/profile",
        headless: false,
        timeoutMs: 15_000
      });
    } finally {
      await cleanup();
    }
  });

  it("rejects editing a pairId", async () => {
    const { repo, cleanup } = await freshRepository([makePair("a", "s_a", "c_a")]);
    try {
      await expect(
        repo.updatePair("a", { worker: { sessionId: "s_a2" }, pairId: "b" } as unknown as PairEdits)
      ).rejects.toMatchObject({ code: "IMMUTABLE_PAIR_ID" });
    } finally {
      await cleanup();
    }
  });

  it("rejects a duplicate pairId on add", async () => {
    const { repo, cleanup } = await freshRepository([makePair("a", "s_a", "c_a")]);
    try {
      await expect(repo.addPair(makePair("a", "s_other", "c_other"))).rejects.toMatchObject({
        code: "PAIR_ALREADY_EXISTS"
      });
    } finally {
      await cleanup();
    }
  });

  it("rejects a duplicate OpenCode session ownership", async () => {
    const { repo, cleanup } = await freshRepository([makePair("a", "s_a", "c_a")]);
    try {
      await expect(repo.addPair(makePair("b", "s_a", "c_b"))).rejects.toMatchObject({
        code: "DUPLICATE_OWNERSHIP"
      });
    } finally {
      await cleanup();
    }
  });

  it("rejects a duplicate ChatGPT conversation ownership", async () => {
    const { repo, cleanup } = await freshRepository([makePair("a", "s_a", "c_a")]);
    try {
      await expect(repo.addPair(makePair("b", "s_b", "c_a"))).rejects.toMatchObject({
        code: "DUPLICATE_OWNERSHIP"
      });
    } finally {
      await cleanup();
    }
  });

  it("rejects duplicate ownership introduced by edit or rebind", async () => {
    const { repo, cleanup } = await freshRepository([
      makePair("a", "s_a", "c_a"),
      makePair("b", "s_b", "c_b")
    ]);
    try {
      await expect(repo.updatePair("b", { worker: { sessionId: "s_a" } })).rejects.toMatchObject({
        code: "DUPLICATE_OWNERSHIP"
      });
      await expect(
        repo.updatePair("b", {
          planner: { conversationId: "c_a", conversationUrl: "https://chatgpt.com/c/c_a" }
        })
      ).rejects.toMatchObject({ code: "DUPLICATE_OWNERSHIP" });
    } finally {
      await cleanup();
    }
  });

  it("serializes concurrent writes so duplicate ownership cannot race", async () => {
    const { repo, cleanup } = await freshRepository([]);
    try {
      const results = await Promise.allSettled([
        repo.addPair(makePair("a", "shared-session", "c_a")),
        repo.addPair(makePair("b", "shared-session", "c_b"))
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const persisted = await repo.load();
      expect(persisted.pairs).toHaveLength(1);
      expect(persisted.pairs[0]?.worker.sessionId).toBe("shared-session");
    } finally {
      await cleanup();
    }
  });

  it("allows shared endpoints and repo paths across pairs", async () => {
    const { repo, cleanup } = await freshRepository([]);
    try {
      const sharedEndpoint = "http://127.0.0.1:4096";
      const first = makePair("a", "s_a", "c_a");
      const second = makePair("b", "s_b", "c_b");
      first.worker.server = { baseUrl: sharedEndpoint };
      second.worker.server = { baseUrl: sharedEndpoint };
      second.worker.repoPath = first.worker.repoPath;
      second.planner.browser = { cdpUrl: "http://127.0.0.1:9222" };
      await repo.addPair(first);
      const config = await repo.addPair(second);
      expect(config.pairs).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  it("removes a pair without touching the others", async () => {
    const { repo, cleanup } = await freshRepository([makePair("a", "s_a", "c_a"), makePair("b", "s_b", "c_b")]);
    try {
      const config = await repo.removePair("a");
      expect(config.pairs.map((pair) => pair.pairId)).toEqual(["b"]);
    } finally {
      await cleanup();
    }
  });

  it("rejects an invalid config file on load", async () => {
    const { repo, configPath, cleanup } = await freshRepository([]);
    try {
      await writeFile(configPath, "{ not json", "utf8");
      await expect(repo.load()).rejects.toBeInstanceOf(PairConfigError);
      await expect(repo.load()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    } finally {
      await cleanup();
    }
  });

  it("rejects a wrong config structure on load", async () => {
    const { repo, configPath, cleanup } = await freshRepository([]);
    try {
      await writeFile(configPath, JSON.stringify({ sessions: [] }), "utf8");
      await expect(repo.load()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    } finally {
      await cleanup();
    }
  });

  it("rejects a missing pair removal", async () => {
    const { repo, cleanup } = await freshRepository([]);
    try {
      await expect(repo.removePair("missing")).rejects.toMatchObject({ code: "PAIR_NOT_FOUND" });
    } finally {
      await cleanup();
    }
  });

  it("writes atomically and leaves no temp files", async () => {
    const { repo, dir, cleanup } = await freshRepository([makePair("a", "s_a", "c_a")]);
    try {
      await repo.addPair(makePair("b", "s_b", "c_b"));
      const config = await repo.load();
      expect(config.pairs).toHaveLength(2);
      const entries = await readdir(dir);
      expect(entries).toEqual(["pairs.json"]);
      expect(entries.some((entry) => entry.includes(".tmp"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("rejects writes that would produce invalid config", async () => {
    const { repo, cleanup } = await freshRepository([]);
    try {
      await repo.addPair(makePair("a", "s_a", "c_a"));
      const invalid = makePair("b", "s_b", "c_b");
      invalid.planner.conversationUrl = "not-a-url";
      await expect(repo.addPair(invalid)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    } finally {
      await cleanup();
    }
  });

  it("is compatible with the CLI parser", async () => {
    const { repo, configPath, cleanup } = await freshRepository([]);
    try {
      const withServer = makePair("cli-compat", "s_c", "c_c");
      withServer.worker.server = { baseUrl: "http://127.0.0.1:4096" };
      withServer.planner.browser = { cdpUrl: "http://127.0.0.1:9222" };
      await repo.addPair(withServer);
      const viaCli = await loadPairsConfig(configPath);
      expect(viaCli.pairs[0].worker.server?.baseUrl).toBe("http://127.0.0.1:4096");
      expect(viaCli.pairs[0].planner.browser?.cdpUrl).toBe("http://127.0.0.1:9222");
    } finally {
      await cleanup();
    }
  });
});

async function freshRepository(
  pairs: SessionPair[]
): Promise<{ repo: PairConfigRepository; configPath: string; dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "agent-relay-repo-"));
  tempDirs.push(dir);
  const configPath = join(dir, "pairs.json");
  if (pairs.length > 0) {
    await writeFile(configPath, `${JSON.stringify({ pairs }, null, 2)}\n`, "utf8");
  }
  return { repo: new PairConfigRepository(configPath), configPath, dir, cleanup: () => rm(dir, { force: true, recursive: true }) };
}
