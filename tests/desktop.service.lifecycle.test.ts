import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopApplicationService } from "../src/application/desktop-service.js";
import { UNIVERSAL_PLANNER_PROMPT_VERSION } from "../src/application/universal-planner-prompt.js";
import { LOCAL_AGENT_PLANNER_PROMPT_VERSION } from "../src/application/local-agent-planner-prompt.js";
import type { SessionPair } from "../src/types.js";
import { createTestDesktopService } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

interface Context {
  service: DesktopApplicationService;
  configPath: string;
  cleanup: () => Promise<void>;
}

async function makeContext(
  pairs: SessionPair[],
  options: { opencodeFetch?: typeof fetch; relay?: boolean; pollIntervalMs?: number } = {}
): Promise<Context> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-lifecycle-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  const dbPath = join(directory, "agent-relay.sqlite");
  await writeFile(configPath, JSON.stringify({ pairs }), "utf8");
  const service = createTestDesktopService({
    configPath,
    dbPath,
    pollIntervalMs: options.pollIntervalMs,
    opencodeFetch: options.opencodeFetch,
    relay: options.relay
  });
  return { service, configPath, cleanup: () => rm(directory, { force: true, recursive: true }) };
}

function pairDto(pairId: string, overrides: Partial<SessionPair> = {}): SessionPair {
  return {
    pairId,
    enabled: true,
    worker: {
      type: "opencode",
      sessionId: `ses_worker_${pairId}`,
      repoPath: `/Users/x/${pairId}`
    },
    planner: {
      type: "chatgpt-browser",
      conversationId: `planner-conversation-${pairId}`,
      conversationUrl: `https://chatgpt.com/c/planner-conversation-${pairId}`
    },
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Minimal v2 OpenCode stub: enough for model switching and the "continue" prompt. */
function workerStub(options: { failPrompt?: boolean } = {}): typeof fetch {
  const calls: string[] = [];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/doc") {
      return jsonResponse({
        paths: {
          "/api/session/{sessionID}/prompt": {},
          "/api/session/{sessionID}/message": {},
          "/api/session/{sessionID}/model": {},
          "/api/model": {},
          "/api/health": {}
        }
      });
    }
    if (url.pathname === "/api/health") return jsonResponse({ ok: true });
    if (url.pathname === "/api/model") {
      return jsonResponse({
        data: [
          { providerID: "ollama", id: "small", name: "Small", enabled: true },
          { providerID: "anthropic", id: "claude", name: "Claude", enabled: true }
        ]
      });
    }
    if (url.pathname.startsWith("/api/session/") && url.pathname.endsWith("/model") && method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith("/api/session/") && url.pathname.endsWith("/prompt") && method === "POST") {
      if (options.failPrompt) return jsonResponse({ error: "boom" }, 500);
      return jsonResponse({ data: { id: "msg_continue", sessionID: "ses_worker_main-1", timeCreated: 1, type: "user", payload: {} } });
    }
    // History must show the dispatched prompt followed by a started step, otherwise the adapter
    // polls until its promotion timeout and reports the worker as blocked.
    if (url.pathname.startsWith("/api/session/") && url.pathname.endsWith("/history")) {
      return jsonResponse({
        data: [
          { id: 1, type: "message.prompted", data: { id: "msg_continue" } },
          { id: 2, type: "session.step.started", data: {} }
        ],
        hasMore: false
      });
    }
    if (url.pathname.startsWith("/api/session/")) {
      return jsonResponse({ data: { id: "ses_worker_main-1", model: { providerID: "ollama", id: "small" } } });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
}

async function readConfig(configPath: string): Promise<{ pairs: SessionPair[] }> {
  return JSON.parse(await readFile(configPath, "utf8")) as { pairs: SessionPair[] };
}

describe("project lifecycle", () => {
  it("starts every enabled member of a project and reports the aggregate", async () => {
    const ctx = await makeContext([
      pairDto("alpha", { projectPairId: "proj-a" }),
      pairDto("beta", { projectPairId: "proj-a" }),
      pairDto("gamma", { projectPairId: "proj-b" })
    ]);
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));

      const summary = await ctx.service.startProject("proj-a");

      expect(summary.projectPairId).toBe("proj-a");
      expect(summary.aggregate).toBe("success");
      expect(summary.pairResults).toEqual([
        { pairId: "alpha", outcome: "started" },
        { pairId: "beta", outcome: "started" }
      ]);
      expect(events).toContain("PROJECT_LIFECYCLE_STARTED");
      // The other project is untouched.
      expect(ctx.service.getStatus().running).toBe(2);

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("reports a partial aggregate when only some members start", async () => {
    // A real (loopback) stub server: startPair validates the worker session against the endpoint,
    // and this one reports the session in a different repository than the pair is configured for.
    const stub = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/doc") {
        res.end(JSON.stringify({ paths: { "/api/session": {}, "/api/session/{sessionID}/message": {} } }));
        return;
      }
      if (url.pathname.startsWith("/api/session/")) {
        res.end(JSON.stringify({ data: { id: "ses_worker_broken", directory: "/somewhere/else" } }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
    const address = stub.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ctx = await makeContext([
      pairDto("alpha", { projectPairId: "proj-a" }),
      pairDto("broken", {
        projectPairId: "proj-a",
        worker: {
          type: "opencode",
          sessionId: "ses_worker_broken",
          repoPath: "/Users/x/broken",
          server: { baseUrl: `http://127.0.0.1:${port}` }
        }
      })
    ]);
    try {
      await ctx.service.init();
      const summary = await ctx.service.startProject("proj-a");
      expect(summary.aggregate).toBe("partial");
      expect(summary.pairResults.find((result) => result.pairId === "alpha")?.outcome).toBe("started");
      expect(summary.pairResults.find((result) => result.pairId === "broken")?.outcome).toBe(
        "WORKER_SESSION_REPO_MISMATCH"
      );
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it("pauses running members of a project and leaves other projects running", async () => {
    const ctx = await makeContext([
      pairDto("alpha", { projectPairId: "proj-a" }),
      pairDto("gamma", { projectPairId: "proj-b" })
    ]);
    try {
      await ctx.service.init();
      await ctx.service.startProject("proj-a");
      await ctx.service.startProject("proj-b");
      expect(ctx.service.getStatus().running).toBe(2);

      const status = await ctx.service.pauseProject("proj-a");
      expect(status.pairs.find((pair) => pair.pairId === "alpha")?.paused).toBe(true);
      expect(status.pairs.find((pair) => pair.pairId === "gamma")?.paused).toBe(false);

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("resumeProject delegates to startProject", async () => {
    const ctx = await makeContext([pairDto("alpha", { projectPairId: "proj-a" })]);
    try {
      await ctx.service.init();
      await ctx.service.startProject("proj-a");
      const summary = await ctx.service.resumeProject("proj-a");
      expect(summary.aggregate).toBe("success");
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("lifecycle mutex", () => {
  it("serializes a config mutation behind an in-flight start instead of racing it", async () => {
    const ctx = await makeContext([pairDto("alpha", { projectPairId: "proj-a" })], { pollIntervalMs: 30 });
    try {
      await ctx.service.init();
      // No await: the start owns the lifecycle chain while it runs.
      const starting = ctx.service.startProject("proj-a");
      const mutation = ctx.service.updatePair("alpha", { enabled: true });

      await expect(starting).resolves.toMatchObject({ aggregate: "success" });
      // The mutation only ran after the start finished, so it sees the running pair and is refused
      // rather than mutating config underneath a live orchestrator.
      await expect(mutation).rejects.toMatchObject({ code: "PAIR_RUNNING" });

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("runs concurrent project starts to completion without interleaving", async () => {
    const ctx = await makeContext([
      pairDto("alpha", { projectPairId: "proj-a" }),
      pairDto("gamma", { projectPairId: "proj-b" })
    ]);
    try {
      await ctx.service.init();
      const [first, second] = await Promise.all([
        ctx.service.startProject("proj-a"),
        ctx.service.startProject("proj-b")
      ]);
      expect(first.aggregate).toBe("success");
      expect(second.aggregate).toBe("success");
      expect(ctx.service.getStatus().running).toBe(2);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("worker model fallback resume", () => {
  it("switches the model, sends continue, and records WORKER_RESUMED", async () => {
    const ctx = await makeContext(
      [pairDto("main-1", { worker: { type: "opencode", sessionId: "ses_worker_main-1", repoPath: "/Users/x/main-1", server: { baseUrl: "http://127.0.0.1:4096" } } })],
      { opencodeFetch: workerStub() }
    );
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));

      const status = await ctx.service.resumeWithFallbackModel("main-1", { providerID: "anthropic", id: "claude" });

      expect(status).toBeDefined();
      expect(events).toContain("WORKER_MODEL_SWITCHED");
      expect(events).toContain("WORKER_RESUMED");
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("fails with CONTINUE_FAILED when the continue prompt cannot be delivered", async () => {
    const ctx = await makeContext(
      [pairDto("main-1", { worker: { type: "opencode", sessionId: "ses_worker_main-1", repoPath: "/Users/x/main-1", server: { baseUrl: "http://127.0.0.1:4096" } } })],
      { opencodeFetch: workerStub({ failPrompt: true }) }
    );
    try {
      await ctx.service.init();
      await expect(
        ctx.service.resumeWithFallbackModel("main-1", { providerID: "anthropic", id: "claude" })
      ).rejects.toMatchObject({ code: "CONTINUE_FAILED" });
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("planner prompt seeding persistence", () => {
  it("persists the universal prompt version and seededAt to config", async () => {
    const ctx = await makeContext([pairDto("main-1")], { relay: true });
    try {
      await ctx.service.init();
      const result = await ctx.service.seedPlanner("main-1");

      expect(result).toMatchObject({ pairId: "main-1", promptVersion: UNIVERSAL_PLANNER_PROMPT_VERSION });
      expect(Date.parse(result.sentAt)).not.toBeNaN();

      const config = await readConfig(ctx.configPath);
      expect(config.pairs[0]?.planner.automation).toMatchObject({
        promptVersion: UNIVERSAL_PLANNER_PROMPT_VERSION,
        seededAt: result.sentAt
      });
      // The constant, not a literal: a bumped prompt version must reach disk.
      expect(ctx.service.listPairs()[0]?.planner.automation?.promptVersion).toBe(UNIVERSAL_PLANNER_PROMPT_VERSION);
      expect(ctx.service.getRecentEvents({ pairId: "main-1" }).map((event) => event.type)).toContain("PLANNER_SEEDED");

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("persists local-agent mode and its prompt version", async () => {
    const ctx = await makeContext([pairDto("main-1")], { relay: true });
    try {
      await ctx.service.init();
      const result = await ctx.service.feedLocalAgentPrompt("main-1");

      expect(result).toMatchObject({
        pairId: "main-1",
        promptVersion: LOCAL_AGENT_PLANNER_PROMPT_VERSION,
        localAgentMode: true
      });
      const config = await readConfig(ctx.configPath);
      expect(config.pairs[0]?.localAgentMode).toBe(true);
      expect(ctx.service.listPairs()[0]?.localAgentMode).toBe(true);
      expect(ctx.service.getRecentEvents({ pairId: "main-1" }).map((event) => event.type)).toContain(
        "LOCAL_AGENT_PROMPT_FED"
      );

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("refuses to seed a running pair", async () => {
    const ctx = await makeContext([pairDto("main-1")], { relay: true });
    try {
      await ctx.service.init();
      await ctx.service.startPair("main-1");
      await expect(ctx.service.seedPlanner("main-1")).rejects.toMatchObject({ code: "PAIR_RUNNING" });
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });
});
