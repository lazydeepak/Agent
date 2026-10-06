import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopApplicationError,
  DesktopApplicationService,
  deriveManagedState,
  fingerprintPairs,
  toDesktopApplicationError
} from "../src/application/desktop-service.js";
import type { DesktopToolLauncher, OpenCodeToolInput, ToolLaunchResult } from "../src/application/desktop-tool-manager.js";
import { ConfigError } from "../src/sessions/pairs.js";
import { PairArchive, SqliteRelayStore } from "../src/persistence/index.js";
import type { RuntimeStatusSummary } from "../src/runtime/index.js";
import type { SessionPair } from "../src/types.js";
import { createTestDesktopService } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("DesktopApplicationService", () => {
  it("initializes and lists configured pair details without exposing live secrets", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")]);
    try {
      const service = ctx.service;
      await service.init();

      const pairs = service.listPairs();
      expect(pairs).toHaveLength(1);
      expect(pairs[0]).toMatchObject({
        pairId: "kisab-main",
        enabled: true,
        worker: {
          type: "opencode",
          sessionId: "ses_worker_kisab-main",
          repoPath: "/Users/lazydeepak/dev/kisab-main"
        },
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-kisab-main",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-kisab-main"
        }
      });
      const serialized = JSON.stringify(pairs);
      expect(serialized).not.toMatch(/pass(word)?|cookie|token|secret|api[_-]?key/i);

      const detail = service.getPairDetail("kisab-main");
      expect(detail?.pairId).toBe("kisab-main");
      expect(service.getPairDetail("nope")).toBeUndefined();

      await service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("stays usable with an empty pair list when the config file is missing", async () => {
    const ctx = await makeContext([], { writeConfig: false });
    try {
      await ctx.service.init();
      expect(ctx.service.listPairs()).toEqual([]);
      const status = ctx.service.getStatus();
      expect(status.enabled).toBe(0);
      expect(status.running).toBe(0);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("validates a pair to READY with deterministic mocked adapters and emits a PAIR_VALIDATED event", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")]);
    try {
      await ctx.service.init();

      const seen: string[] = [];
      ctx.service.subscribeEvents((event) => seen.push(event.type));

      const validation = await ctx.service.validatePair("kisab-main");
      expect(validation.status).toBe("READY");
      expect(validation.checks).toContainEqual(
        expect.objectContaining({ name: "worker.serverReachable", status: "PASS" })
      );

      const cached = ctx.service.getLastValidation("kisab-main");
      expect(cached?.pairId).toBe("kisab-main");
      expect(cached?.status).toBe("READY");

      expect(seen).toContain("PAIR_VALIDATED");
      const events = ctx.service.getRecentEvents();
      expect(events.some((event) => event.type === "PAIR_VALIDATED" && event.pairId === "kisab-main")).toBe(true);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("starts the OpenCode server without a session when none is given", async () => {
    const startOpenCode = vi.fn(async ({ baseUrl }: OpenCodeToolInput): Promise<ToolLaunchResult> => ({
      ok: true,
      message: "started",
      endpoint: baseUrl,
      alreadyRunning: false,
      secured: false
    }));
    const opencodeFetch = vi.fn(async () => new Response("{}", { status: 404 }));
    const ctx = await makeContext([], {
      launcher: mockLauncher(startOpenCode),
      opencodeFetch
    });
    try {
      await ctx.service.init();
      const result = await ctx.service.startOpenCodeServer({ repoPath: "/tmp/repo" });
      expect(result.ok).toBe(true);
      expect(result.endpoint).toBe("http://127.0.0.1:4096");
      expect(startOpenCode).toHaveBeenCalledWith({ repoPath: "/tmp/repo", baseUrl: "http://127.0.0.1:4096" });
      expect(opencodeFetch).not.toHaveBeenCalled();
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("fails when a selected session is not returned by the started server", async () => {
    const startOpenCode = vi.fn(async ({ baseUrl }: OpenCodeToolInput): Promise<ToolLaunchResult> => ({
      ok: true,
      message: "started",
      endpoint: baseUrl,
      alreadyRunning: false,
      secured: false
    }));
    const opencodeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/doc")) return new Response(JSON.stringify({ paths: {} }));
      if (url.startsWith("http://127.0.0.1:4096/session")) return new Response("[]");
      return new Response("{}", { status: 404 });
    });
    const ctx = await makeContext([], {
      launcher: mockLauncher(startOpenCode),
      opencodeFetch
    });
    try {
      await ctx.service.init();
      await expect(
        ctx.service.startOpenCodeServer({ repoPath: "/tmp/repo", sessionId: "nope" })
      ).rejects.toMatchObject({ code: "OPENCODE_SERVER_SESSION_UNAVAILABLE" });
      expect(opencodeFetch).toHaveBeenCalled();
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("returns recent events filtered by pair and capped by limit", async () => {
    const ctx = await makeContext([makePairDto("kisab-main"), makePairDto("b-main")]);
    try {
      await ctx.service.init();
      await ctx.service.validatePair("kisab-main");
      await ctx.service.validatePair("b-main");

      const forKisab = ctx.service.getRecentEvents({ pairId: "kisab-main" });
      expect(forKisab.length).toBeGreaterThan(0);
      for (const event of forKisab) {
        expect(event.pairId).toBe("kisab-main");
      }

      const limited = ctx.service.getRecentEvents({ limit: 1 });
      expect(limited).toHaveLength(1);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("rejects an unknown pair with a UNKNOWN_PAIR application error", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")]);
    try {
      await ctx.service.init();
      await expect(ctx.service.validatePair("nope")).rejects.toBeInstanceOf(DesktopApplicationError);
      await expect(ctx.service.validatePair("nope")).rejects.toMatchObject({ code: "UNKNOWN_PAIR" });
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("starts and stops a pair through the runtime orchestration", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();

      await ctx.service.startPair("kisab-main");
      const running = ctx.service.getPairStatus("kisab-main");
      expect(running?.runtimeState).toBe("RUNNING");

      await ctx.service.stopPair("kisab-main");
      const stopped = ctx.service.getPairStatus("kisab-main");
      expect(stopped?.runtimeState).toBe("STOPPED");
      expect(ctx.service.getStatus().running).toBe(0);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("marks a pair for resume on start and clears it on an explicit stop", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      expect(ctx.service.getResumeState()).toEqual([{ pairId: "kisab-main", resumeAfterRestart: false }]);

      await ctx.service.startPair("kisab-main");
      expect(ctx.service.getResumeState()).toEqual([{ pairId: "kisab-main", resumeAfterRestart: true }]);

      await ctx.service.stopPair("kisab-main");
      expect(ctx.service.getResumeState()).toEqual([{ pairId: "kisab-main", resumeAfterRestart: false }]);

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("marks only enabled pairs for resume on startAll", async () => {
    const ctx = await makeContext(
      [makePairDto("kisab-main"), makePairDto("b-main", { enabled: false })],
      { pollIntervalMs: 10 }
    );
    try {
      await ctx.service.init();
      await ctx.service.startAll();
      const resume = new Map(ctx.service.getResumeState().map((entry) => [entry.pairId, entry.resumeAfterRestart]));
      expect(resume.get("kisab-main")).toBe(true);
      expect(resume.get("b-main")).toBe(false);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("resumes persisted pairs after a restart but never explicitly stopped pairs", async () => {
    const ctx = await makeContext([makePairDto("kisab-main"), makePairDto("b-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      await ctx.service.startPair("kisab-main");
      await ctx.service.startPair("b-main");
      await ctx.service.stopPair("b-main");
      expect(ctx.service.getResumeState()).toEqual([
        { pairId: "kisab-main", resumeAfterRestart: true },
        { pairId: "b-main", resumeAfterRestart: false }
      ]);
      await ctx.service.shutdown();

      const restarted = createTestDesktopService({
        configPath: ctx.configPath,
        dbPath: ctx.dbPath,
        pollIntervalMs: 10
      });
      await restarted.init();
      await restarted.resumeManagedPairs();
      expect(restarted.getPairStatus("kisab-main")?.runtimeState).toBe("RUNNING");
      expect(restarted.getPairStatus("b-main")?.runtimeState).toBe("STOPPED");
      await restarted.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("starts all, pauses and resumes one pair, then stops all cleanly", async () => {
    const ctx = await makeContext([makePairDto("kisab-main"), makePairDto("b-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();

      await ctx.service.startAll();
      expect(ctx.service.getStatus().running).toBe(2);

      ctx.service.pausePair("kisab-main");
      expect(ctx.service.getPairStatus("kisab-main")?.paused).toBe(true);
      expect(ctx.service.getPairStatus("b-main")?.paused).toBe(false);

      ctx.service.resumePair("kisab-main");
      expect(ctx.service.getPairStatus("kisab-main")?.paused).toBe(false);

      const summary = await ctx.service.stopAll();
      expect(summary.running).toBe(0);
      expect(summary.failed).toBe(0);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("surfaces a runtime start failure as a typed RUNTIME_ERROR application error", async () => {
    const ctx = await makeContext([makePairDto("kisab-main", { enabled: false })], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      const pair = await ctx.service.startPair("kisab-main").catch((error: unknown) => error);
      expect(pair).toBeInstanceOf(DesktopApplicationError);
      expect((pair as DesktopApplicationError).code).toBe("RUNTIME_ERROR");
      const summary = await ctx.service.getStatus();
      expect(summary.running).toBe(0);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("refuses a duplicate-identity configuration deterministically", async () => {
    const pairA = makePairDto("kisab-main");
    const pairB = makePairDto("b-main");
    pairB.worker.sessionId = pairA.worker.sessionId;
    const ctx = await makeContext([pairA, pairB], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      expect(ctx.service.listPairs()).toEqual([]);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("rejects config mutations while any runtime is active without stopping unrelated pairs", async () => {
    const ctx = await makeContext([makePairDto("kisab-main"), makePairDto("b-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      await ctx.service.startPair("kisab-main");
      expect(ctx.service.getPairStatus("kisab-main")?.runtimeState).toBe("RUNNING");

      await expect(ctx.service.createPair({
        pairId: "c-main",
        worker: { sessionId: "ses_worker_c", repoPath: "/repo/c" },
        planner: { conversationId: "conv-c", conversationUrl: "https://chatgpt.com/c/conv-c" }
      })).rejects.toMatchObject({ code: "PAIR_RUNNING" });

      await expect(ctx.service.updatePair("b-main", { enabled: false })).rejects.toMatchObject({ code: "PAIR_RUNNING" });
      await expect(ctx.service.removePair("b-main")).rejects.toMatchObject({ code: "PAIR_RUNNING" });
      await expect(ctx.service.rebindWorker("b-main", "ses_worker_b2")).rejects.toMatchObject({ code: "PAIR_RUNNING" });

      expect(ctx.service.getPairStatus("kisab-main")?.runtimeState).toBe("RUNNING");
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("permits all config mutations once every runtime is stopped", async () => {
    const ctx = await makeContext([makePairDto("kisab-main"), makePairDto("b-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      await ctx.service.startPair("kisab-main");
      await ctx.service.startPair("b-main");
      expect(ctx.service.getStatus().running).toBe(2);

      await ctx.service.stopPair("kisab-main");
      await ctx.service.stopPair("b-main");
      expect(ctx.service.getStatus().running).toBe(0);

      const updated = await ctx.service.updatePair("b-main", { enabled: true });
      expect(updated.worker.sessionId).toBe("ses_worker_b-main");
      const rebound = await ctx.service.rebindWorker("b-main", "ses_worker_b2");
      expect(rebound.worker.sessionId).toBe("ses_worker_b2");
      await ctx.service.removePair("b-main");
      const removed = await ctx.service.createPair({
        pairId: "c-main",
        worker: { sessionId: "ses_worker_c", repoPath: "/repo/c" },
        planner: { conversationId: "conv-c", conversationUrl: "https://chatgpt.com/c/conv-c" }
      });
      expect(removed.pairId).toBe("c-main");
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("purges the removed pair's state rows from persistence on remove", async () => {
    const ctx = await makeContext([makePairDto("kisab-main"), makePairDto("b-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      await ctx.service.startPair("kisab-main");
      await ctx.service.startPair("b-main");
      await ctx.service.stopPair("kisab-main");
      await ctx.service.stopPair("b-main");

      await ctx.service.removePair("b-main");
      await ctx.service.shutdown();

      const store = new SqliteRelayStore(ctx.dbPath);
      await store.init();
      expect(store.getPairState("b-main")).toBeUndefined();
      expect(store.getSupervisorState("b-main")).toBeUndefined();
      expect(store.getRuntimeState("b-main")).toBeUndefined();
      expect(store.getRuntimeState("kisab-main")).toBeDefined();
      store.close();

      const archive = new PairArchive(join(dirname(ctx.dbPath), "archive"));
      await archive.init();
      const archived = await archive.list();
      const snapshot = archived.find((entry) => entry.pairId === "b-main");
      expect(snapshot).toBeDefined();
      expect(snapshot?.hasState).toBe(true);
      const payload = await archive.read(snapshot!.ref);
      expect(payload.config.pairId).toBe("b-main");
      expect(payload.config.worker.sessionId).toBe("ses_worker_b-main");
      await archive.remove(snapshot!.ref);
    } finally {
      await ctx.cleanup();
    }
  });

  it("does not archive when the pair is unknown and removes nothing from the config", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")]);
    try {
      await ctx.service.init();
      await expect(ctx.service.removePair("does-not-exist")).rejects.toMatchObject({ code: "UNKNOWN_PAIR" });
      expect(ctx.service.listPairs().map((pair) => pair.pairId)).toEqual(["kisab-main"]);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("requires a live OpenCode endpoint before listing sessions", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")]);
    try {
      await ctx.service.init();
      await expect(ctx.service.listOpenCodeSessions("kisab-main")).rejects.toMatchObject({
        code: "OPENCODE_UNAVAILABLE"
      });
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("shutdown is idempotent and the service refuses work after disposal", async () => {
    const ctx = await makeContext([makePairDto("kisab-main")], { pollIntervalMs: 10 });
    try {
      await ctx.service.init();
      await ctx.service.startAll();
      await ctx.service.shutdown();
      await ctx.service.shutdown();
      await expect(ctx.service.init()).rejects.toMatchObject({ code: "SERVICE_DISPOSED" });
    } finally {
      await ctx.cleanup();
    }
  });

  it("a config mutation and a start cannot interleave into a discarded running orchestrator", async () => {
    const ctx = await makeContext([makePairDto("a")]);
    try {
      await ctx.service.init();
      const results = await Promise.allSettled([
        ctx.service.startPair("a", "from-trigger"),
        ctx.service.removePair("a")
      ]);
      const removeWon = results[1].status === "fulfilled";
      if (removeWon) {
        expect(results[0].status).toBe("rejected");
        expect(ctx.service.listPairs()).toHaveLength(0);
        const status = ctx.service.getStatus();
        expect(status.pairs.every((p) => p.pairId !== "a" || p.runtimeState === "STOPPED")).toBe(true);
      } else {
        expect(results[0].status).toBe("fulfilled");
        expect(results[1].status).toBe("rejected");
        const status = ctx.service.getStatus();
        expect(status.pairs.find((p) => p.pairId === "a")?.runtimeState).toBe("RUNNING");
      }
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("keeps RelayEngine identity stable and updates configuration effectively without rebuilding", async () => {
    const ctx = await makeContext([makePairDto("a"), makePairDto("b")]);
    try {
      await ctx.service.init();
      const relayEngineBefore = (ctx.service as any).relayEngine;
      expect(relayEngineBefore).toBeDefined();

      await ctx.service.updatePair("a", { worker: { repoPath: "/Users/lazydeepak/dev/relocated" } });

      const relayEngineAfter = (ctx.service as any).relayEngine;
      expect(relayEngineAfter).toBe(relayEngineBefore);
      expect(ctx.service.getPairDetail("a")?.worker.repoPath).toBe("/Users/lazydeepak/dev/relocated");

      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("toDesktopApplicationError", () => {
  it("maps a ConfigError to a CONFIG_ERROR", () => {
    const error = toDesktopApplicationError(new ConfigError(["bad config"]));
    expect(error).toBeInstanceOf(DesktopApplicationError);
    expect(error.code).toBe("CONFIG_ERROR");
  });

  it("maps a plain Error to APPLICATION_ERROR with its message", () => {
    const error = toDesktopApplicationError(new Error("boom"));
    expect(error.code).toBe("APPLICATION_ERROR");
    expect(error.message).toBe("boom");
  });

  it("maps non-Error values to APPLICATION_ERROR", () => {
    const error = toDesktopApplicationError("oops");
    expect(error.code).toBe("APPLICATION_ERROR");
    expect(error.message).toBe("oops");
  });
});

describe("deriveManagedState", () => {
  it("reports STOPPED when no runtime is running", () => {
    const summary = makeSummary([
      { pairId: "a", runtimeState: "STOPPED" }
    ]);
    expect(deriveManagedState(summary)).toBe("STOPPED");
  });

  it("reports RUNNING when any active pair is actively supervised", () => {
    const summary = makeSummary([
      { pairId: "a", runtimeState: "RUNNING", schedulerMode: "ACTIVE" }
    ]);
    expect(deriveManagedState(summary)).toBe("RUNNING");
  });

  it("reports ARMED when all running pairs are dormant-watching", () => {
    const summary = makeSummary([
      { pairId: "a", runtimeState: "RUNNING", schedulerMode: "DORMANT_WATCH" },
      { pairId: "b", runtimeState: "RUNNING", schedulerMode: "DORMANT_WATCH" }
    ]);
    expect(deriveManagedState(summary)).toBe("ARMED");
  });

  it("reports FAILED when any running pair has failed", () => {
    const summary = makeSummary([
      { pairId: "a", runtimeState: "RUNNING", schedulerMode: "ACTIVE" },
      { pairId: "b", runtimeState: "RUNNING", schedulerMode: "DORMANT_WATCH", failed: true }
    ]);
    expect(deriveManagedState(summary)).toBe("FAILED");
  });

  it("reports RUNNING when running pairs mix active supervision and dormant watch without failure", () => {
    const summary = makeSummary([
      { pairId: "a", runtimeState: "RUNNING", schedulerMode: "ACTIVE" },
      { pairId: "b", runtimeState: "RUNNING", schedulerMode: "DORMANT_WATCH" }
    ]);
    expect(deriveManagedState(summary)).toBe("RUNNING");
  });
});

async function makeContext(
  pairs: SessionPair[],
  options: {
    pollIntervalMs?: number;
    writeConfig?: boolean;
    launcher?: DesktopToolLauncher;
    opencodeFetch?: typeof fetch;
  } = {}
): Promise<{
  service: DesktopApplicationService;
  configPath: string;
  dbPath: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-desktop-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  const dbPath = join(directory, "agent-relay.sqlite");
  if (options.writeConfig !== false) {
    await writeFile(configPath, JSON.stringify({ pairs }), "utf8");
  }
  const service = createTestDesktopService({
    configPath,
    dbPath,
    pollIntervalMs: options.pollIntervalMs ?? 10,
    ...(options.launcher ? { desktopToolLauncher: options.launcher } : {}),
    ...(options.opencodeFetch ? { opencodeFetch: options.opencodeFetch } : {})
  });
  return { service, configPath, dbPath, cleanup: () => rm(directory, { force: true, recursive: true }) };
}

function mockLauncher(startOpenCode: DesktopToolLauncher["startOpenCode"]): DesktopToolLauncher {
  return {
    startOpenCode,
    stopOpenCode: vi.fn(),
    updateOpenCode: vi.fn(),
    startBrowser: vi.fn(),
    shutdown: vi.fn()
  };
}

function makePairDto(pairId: string, overrides: Partial<SessionPair> = {}): SessionPair {
  return {
    pairId,
    enabled: true,
    worker: {
      type: "opencode",
      sessionId: `ses_worker_${pairId}`,
      repoPath: `/Users/lazydeepak/dev/${pairId}`
    },
    planner: {
      type: "chatgpt-browser",
      conversationId: `planner-conversation-${pairId}`,
      conversationUrl: `https://chatgpt.com/c/planner-conversation-${pairId}`
    },
    ...overrides
  };
}

interface SummaryPairInput {
  pairId: string;
  runtimeState: "STOPPED" | "RUNNING" | "STARTING";
  schedulerMode?: "ACTIVE" | "DORMANT_WATCH";
  failed?: boolean;
}

describe("fingerprintPairs", () => {
  it("is order-independent for the same pair set", () => {
    const a = makePairDto("a");
    const b = makePairDto("b");
    expect(fingerprintPairs([a, b])).toBe(fingerprintPairs([b, a]));
  });

  it("changes when a non-id field (repo path) changes but not when order changes", () => {
    const a = makePairDto("a");
    const first = fingerprintPairs([a]);
    const relocated = { ...a, worker: { ...a.worker, repoPath: "/Users/lazydeepak/dev/relocated" } };
    expect(fingerprintPairs([relocated])).not.toBe(first);
    expect(fingerprintPairs([{ ...relocated }])).toBe(fingerprintPairs([relocated]));
  });

  it("changes when enabled or the worker endpoint changes", () => {
    const a = makePairDto("a");
    expect(fingerprintPairs([{ ...a, enabled: false }])).not.toBe(fingerprintPairs([a]));
    const withEndpoint = {
      ...a,
      worker: { ...a.worker, server: { baseUrl: "http://localhost:4242" } }
    };
    expect(fingerprintPairs([withEndpoint])).not.toBe(fingerprintPairs([a]));
  });
});

function makeSummary(pairs: SummaryPairInput[]): RuntimeStatusSummary {
  return {
    enabled: pairs.length,
    running: pairs.filter((pair) => pair.runtimeState === "RUNNING" || pair.runtimeState === "STARTING").length,
    healthy: 0,
    degraded: 0,
    failed: 0,
    pairs: pairs.map((pair) => ({
      pairId: pair.pairId,
      runtimeState: pair.runtimeState,
      supervisorState: pair.failed ? "FAILED" : "IDLE",
      worker: pair.failed ? "failed" : "connected",
      planner: pair.failed ? "failed" : "connected",
      recovering: false,
      workerObserved: true,
      plannerObserved: true,
      paused: false,
      enabled: true,
      schedulerMode: pair.schedulerMode
    }))
  };
}
