import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WorkerProgressService } from "../src/application/worker-progress.js";
import type { RelayStore } from "../src/persistence/index.js";

function makeStore(overrides: Partial<RelayStore> = {}): RelayStore {
  return {
    listCycles: () => [],
    listDurableEvents: () => [],
    getSupervisorState: () => undefined,
    upsertRuntimeState: () => {},
    touchRuntimeState: () => {},
    ...overrides
  } as RelayStore;
}

function makeMessages(overrides: Record<string, unknown> = {}) {
  return {
    data: [
      {
        id: "msg-1",
        info: { id: "msg-1", role: "assistant", finish: "stop" },
        text: "Hello world",
        time: { created: Date.now() / 1000 - 10 },
        ...overrides
      }
    ]
  };
}

function makeActiveSessions(sessionId: string) {
  return { [sessionId]: { sessionID: sessionId } };
}

describe("WorkerProgressService", () => {
  let clock: () => Date;

  beforeEach(() => {
    clock = vi.fn(() => new Date("2025-01-15T12:00:00Z"));
  });

  describe("session identity caching", () => {
    it("caches by pairId:sessionId composite key", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });
      const fetchCalls: string[] = [];

      const mockClient = {
        getSession: vi.fn(async () => ({ title: "Test" })),
        listSessionMessages: vi.fn(async () => makeMessages()),
        history: vi.fn(async () => ({ data: [], hasMore: false })),
        listActiveSessions: vi.fn(async () => ({}))
      };

      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async (pairId: string, _sessionId: string, _opts?: unknown) => {
        fetchCalls.push(pairId);
        return {
          pairId,
          sessionId: _sessionId,
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      const result1 = await service.getProgress("pair-a", "sess-1");
      const result2 = await service.getProgress("pair-a", "sess-1");
      const result3 = await service.getProgress("pair-a", "sess-2");

      expect(fetchCalls).toHaveLength(2);
      expect(result1).toBe(result2);
      expect(result3).not.toBe(result1);
      service.dispose();
    });

    it("invalidates specific session on rebind", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      let fetchCount = 0;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async (pairId: string, sessionId: string) => {
        fetchCount++;
        return {
          pairId,
          sessionId,
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      await service.getProgress("pair-a", "sess-1");
      expect(fetchCount).toBe(1);

      service.invalidate("pair-a", "sess-1");

      await service.getProgress("pair-a", "sess-1");
      expect(fetchCount).toBe(2);

      await service.getProgress("pair-a", "sess-1");
      expect(fetchCount).toBe(2);

      service.dispose();
    });

    it("invalidates all sessions for a pair when no sessionId given", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async (pairId: string, sessionId: string) => ({
        pairId,
        sessionId,
        fetchedAt: clock().toISOString(),
        stale: false,
        live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
        plan: [],
        changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
        history: []
      }));

      await service.getProgress("pair-a", "sess-1");
      await service.getProgress("pair-a", "sess-2");

      service.invalidate("pair-a");

      const fresh1 = await service.getProgress("pair-a", "sess-1");
      const fresh2 = await service.getProgress("pair-a", "sess-2");

      expect(fresh1.stale).toBe(false);
      expect(fresh2.stale).toBe(false);
      service.dispose();
    });
  });

  function progressFetch(
    requests: string[],
    transform: (response: Response, url: URL) => Response | Promise<Response>
  ): typeof fetch {
    return async (input) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      let response: Response;
      if (url.pathname === "/doc") {
        response = json({ paths: {
          "/api/session": {}, "/api/session/active": {}, "/api/session/{sessionID}/message": {}
        } });
      } else if (url.pathname.endsWith("/message")) {
        response = progressResponse(url.hostname.includes("endpoint") ? `endpoint ${url.hostname[9]?.toUpperCase()}` : `session ${url.hostname[8]?.toUpperCase()}`);
      } else if (url.pathname.endsWith("/active")) {
        response = json({ data: {} });
      } else if (url.pathname.endsWith("/history")) {
        response = json({ data: [], hasMore: false });
      } else {
        response = json({ data: { id: url.pathname.split("/").at(-1), title: "Bound session" } });
      }
      return transform(response, url);
    };
  }

  function progressResponse(text: string): Response {
    return json({ data: [{ id: "assistant", role: "assistant", text, finish: "stop", time: { created: 1_000 } }] });
  }

  function json(value: unknown): Response {
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  }

  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
  }

  describe("failure and stale reporting", () => {
    it("returns stale snapshot with error on fetch failure when cache exists", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      let shouldFail = false;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async (pairId: string, sessionId: string) => {
        if (shouldFail) throw new Error("Network failure");
        return {
          pairId,
          sessionId,
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "connected", sseConnected: false, stale: false, currentTask: "Building" },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      const ok = await service.getProgress("pair-a", "sess-1");
      expect(ok.live.currentTask).toBe("Building");
      expect(ok.stale).toBe(false);

      shouldFail = true;
      const stale = await service.getProgress("pair-a", "sess-1", true);
      expect(stale.stale).toBe(true);
      expect(stale.live.stale).toBe(true);
      expect(stale.live.connectionStatus).toBe("disconnected");
      expect(stale.live.providerError).toBe("Network failure");
      expect(stale.live.currentTask).toBe("Building");

      service.dispose();
    });

    it("returns disconnected state on first fetch failure with no cache", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => {
        throw new Error("Connection refused");
      });

      const result = await service.getProgress("pair-a", "sess-1");
      expect(result.stale).toBe(true);
      expect(result.live.state).toBe("disconnected");
      expect(result.live.connectionStatus).toBe("disconnected");
      expect(result.live.sseConnected).toBe(false);
      expect(result.live.providerError).toBe("Connection refused");

      service.dispose();
    });

    it("marks stale on HTTP errors and preserves error details", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      let callCount = 0;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async (pairId: string, sessionId: string) => {
        callCount++;
        if (callCount === 1) {
          return {
            pairId,
            sessionId,
            fetchedAt: clock().toISOString(),
            stale: false,
            live: { state: "idle", connectionStatus: "connected", sseConnected: false, stale: false },
            plan: [],
            changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
            history: []
          };
        }
        const err = new Error("HTTP 404: Not Found") as Error & { status: number; statusText: string };
        err.status = 404;
        err.statusText = "Not Found";
        throw err;
      });

      await service.getProgress("pair-a", "sess-1");
      const stale = await service.getProgress("pair-a", "sess-1", true);

      expect(stale.stale).toBe(true);
      expect(stale.live.providerError).toContain("404");

      service.dispose();
    });
  });

  describe("coalescing", () => {
    it("coalesces rapid scheduleRefresh calls", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock, coalesceMs: 100 });

      let fetchCount = 0;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => {
        fetchCount++;
        return {
          pairId: "pair-a",
          sessionId: "sess-1",
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      service.scheduleRefresh("pair-a", "sess-1");
      service.scheduleRefresh("pair-a", "sess-1");
      service.scheduleRefresh("pair-a", "sess-1");

      await vi.waitFor(() => {
        expect(fetchCount).toBe(1);
      }, { timeout: 500 });

      service.dispose();
    });

    it("respects maxCoalesceMs cap", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock, coalesceMs: 1000, maxCoalesceMs: 200 });

      let fetchCount = 0;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => {
        fetchCount++;
        return {
          pairId: "pair-a",
          sessionId: "sess-1",
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      service.scheduleRefresh("pair-a", "sess-1");

      await vi.waitFor(() => {
        expect(fetchCount).toBe(1);
      }, { timeout: 500 });

      service.dispose();
    });

    it("calls onProgressUpdate callback after successful refresh", async () => {
      const store = makeStore();
      const updates: Array<{ pairId: string; sessionId: string }> = [];
      const service = new WorkerProgressService(store, {}, {
        clock,
        coalesceMs: 50,
        onProgressUpdate: (pairId, sessionId) => updates.push({ pairId, sessionId })
      });

      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => ({
        pairId: "pair-a",
        sessionId: "sess-1",
        fetchedAt: clock().toISOString(),
        stale: false,
        live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
        plan: [],
        changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
        history: []
      }));

      service.scheduleRefresh("pair-a", "sess-1");

      await vi.waitFor(() => {
        expect(updates).toHaveLength(1);
      }, { timeout: 500 });

      expect(updates[0]).toEqual({ pairId: "pair-a", sessionId: "sess-1" });
      service.dispose();
    });

    it("cancels a queued refresh when its session is invalidated", async () => {
      const service = new WorkerProgressService(makeStore(), {}, { clock, coalesceMs: 50 });
      let fetchCount = 0;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => {
        fetchCount++;
        return {
          pairId: "pair-a",
          sessionId: "sess-1",
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "connected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      service.scheduleRefresh("pair-a", "sess-1");
      service.invalidate("pair-a", "sess-1");

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fetchCount).toBe(0);
      service.dispose();
    });
  });

  describe("per-pair endpoint isolation", () => {
    it("passes per-pair openCodeOptions through to fetchProgress", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, { baseUrl: "http://default:3000" }, { clock });

      let capturedOptions: unknown;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async (_pairId: string, _sessionId: string, opts?: unknown) => {
        capturedOptions = opts;
        return {
          pairId: _pairId,
          sessionId: _sessionId,
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      await service.getProgress("pair-a", "sess-1", false, { baseUrl: "http://pair-a:4000" });
      expect(capturedOptions).toEqual({ baseUrl: "http://pair-a:4000" });

      await service.getProgress("pair-b", "sess-2", false, { baseUrl: "http://pair-b:5000" });
      expect(capturedOptions).toEqual({ baseUrl: "http://pair-b:5000" });

      service.dispose();
    });

    it("falls back to default options when per-pair options not provided", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, { baseUrl: "http://default:3000" }, { clock });

      let capturedOptions: unknown;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async (_pairId: string, _sessionId: string, opts?: unknown) => {
        capturedOptions = opts;
        return {
          pairId: _pairId,
          sessionId: _sessionId,
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      await service.getProgress("pair-a", "sess-1");
      expect(capturedOptions).toBeUndefined();

      service.dispose();
    });
  });

  describe("observation freshness", () => {
    it("reports an active dispatched cycle as working when the latest message is the worker prompt", async () => {
      const service = new WorkerProgressService(makeStore({
        listCycles: () => [{
          id: 1,
          pairId: "pair-a",
          plannerSourceMessageId: "planner-1",
          workerDispatchMessageId: "worker-1",
          dispatchedAt: "2025-01-15T11:00:00Z",
          cycleStatus: "DISPATCHED"
        }]
      }), {
        baseUrl: "http://active-cycle.test",
        fetch: progressFetch([], (response, url) => {
          if (url.pathname.endsWith("/message")) {
            return json({ data: [{
              id: "worker-1",
              role: "user",
              text: "Process this task",
              time: { created: 1_736_937_600 }
            }] });
          }
          if (url.pathname.endsWith("/active")) {
            return json({ data: { "sess-1": { type: "running" } } });
          }
          return response;
        })
      }, { clock });

      const progress = await service.getProgress("pair-a", "sess-1", true);

      expect(progress.live.state).toBe("working");
      expect(progress.live.stale).toBe(false);
      expect(progress.live.elapsedMs).toBe(3_600_000);
      service.dispose();
    });

    it("marks an inactive dispatched cycle as stale waiting work", async () => {
      const service = new WorkerProgressService(makeStore({
        listCycles: () => [
          {
            id: 1,
            pairId: "pair-a",
            plannerSourceMessageId: "planner-1",
            workerDispatchMessageId: "worker-1",
            dispatchedAt: "2025-01-15T11:00:00Z",
            cycleStatus: "DISPATCHED"
          },
          {
            id: 2,
            pairId: "pair-a",
            plannerSourceMessageId: "planner-2",
            workerDispatchMessageId: "worker-2",
            dispatchedAt: "2025-01-15T11:30:00Z",
            workerCompletedAt: "2025-01-15T11:35:00Z",
            cycleStatus: "DELIVERED"
          }
        ]
      }), {
        baseUrl: "http://stale-cycle.test",
        fetch: progressFetch([], (response) => response)
      }, { clock });

      const progress = await service.getProgress("pair-a", "sess-1", true);

      expect(progress.live.state).toBe("waiting");
      expect(progress.stale).toBe(true);
      expect(progress.live.stale).toBe(true);
      expect(progress.live.elapsedMs).toBeUndefined();
      expect(progress.live.inputRequired).toBe("Worker is not active; verify the dispatched cycle.");
      expect(progress.currentCycleId).toBe(1);
      service.dispose();
    });

    it("accepts current OpenCode millisecond timestamps and nested durable-event timestamps", async () => {
      const created = 1_736_942_400_000;
      const service = new WorkerProgressService(makeStore(), {
        baseUrl: "http://current-shape.test",
        fetch: progressFetch([], (response, url) => {
          if (url.pathname.endsWith("/message")) {
            return json({
              data: [{
                info: { id: "assistant", role: "assistant", finish: "stop", time: { created } },
                parts: [{ type: "text", text: "Finished" }]
              }]
            });
          }
          if (url.pathname.endsWith("/history")) {
            return json({
              data: [{
                id: "evt-current",
                type: "session.next.step.started",
                data: { timestamp: created }
              }],
              hasMore: false
            });
          }
          if (/\/api\/session\/[^/]+$/.test(url.pathname)) {
            return json({ data: { id: "sess-1", title: "Bound session", time: { created } } });
          }
          return response;
        })
      }, { clock });

      const progress = await service.getProgress("pair-a", "sess-1", true);

      expect(progress.stale).toBe(false);
      expect(progress.live.connectionStatus).toBe("connected");
      expect(progress.live.lastEventAt).toBe("2025-01-15T12:00:00.000Z");
      expect(progress.changes.sessionStartedAt).toBe("2025-01-15T12:00:00.000Z");
      expect(progress.history).toContainEqual(expect.objectContaining({
        id: "durable-evt-current",
        timestamp: "2025-01-15T12:00:00.000Z"
      }));
      service.dispose();
    });

    it("forces a new production fetch for a manual refresh", async () => {
      const requests: string[] = [];
      let response = "first";
      const service = new WorkerProgressService(makeStore(), {
        baseUrl: "http://session-b.test",
        fetch: progressFetch(requests, (original, url) =>
          url.pathname.includes("/message") ? progressResponse(response) : original
        )
      }, { clock });

      await service.getProgress("pair-a", "sess-1");
      response = "second";
      const refreshed = await service.getProgress("pair-a", "sess-1", true);

      expect(refreshed.live.latestResponse).toBe("second");
      expect(requests.filter((path) => path.includes("/message"))).toHaveLength(2);
      service.dispose();
    });

    it("keeps the current session cache when an old-session request completes late", async () => {
      const oldMessage = deferred<Response>();
      const service = new WorkerProgressService(makeStore(), {
        fetch: progressFetch([], (response, url) =>
          url.hostname === "session-a.test" && url.pathname.endsWith("/message") ? oldMessage.promise : response
        )
      }, { clock });

      const oldRequest = service.getProgress("pair-a", "session-a", true, { baseUrl: "http://session-a.test" });
      service.invalidate("pair-a", "session-a");
      const current = await service.getProgress("pair-a", "session-b", true, { baseUrl: "http://session-b.test" });
      oldMessage.resolve(progressResponse("session A"));
      await oldRequest;
      const displayed = await service.getProgress("pair-a", "session-b", false, { baseUrl: "http://session-b.test" });

      expect(current.sessionId).toBe("session-b");
      expect(displayed.sessionId).toBe("session-b");
      expect(displayed.live.latestResponse).toBe("session B");
      service.dispose();
    });

    it("keeps the current endpoint cache when the previous endpoint responds late", async () => {
      const oldMessage = deferred<Response>();
      const service = new WorkerProgressService(makeStore(), {
        fetch: progressFetch([], (response, url) =>
          url.hostname === "endpoint-a.test" && url.pathname.endsWith("/message") ? oldMessage.promise : response
        )
      }, { clock });

      const oldRequest = service.getProgress("pair-a", "sess-1", true, { baseUrl: "http://endpoint-a.test" });
      const current = await service.getProgress("pair-a", "sess-1", true, { baseUrl: "http://endpoint-b.test" });
      oldMessage.resolve(progressResponse("endpoint A"));
      await oldRequest;
      const displayed = await service.getProgress("pair-a", "sess-1", false, { baseUrl: "http://endpoint-b.test" });

      expect(current.live.latestResponse).toBe("endpoint B");
      expect(displayed.live.latestResponse).toBe("endpoint B");
      service.dispose();
    });

    it("keeps the latest same-session observation when concurrent refreshes finish out of order", async () => {
      const first = deferred<Response>();
      const second = deferred<Response>();
      let messageRequests = 0;
      const service = new WorkerProgressService(makeStore(), {
        baseUrl: "http://same.test",
        fetch: progressFetch([], (response, url) => {
          if (!url.pathname.endsWith("/message")) return response;
          messageRequests += 1;
          return messageRequests === 1 ? first.promise : second.promise;
        })
      }, { clock });

      const older = service.getProgress("pair-a", "sess-1", true);
      const newer = service.getProgress("pair-a", "sess-1", true);
      second.resolve(progressResponse("newer"));
      await newer;
      first.resolve(progressResponse("older"));
      await older;
      const displayed = await service.getProgress("pair-a", "sess-1");

      expect(displayed.live.latestResponse).toBe("newer");
      service.dispose();
    });
  });

  describe("plan deduplication", () => {
    it("deduplicates todo items by id via buildPlan", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      // Mock fetchProgress to call the real buildPlan logic
      const mockBuildPlan = (service as unknown as { buildPlan: (events: Array<{ type: string; data?: Record<string, unknown>; time: number }>) => unknown[] }).buildPlan.bind(service);
      const events = [
        { type: "todo.updated", data: { id: "todo-1", content: "Step 1", status: "completed" }, time: Date.now() / 1000 },
        { type: "todo.updated", data: { id: "todo-1", content: "Step 1", status: "completed" }, time: Date.now() / 1000 },
        { type: "todo.updated", data: { id: "todo-2", content: "Step 2", status: "in_progress" }, time: Date.now() / 1000 }
      ];
      const plan = mockBuildPlan(events);
      expect(plan).toHaveLength(2);

      service.dispose();
    });
  });

  describe("dispose", () => {
    it("clears all state on dispose", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock, coalesceMs: 100 });

      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => ({
        pairId: "pair-a",
        sessionId: "sess-1",
        fetchedAt: clock().toISOString(),
        stale: false,
        live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
        plan: [],
        changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
        history: []
      }));

      await service.getProgress("pair-a", "sess-1");
      service.scheduleRefresh("pair-a", "sess-1");

      // Summary is available before dispose
      expect(service.getSummary("pair-a", "sess-1")).toBeDefined();

      service.dispose();

      // After dispose, caches are cleared so summary returns undefined
      expect(service.getSummary("pair-a", "sess-1")).toBeUndefined();

      // getProgress still works (fetches fresh)
      const after = await service.getProgress("pair-a", "sess-1");
      expect(after.stale).toBe(false);
      expect(after.live.state).toBe("idle");
    });

    it("does not schedule new refreshes after dispose", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock, coalesceMs: 50 });

      let fetchCount = 0;
      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => {
        fetchCount++;
        return {
          pairId: "pair-a",
          sessionId: "sess-1",
          fetchedAt: clock().toISOString(),
          stale: false,
          live: { state: "idle", connectionStatus: "disconnected", sseConnected: false, stale: false },
          plan: [],
          changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
          history: []
        };
      });

      service.dispose();
      service.scheduleRefresh("pair-a", "sess-1");

      await new Promise((r) => setTimeout(r, 200));
      expect(fetchCount).toBe(0);
    });
  });

  describe("sseConnected independence", () => {
    it("sseConnected is always false — does not infer from activity", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => ({
        pairId: "pair-a",
        sessionId: "sess-1",
        fetchedAt: clock().toISOString(),
        stale: false,
        live: { state: "working", connectionStatus: "connected", sseConnected: false, stale: false },
        plan: [],
        changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
        history: []
      }));

      const result = await service.getProgress("pair-a", "sess-1");
      expect(result.live.sseConnected).toBe(false);

      service.dispose();
    });
  });

  describe("getSummary", () => {
    it("returns summary from cache", async () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });

      // @ts-expect-error testing internal
      service.fetchProgress = vi.fn(async () => ({
        pairId: "pair-a",
        sessionId: "sess-1",
        fetchedAt: clock().toISOString(),
        stale: false,
        live: { state: "working", connectionStatus: "connected", sseConnected: false, stale: false, currentTask: "Building" },
        plan: [],
        changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
        history: []
      }));

      await service.getProgress("pair-a", "sess-1");
      const summary = service.getSummary("pair-a", "sess-1");
      expect(summary).toEqual({
        pairId: "pair-a",
        state: "working",
        currentTask: "Building",
        currentTool: undefined,
        elapsedMs: undefined,
        stale: false
      });

      service.dispose();
    });

    it("returns undefined for unknown pair", () => {
      const store = makeStore();
      const service = new WorkerProgressService(store, {}, { clock });
      expect(service.getSummary("unknown", "sess-1")).toBeUndefined();
      service.dispose();
    });
  });
});
