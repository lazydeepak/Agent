import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopApplicationService } from "../src/application/desktop-service.js";
import type { DesktopToolLauncher } from "../src/application/desktop-tool-manager.js";
import { WorkerProgressService } from "../src/application/worker-progress.js";
import type { RelayStore } from "../src/persistence/index.js";
import { filterEvents, toPairCard } from "../desktop/renderer/state.js";
import { makePair, createTestDesktopService } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function openCodeResponse(path: string, sessionId: string, text = "Last known result"): Response {
  if (path === "/doc") return json({ paths: {
    "/api/session": {}, "/api/session/active": {}, "/api/session/{sessionID}/message": {}
  } });
  if (path === "/api/health") return json({ ok: true });
  if (path === "/api/session/active") return json({ data: {} });
  if (path === `/api/session/${sessionId}`) return json({ data: { id: sessionId, title: "Bound session", directory: "/tmp" } });
  if (path === `/api/session/${sessionId}/message`) return json({ data: [
    { id: text, type: "assistant", text, finish: "stop", time: { created: 1_000 } }
  ] });
  if (path === `/api/session/${sessionId}/history`) return json({ data: [
    { id: 1, type: "todo.updated", time: 1, data: { id: "todo-1", content: "Keep the plan", status: "completed" } }
  ], hasMore: false });
  return new Response("missing", { status: 404 });
}

describe("Recovery policy B integration", () => {
  it("exposes a failed current error, clears it after exact-session recovery, and retains historical desktop events without sending", async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-policy-b-"));
    const configPath = join(directory, "pairs.json");
    const pair = makePair({ worker: { type: "opencode", sessionId: "bound-not-latest", repoPath: "/tmp",
      server: { baseUrl: "http://127.0.0.1:4096" } } });
    const config = JSON.stringify({ pairs: [pair] });
    await writeFile(configPath, config);
    let reachable = false;
    let allowStart = false;
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      requests.push({ path, method: init?.method ?? "GET" });
      if (!reachable) throw new Error("transport offline");
      if (path === "/api/session/active") return json({ data: { [pair.worker.sessionId]: { sessionID: pair.worker.sessionId } } });
      return openCodeResponse(path, pair.worker.sessionId);
    }));
    const start = vi.fn(async () => {
      if (!allowStart) throw new Error("cannot start yet");
      reachable = true;
      return { ok: true as const, endpoint: pair.worker.server!.baseUrl!, alreadyRunning: false, message: "started" };
    });
    const launcher: DesktopToolLauncher = {
      startOpenCode: start, stopOpenCode: async () => {}, shutdown: async () => {},
      updateOpenCode: async () => { throw new Error("unexpected update"); },
      startBrowser: async () => { throw new Error("unexpected browser start"); }
    };
    const service = createTestDesktopService({ configPath, dbPath: join(directory, "relay.sqlite"),
      recoveryPolicy: "safe", recoveryMaxAttempts: 1, pollIntervalMs: 50, desktopToolLauncher: launcher });
    const events: string[] = [];
    service.subscribeEvents((event) => events.push(event.type));
    try {
      await service.init();
      await service.startPair(pair.pairId);
      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });
      const failed = service.getPairStatus(pair.pairId);
      expect(failed).toMatchObject({ runtimeState: "RUNNING", supervisorState: "DISCONNECTED", worker: "failed" });
      expect(failed.lastError).toBeTruthy();
      expect(toPairCard(service.listPairs()[0], failed).lastError).toBe(failed.lastError);
      expect(events).toContain("RECOVERY_EXHAUSTED");
      allowStart = true;
      await vi.waitFor(() => expect(service.getPairStatus(pair.pairId)).toMatchObject({ worker: "connected", lastError: undefined }));
      const current = service.getPairStatus(pair.pairId);
      expect(toPairCard(service.listPairs()[0], current).lastError).toBeUndefined();
      expect(service.getStore()!.getSupervisorState(pair.pairId)).toMatchObject({ lastRecoveryErrorCode: undefined, lastRecoveryError: undefined });
      const history = filterEvents(service.getRecentEvents(), { pairId: pair.pairId });
      expect(history.map((event) => event.type)).toEqual(expect.arrayContaining([
        "RECOVERY_EXHAUSTED", "RECOVERY_SUCCEEDED", "SESSION_RECONNECTED", "PAIR_RUNTIME_RECOVERED"
      ]));
      expect(service.getPairDetail(pair.pairId)?.worker.sessionId).toBe("bound-not-latest");
      expect(await readFile(configPath, "utf8")).toBe(config);
      expect(requests.some(({ path }) => path === "/api/session/bound-not-latest")).toBe(true);
      expect(requests.some(({ path }) => path === "/api/session/bound-not-latest/message")).toBe(true);
      expect(requests.every(({ method }) => method === "GET")).toBe(true);
      expect(requests.some(({ path }) => path === "/api/session" || path === "/session")).toBe(false);
    } finally {
      await service.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["all", "session", "message", "history", "active"])(
    "preserves the last good progress through %s transport failure, then replaces it with fresh data and clears the error", async (failure) => {
      let failing = false;
      let text = "Last known result";
      const sessionId = "bound-not-latest";
      const requests: string[] = [];
      const fetchMock: typeof fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        requests.push(path);
        expect(init?.method ?? "GET").toBe("GET");
        if (failing && (failure === "all" || path.endsWith(`/${failure === "session" ? sessionId : failure}`))) {
          throw new Error("transport offline");
        }
        return openCodeResponse(path, sessionId, text);
      };
      let time = new Date("2026-09-03T00:00:00Z");
      const service = new WorkerProgressService({ listCycles: () => [] } as unknown as RelayStore,
        { baseUrl: "http://127.0.0.1:4096", fetch: fetchMock }, { clock: () => time });
      try {
        const good = structuredClone(await service.getProgress("pair-a", sessionId));
        expect(good).toMatchObject({ stale: false, live: { latestResponse: text, connectionStatus: "connected" } });
        failing = true;
        time = new Date("2026-09-03T00:01:00Z");
        const stale = await service.getProgress("pair-a", sessionId, true);
        expect(stale).toMatchObject({ stale: true, fetchedAt: good.fetchedAt,
          live: { latestResponse: text, stale: true, connectionStatus: "disconnected", providerError: "transport offline" } });
        expect(stale.plan).toEqual(good.plan);
        expect(stale.changes).toEqual(good.changes);
        expect(stale.history).toEqual(good.history);
        expect(service.getSummary("pair-a", sessionId)?.stale).toBe(true);
        failing = false;
        text = "Fresh replacement";
        const fresh = await service.getProgress("pair-a", sessionId);
        expect(fresh).toMatchObject({ stale: false, fetchedAt: time.toISOString(),
          live: { latestResponse: text, stale: false, connectionStatus: "connected", providerError: undefined } });
        expect(fresh).not.toBe(stale);
        expect(requests).not.toContain("/api/session");
      } finally { service.dispose(); }
    }
  );
});
