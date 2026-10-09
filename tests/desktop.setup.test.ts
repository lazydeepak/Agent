import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopApplicationError,
  DesktopApplicationService
} from "../src/application/desktop-service.js";
import type { ChatGPTReadinessProbe } from "../src/adapters/chatgpt/index.js";
import type { OpenCodeSessionInfo } from "../src/adapters/opencode/http.js";
import type { SessionPair } from "../src/types.js";
import type { DesktopToolLauncher } from "../src/application/desktop-tool-manager.js";
import { createTestDesktopService } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("DesktopApplicationService wizard operations", () => {
  it("exposes the automation mode and versioned universal planner prompt", async () => {
    const observe = await makeContext([]);
    const relay = await makeContext([], { relay: true });
    try {
      await observe.service.init();
      await relay.service.init();
      expect(observe.service.getAutomationInfo()).toMatchObject({
        mode: "observe",
        universalPromptVersion: "1"
      });
      expect(relay.service.getAutomationInfo()).toMatchObject({ mode: "relay" });
      expect(relay.service.getAutomationInfo().universalPrompt).toContain("RELAY_CONTINUE");
    } finally {
      await observe.cleanup();
      await relay.cleanup();
    }
  });

  it("seeds a stopped planner explicitly and records an event", async () => {
    const ctx = await makeContext([makePairDto("main-1")]);
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));
      await expect(ctx.service.seedPlanner("main-1")).resolves.toMatchObject({
        pairId: "main-1",
        promptVersion: "1"
      });
      expect(events).toContain("PLANNER_SEEDED");
      expect(ctx.service.listPairs()[0]?.planner.automation).toMatchObject({ promptVersion: "1" });
    } finally {
      await ctx.cleanup();
    }
  });

  it("feeds the local agent prompt and marks the pair as local-agent mode", async () => {
    const ctx = await makeContext([makePairDto("main-1")]);
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));
      const result = await ctx.service.feedLocalAgentPrompt("main-1");
      expect(result.localAgentMode).toBe(true);
      expect(result.promptVersion).toBe("1");
      expect(events).toContain("LOCAL_AGENT_PROMPT_FED");
      expect(ctx.service.listPairs()[0]?.localAgentMode).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it("starts a fresh relay pair by handing off the latest ChatGPT prompt", async () => {
    const ctx = await makeContext([makePairDto("main-1")], { relay: true, pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(`${event.type}:${event.details?.priming}`));
      await expect(ctx.service.startPair("main-1")).resolves.toBeDefined();
      expect(events).toContain("PAIR_PRIMED:from-planner");
      await ctx.service.stopPair("main-1");
    } finally {
      await ctx.cleanup();
    }
  });

  it("starts an unseeded relay pair primed with the kickoff prompt", async () => {
    const ctx = await makeContext([makePairDto("main-1")], { relay: true, pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));
      await expect(ctx.service.startPair("main-1", "from-trigger")).resolves.toBeDefined();
      expect(events).toContain("PLANNER_SEEDED");
      expect(events).toContain("PAIR_PRIMED");
      expect(ctx.service.listPairs()[0]?.planner.automation).toMatchObject({ promptVersion: "1" });
      await ctx.service.stopPair("main-1");
    } finally {
      await ctx.cleanup();
    }
  });

  it("primes a relay pair with a one-shot relay from OpenCode or ChatGPT", async () => {
    const opencode = await makeContext([makePairDto("main-1")], { relay: true, pollIntervalMs: 10 });
    const chatgpt = await makeContext([makePairDto("main-1")], { relay: true, pollIntervalMs: 10 });
    try {
      await opencode.service.init();
      await chatgpt.service.init();
      const opencodeEvents: string[] = [];
      const chatgptEvents: string[] = [];
      opencode.service.subscribeEvents((event) => opencodeEvents.push(`${event.type}:${event.details?.status}`));
      chatgpt.service.subscribeEvents((event) => chatgptEvents.push(`${event.type}:${event.details?.status}`));
      await expect(opencode.service.startPair("main-1", "from-worker")).resolves.toBeDefined();
      await expect(chatgpt.service.startPair("main-1", "from-planner")).resolves.toBeDefined();
      expect(opencodeEvents).toContain("PAIR_PRIMED:NOOP");
      expect(chatgptEvents).toContain("PAIR_PRIMED:NOOP");
      await opencode.service.stopPair("main-1");
      await chatgpt.service.stopPair("main-1");
    } finally {
      await opencode.cleanup();
      await chatgpt.cleanup();
    }
  });

  it("resumes a relay pair with persisted history without another initial handoff", async () => {
    const ctx = await makeContext([makePairDto("main-1")], { relay: true, pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      ctx.service.getStore()!.createCycle({
        pairId: "main-1",
        plannerSourceMessageId: "planner-1",
        workerDispatchMessageId: "worker-1"
      });
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));
      await expect(ctx.service.startPair("main-1")).resolves.toBeDefined();
      expect(events).not.toContain("PAIR_PRIMED");
      await ctx.service.stopPair("main-1");
    } finally {
      await ctx.cleanup();
    }
  });

  it("rejects priming while the pair is already running", async () => {
    const ctx = await makeContext([makePairDto("main-1")], { relay: true, pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      await expect(ctx.service.startPair("main-1", "from-trigger")).resolves.toBeDefined();
      await expect(ctx.service.startPair("main-1", "from-trigger")).rejects.toMatchObject({ code: "PAIR_RUNNING" });
      await ctx.service.stopPair("main-1");
    } finally {
      await ctx.cleanup();
    }
  });

  it("parses a ChatGPT conversation URL and rejects an invalid one", async () => {
    const ctx = await makeContext([]);
    try {
      await ctx.service.init();
      const parsed = ctx.service.parseChatGptUrl({ url: "https://chatgpt.com/g/p-1/c/abc-123?x=1" });
      expect(parsed.conversationId).toBe("abc-123");
      expect(parsed.project).toBe("p-1");
      expect(() => ctx.service.parseChatGptUrl({ url: "not a url" })).toThrowError(
        expect.objectContaining({ code: "PLANNER_URL_ERROR" })
      );
      expect(() => ctx.service.parseChatGptUrl({ url: "https://example.com/foo" })).toThrowError(
        expect.objectContaining({ code: "PLANNER_URL_ERROR" })
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it("returns default endpoint values when nothing is configured", async () => {
    const ctx = await makeContext([]);
    try {
      await ctx.service.init();
      expect(ctx.service.getOpenCodeEndpoint()).toBe("http://127.0.0.1:4096");
      expect(ctx.service.getChatGptEndpoint()).toBe("http://127.0.0.1:9222");
    } finally {
      await ctx.cleanup();
    }
  });

  it("creates a pair, persists it, and refreshes the pair list", async () => {
    const ctx = await makeContext([]);
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));

      const created = await ctx.service.createPair(candidate("main-1", "s_1", "c_1"));
      expect(created.pairId).toBe("main-1");
      expect(ctx.service.listPairs()).toHaveLength(1);
      expect(events).toContain("PAIR_CREATED");

      const detail = ctx.service.getPairDetail("main-1");
      expect(detail?.worker.sessionId).toBe("s_1");
      expect(detail?.planner.conversationId).toBe("c_1");
    } finally {
      await ctx.cleanup();
    }
  });

  it("rejects a duplicate pairId and duplicate ownership on create", async () => {
    const ctx = await makeContext([]);
    try {
      await ctx.service.init();
      await ctx.service.createPair(candidate("main-1", "s_1", "c_1"));
      await expect(ctx.service.createPair(candidate("main-1", "s_9", "c_9"))).rejects.toMatchObject({
        code: "PAIR_ALREADY_EXISTS"
      });
      await expect(ctx.service.createPair(candidate("other", "s_1", "c_9"))).rejects.toMatchObject({
        code: "DUPLICATE_OWNERSHIP"
      });
      await expect(ctx.service.createPair(candidate("other", "s_9", "c_1"))).rejects.toMatchObject({
        code: "DUPLICATE_OWNERSHIP"
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it("updates worker/planner/endpoint while preserving the immutable pairId", async () => {
    const ctx = await makeContext([makePairDto("main-1")]);
    try {
      await ctx.service.init();
      const updated = await ctx.service.updatePair("main-1", {
        worker: { sessionId: "s_new", server: { baseUrl: "http://127.0.0.1:5000" } },
        planner: { conversationId: "c_new", conversationUrl: "https://chatgpt.com/c/c_new", browser: { cdpUrl: "http://127.0.0.1:9222" } },
        enabled: false
      });
      expect(updated.pairId).toBe("main-1");
      expect(updated.worker.sessionId).toBe("s_new");
      expect(updated.worker.server?.baseUrl).toBe("http://127.0.0.1:5000");
      expect(updated.planner.conversationId).toBe("c_new");
      expect(updated.enabled).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it("refuses to edit, rebind, or remove a running pair", async () => {
    const ctx = await makeContext([makePairDto("main-1")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      await ctx.service.startPair("main-1");
      expect(ctx.service.getPairStatus("main-1")?.runtimeState).toBe("RUNNING");

      await expect(ctx.service.updatePair("main-1", { enabled: false })).rejects.toMatchObject({
        code: "PAIR_RUNNING"
      });
      await expect(ctx.service.rebindWorker("main-1", "s_9")).rejects.toMatchObject({ code: "PAIR_RUNNING" });
      await expect(ctx.service.removePair("main-1")).rejects.toMatchObject({ code: "PAIR_RUNNING" });
      await expect(ctx.service.seedPlanner("main-1")).rejects.toMatchObject({ code: "PAIR_RUNNING" });

      await ctx.service.stopPair("main-1");
      await ctx.service.removePair("main-1");
      expect(ctx.service.listPairs()).toHaveLength(0);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("removes a pair and refreshes the pair list", async () => {
    const ctx = await makeContext([makePairDto("main-1"), makePairDto("other-2")]);
    try {
      await ctx.service.init();
      const result = await ctx.service.removePair("main-1");
      expect(result.pairId).toBe("main-1");
      expect(ctx.service.listPairs().map((pair) => pair.pairId)).toEqual(["other-2"]);
    } finally {
      await ctx.cleanup();
    }
  });

  it("removing the final pair leaves the service with an empty pair list", async () => {
    const ctx = await makeContext([makePairDto("main-1")]);
    try {
      await ctx.service.init();
      await ctx.service.removePair("main-1");
      expect(ctx.service.listPairs()).toEqual([]);
      await ctx.service.createPair(candidate("main-2", "s_2", "c_2"));
      expect(ctx.service.listPairs()).toHaveLength(1);
      expect(ctx.service.listPairs()[0].pairId).toBe("main-2");
    } finally {
      await ctx.cleanup();
    }
  });

  it("rebinds a worker to an explicit session id", async () => {
    const ctx = await makeContext([makePairDto("main-1")]);
    try {
      await ctx.service.init();
      const rebound = await ctx.service.rebindWorker("main-1", "s_chosen");
      expect(rebound.worker.sessionId).toBe("s_chosen");
    } finally {
      await ctx.cleanup();
    }
  });

  it("opens a worker session by selecting the bound session id via the TUI channel", async () => {
    const ctx = await makeContext([makeWorkerPairDto("main-1")], {
      opencodeFetch: fakeOpenCodeFetch()
    });
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));
      const result = await ctx.service.openWorkerSession("main-1");
      expect(result).toMatchObject({
        sessionId: "ses_worker_main-1",
        selected: false,
        fallback: true
      });
      expect(events).toContain("WORKER_SESSION_FALLBACK");
    } finally {
      await ctx.cleanup();
    }
  });

  it("reports a fallback when worker session selection fails", async () => {
    const ctx = await makeContext([makeWorkerPairDto("main-1")], {
      opencodeFetch: async () => jsonResponse({}, 500)
    });
    try {
      await ctx.service.init();
      const events: string[] = [];
      ctx.service.subscribeEvents((event) => events.push(event.type));
      const result = await ctx.service.openWorkerSession("main-1");
      expect(result).toMatchObject({
        sessionId: "ses_worker_main-1",
        selected: false,
        fallback: true
      });
      expect(events).toContain("WORKER_SESSION_FALLBACK");
    } finally {
      await ctx.cleanup();
    }
  });

  it("creates and binds a new worker session in the pair's existing repository", async () => {
    const created: Array<{ body: Record<string, unknown> | undefined }> = [];
    const ctx = await makeContext([makeWorkerPairDto("main-1")], {
      opencodeFetch: async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (url.pathname === "/doc") {
          return jsonResponse({ paths: { "/api/session": {} } });
        }
        if (url.pathname === "/api/session" && method === "GET") {
          return jsonResponse({ data: [
            { id: "ses_old_2", title: "main-1-2", location: { directory: "/Users/x/main-1" } },
            { id: "ses_old_4", title: "main-1-4", location: { directory: "/Users/x/main-1" } }
          ] });
        }
        if (url.pathname === "/api/session" && method === "POST") {
          created.push({ body: safeJson(init?.body) });
          return jsonResponse({ data: { id: "ses_new", title: "Agent main-1", location: { directory: "/Users/x/main-1" } } });
        }
        return jsonResponse({}, 404);
      }
    });
    try {
      await ctx.service.init();
      await expect(ctx.service.createWorkerSessionForPair("main-1")).resolves.toMatchObject({
        pairId: "main-1",
        worker: { sessionId: "ses_new", repoPath: "/Users/x/main-1" }
      });
      expect(created).toEqual([{
        body: expect.objectContaining({
          title: "main-1-5",
          location: { directory: "/Users/x/main-1" }
        })
      }]);
      expect(ctx.service.getRecentEvents({ pairId: "main-1" }).map((event) => event.type)).toContain("WORKER_SESSION_CREATED");
    } finally {
      await ctx.cleanup();
    }
  });

  it("lists and switches only enabled models for a stopped worker pair", async () => {
    const switched: Array<{ path: string; body: Record<string, unknown> | undefined }> = [];
    const ctx = await makeContext([makeWorkerPairDto("main-1")], {
      opencodeFetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/doc") {
          return jsonResponse({ paths: { "/api/session": {}, "/api/model": {} } });
        }
        if (url.pathname === "/api/model") {
          return jsonResponse({ data: [
            { providerID: "ollama", id: "small", name: "Small", enabled: true },
            { providerID: "ollama", id: "disabled", name: "Disabled", enabled: false }
          ] });
        }
        if (url.pathname === "/api/session/ses_worker_main-1" && init?.method !== "POST") {
          return jsonResponse({ data: { id: "ses_worker_main-1", model: { providerID: "ollama", id: "small" } } });
        }
        if (url.pathname === "/api/session/ses_worker_main-1/model" && init?.method === "POST") {
          switched.push({ path: url.pathname, body: safeJson(init.body) });
          return new Response(null, { status: 204 });
        }
        return jsonResponse({}, 404);
      }
    });
    try {
      await ctx.service.init();
      await expect(ctx.service.listWorkerModels("main-1")).resolves.toEqual([
        { providerID: "ollama", id: "small", name: "Small", enabled: true, current: true }
      ]);
      await expect(ctx.service.switchWorkerModel("main-1", { providerID: "ollama", id: "small" })).resolves.toBeUndefined();
      expect(switched).toEqual([{
        path: "/api/session/ses_worker_main-1/model",
        body: { model: { providerID: "ollama", id: "small" } }
      }]);
      await expect(ctx.service.switchWorkerModel("main-1", { providerID: "ollama", id: "small" }, true)).resolves.toBeUndefined();
      expect(ctx.service.getRecentEvents({ pairId: "main-1" }).map((event) => event.type)).toContain("WORKER_MODEL_PLANNER_NOTIFIED");
      await expect(ctx.service.switchWorkerModel("main-1", { providerID: "ollama", id: "disabled" }))
        .rejects.toMatchObject({ code: "UNKNOWN_WORKER_MODEL" });
    } finally {
      await ctx.cleanup();
    }
  });

  it("validates a candidate pair to READY with deterministic mocked adapters", async () => {
    const ctx = await makeContext([]);
    try {
      await ctx.service.init();
      const validation = await ctx.service.validateCandidatePair(candidate("main-1", "s_1", "c_1"));
      expect(validation.status).toBe("READY");
      expect(validation.checks).toContainEqual(
        expect.objectContaining({ name: "planner.browserReachable", status: "PASS" })
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it("discovers OpenCode sessions through a live endpoint", async () => {
    const sessions: OpenCodeSessionInfo[] = [
      { id: "s_1", title: "Alpha", location: { directory: "/repo/alpha" }, time: { updated: 123 } }
    ];
    const ctx = await makeContext([], { opencodeFetch: fakeOpenCodeFetch({ sessions }) });
    try {
      await ctx.service.init();
      const discovered = await ctx.service.discoverOpenCodeSessions({ baseUrl: "http://127.0.0.1:4096" });
      expect(discovered).toHaveLength(1);
      expect(discovered[0].sessionId).toBe("s_1");
      expect(discovered[0].repoPath).toBe("/repo/alpha");
    } finally {
      await ctx.cleanup();
    }
  });

  it("scans the active OpenCode Desktop session through the main-process service", async () => {
    const ctx = await makeContext([], {
      openCodeDesktopScan: async () => ({
        sessionId: "ses_active",
        title: "Active work",
        repoPath: "/repo/active"
      })
    });
    try {
      await ctx.service.init();
      await expect(ctx.service.scanOpenCodeDesktopSession()).resolves.toEqual({
        sessionId: "ses_active",
        title: "Active work",
        repoPath: "/repo/active"
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it("starts managed OpenCode and Chrome tools through the desktop service", async () => {
    const calls: string[] = [];
    const launcher: DesktopToolLauncher = {
      async startOpenCode(input) {
        calls.push(`opencode:${input.repoPath}:${input.baseUrl}`);
        return { ok: true, message: "started", endpoint: input.baseUrl, alreadyRunning: false };
      },
      async stopOpenCode() {
        calls.push("stop-opencode");
      },
      async updateOpenCode() {
        calls.push("update-opencode");
        return { ok: true, message: "updated" };
      },
      async startBrowser(input) {
        calls.push(`chrome:${input.cdpUrl}`);
        return { ok: true, message: "started", endpoint: input.cdpUrl, alreadyRunning: false };
      },
      async shutdown() {
        calls.push("shutdown");
      }
    };
    const ctx = await makeContext([], {
      desktopToolLauncher: launcher,
      opencodeFetch: fakeOpenCodeFetch({
        sessions: [{ id: "s_1", location: { directory: "/repo/work" } }]
      })
    });
    try {
      await ctx.service.init();
      await expect(ctx.service.startOpenCodeServer({ repoPath: "/repo/work", sessionId: "s_1" })).resolves.toMatchObject({
        endpoint: "http://127.0.0.1:4096"
      });
      await expect(ctx.service.startAutomationBrowser()).resolves.toMatchObject({
        endpoint: "http://127.0.0.1:9222"
      });
      await expect(ctx.service.updateOpenCodeCommand()).resolves.toEqual({ ok: true, message: "updated" });
      await ctx.service.shutdown();
      expect(calls).toEqual([
        "opencode:/repo/work:http://127.0.0.1:4096",
        "chrome:http://127.0.0.1:9222",
        "update-opencode",
        "shutdown"
      ]);
    } finally {
      await ctx.cleanup();
    }
  });

  it("stops a newly launched OpenCode server when it cannot load the selected session", async () => {
    let stopped = false;
    const launcher: DesktopToolLauncher = {
      async startOpenCode(input) {
        return { ok: true, message: "started", endpoint: input.baseUrl, alreadyRunning: false };
      },
      async stopOpenCode() {
        stopped = true;
      },
      async updateOpenCode() {
        return { ok: true, message: "updated" };
      },
      async startBrowser(input) {
        return { ok: true, message: "started", endpoint: input.cdpUrl, alreadyRunning: false };
      },
      async shutdown() {}
    };
    const ctx = await makeContext([], {
      desktopToolLauncher: launcher,
      opencodeFetch: async () => new Response("database incompatible", { status: 500 })
    });
    try {
      await ctx.service.init();
      await expect(
        ctx.service.startOpenCodeServer({ repoPath: "/repo/work", sessionId: "s_missing" })
      ).rejects.toMatchObject({
        code: "OPENCODE_SERVER_SESSION_UNAVAILABLE",
        details: { fallbackCommand: "opencode upgrade" }
      });
      expect(stopped).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it("creates an OpenCode session through a live endpoint", async () => {
    const ctx = await makeContext([], { opencodeFetch: fakeOpenCodeFetch() });
    try {
      await ctx.service.init();
      const created = await ctx.service.createOpenCodeSession({
        baseUrl: "http://127.0.0.1:4096",
        repoPath: "/repo/new",
        title: "New Pair"
      });
      expect(created.sessionId).toBe("created");
    } finally {
      await ctx.cleanup();
    }
  });

  it("returns opencode endpoint reachability and surfaces unreachable as not-ok", async () => {
    const reachable = await makeContext([], { opencodeFetch: fakeOpenCodeFetch() });
    try {
      await reachable.service.init();
      const ok = await reachable.service.testOpenCodeEndpoint({ baseUrl: "http://127.0.0.1:4096" });
      expect(ok.ok).toBe(true);
    } finally {
      await reachable.cleanup();
    }

    const unreachable = await makeContext([], {
      opencodeFetch: async () => {
        throw new Error("ECONNREFUSED");
      }
    });
    try {
      await unreachable.service.init();
      const bad = await unreachable.service.testOpenCodeEndpoint({ baseUrl: "http://127.0.0.1:1" });
      expect(bad.ok).toBe(false);
      expect(bad.message).toContain("not reachable");
    } finally {
      await unreachable.cleanup();
    }
  });

  it("verifies the selected OpenCode session and repository, not only the endpoint", async () => {
    const ctx = await makeContext([], {
      opencodeFetch: fakeOpenCodeFetch({
        sessions: [{ id: "s_1", title: "Active", location: { directory: "/repo/active" } }]
      })
    });
    try {
      await ctx.service.init();
      await expect(ctx.service.testOpenCodeEndpoint({
        baseUrl: "http://127.0.0.1:4096",
        sessionId: "s_1",
        repoPath: "/repo/active"
      })).resolves.toMatchObject({
        ok: true,
        message: "OpenCode endpoint, selected session, and repository match."
      });
      await expect(ctx.service.testOpenCodeEndpoint({
        baseUrl: "http://127.0.0.1:4096",
        sessionId: "s_missing",
        repoPath: "/repo/active"
      })).resolves.toMatchObject({ ok: false });
    } finally {
      await ctx.cleanup();
    }
  });

  it("tests a reachable and unreachable Chrome automation endpoint", async () => {
    const reachable = await makeContext([], { chatgptProbe: reachableProbe() });
    try {
      await reachable.service.init();
      const result = await reachable.service.testPlannerEndpoint({ cdpUrl: "http://127.0.0.1:9222" });
      expect(result.ok).toBe(true);
      expect(result.message).toContain("reachable");
    } finally {
      await reachable.cleanup();
    }

    const unreachable = await makeContext([], {
      chatgptProbe: {
        async snapshot() {
          throw new Error("connect ECONNREFUSED");
        }
      }
    });
    try {
      await unreachable.service.init();
      const bad = await unreachable.service.testPlannerEndpoint({ cdpUrl: "http://127.0.0.1:1" });
      expect(bad.ok).toBe(false);
      expect(bad.message).toMatch(/not reachable/i);
    } finally {
      await unreachable.cleanup();
    }
  });
});

function candidate(pairId: string, sessionId: string, conversationId: string) {
  return {
    pairId,
    worker: { sessionId, repoPath: `/Users/x/${pairId}` },
    planner: {
      conversationId,
      conversationUrl: `https://chatgpt.com/c/${conversationId}`
    }
  };
}

function makePairDto(pairId: string, overrides: Partial<SessionPair> = {}): SessionPair {  return {
    pairId,
    enabled: true,
    worker: { type: "opencode", sessionId: `ses_worker_${pairId}`, repoPath: `/Users/x/${pairId}` },
    planner: {
      type: "chatgpt-browser",
      conversationId: `planner-conversation-${pairId}`,
      conversationUrl: `https://chatgpt.com/c/planner-conversation-${pairId}`
    },
    ...overrides
  };
}

function makeWorkerPairDto(pairId: string, overrides: Partial<SessionPair> = {}): SessionPair {
  return makePairDto(pairId, {
    worker: {
      type: "opencode",
      sessionId: `ses_worker_${pairId}`,
      repoPath: `/Users/x/${pairId}`,
      server: { baseUrl: "http://127.0.0.1:4096" }
    },
    ...overrides
  } as Partial<SessionPair>);
}

function reachableProbe(): ChatGPTReadinessProbe {
  return {
    async snapshot() {
      return {
        browserReachable: true,
        authenticated: true,
        conversationReachable: true,
        composerAvailable: true,
        notGenerating: true
      };
    }
  };
}

interface SetupOptions {
  writeConfig?: boolean;
  pollIntervalMs?: number;
  opencodeFetch?: typeof fetch;
  chatgptProbe?: ChatGPTReadinessProbe;
  openCodeDesktopScan?: () => Promise<{ sessionId: string; title?: string; repoPath?: string }>;
  desktopToolLauncher?: DesktopToolLauncher;
  relay?: boolean;
}

async function makeContext(
  pairs: SessionPair[],
  options: SetupOptions = {}
): Promise<{ service: DesktopApplicationService; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-setup-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  const dbPath = join(directory, "agent-relay.sqlite");
  if (options.writeConfig !== false) {
    await writeFile(configPath, JSON.stringify({ pairs }), "utf8");
  }
  const service = createTestDesktopService({
    configPath,
    dbPath,
    pollIntervalMs: options.pollIntervalMs,
    opencodeFetch: options.opencodeFetch,
    chatgptProbe: options.chatgptProbe,
    openCodeDesktopScan: options.openCodeDesktopScan,
    desktopToolLauncher: options.desktopToolLauncher,
    relay: options.relay
  });
  return { service, cleanup: () => rm(directory, { force: true, recursive: true }) };
}

function fakeOpenCodeFetch(overrides: { sessions?: OpenCodeSessionInfo[] } = {}) {
  const sessions = overrides.sessions ?? [];
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/doc") {
      return jsonResponse({ paths: { "/api/health": {}, "/api/session": {} } });
    }
    if (method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({ ok: true });
    }
    if (method === "POST" && url.pathname === "/tui/select-session") {
      return jsonResponse({ ok: true });
    }
    if (method === "GET" && url.pathname === "/api/session") {
      return jsonResponse({ data: sessions });
    }
    if (method === "POST" && url.pathname === "/api/session") {
      const body = safeJson(init?.body);
      const location = safeRecord(body?.location);
      return jsonResponse({
        data: { id: body?.id ?? "created", title: body?.title, location: { directory: location?.directory } }
      });
    }
    return jsonResponse({}, 404);
  };
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function safeJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
