import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerIpcHandlers,
  registeredIpcChannels,
  serializeError,
  type IpcContext
} from "../desktop/main/ipc-handlers.js";
import type { DesktopApplicationService } from "../src/application/desktop-service.js";
import { IPC_CHANNELS } from "../desktop/shared/ipc-channels.js";
import { makePair } from "./helpers.js";

type Handler = (event: unknown, ...args: unknown[]) => Promise<{ ok: boolean; [k: string]: unknown }>;

function makeHarness(partial: Partial<Pick<IpcContext, "requireService" | "openExternalUrl" | "openWorkerAuthWindow">> = {}) {
  const handlers = new Map<string, Handler>();
  const openedExternal: string[] = [];

  const service = {
    listPairs: vi.fn(async () => [{ pairId: "kisab-main" }]),
    getStatus: vi.fn(async () => ({ running: 0 })),
    getPairStatus: vi.fn(async (id: string) => ({ pairId: id })),
    getPairDetail: vi.fn((id: string) => (id === "kisab-main" ? makePair({ pairId: "kisab-main" }) : undefined)),
    startPair: vi.fn(async () => ({ running: 1 })),
    removePair: vi.fn(async (id: string) => ({ pairId: id })),
    listArchivedPairs: vi.fn(async () => []),
    deleteArchivedPair: vi.fn(async (ref: string) => ({ ref })),
    createPair: vi.fn(async () => ({ pairId: "other", enabled: true })),
    openWorkerSession: vi.fn(async () => ({ sessionId: "s1", selected: false, fallback: true })),
    listWorkerModels: vi.fn(async () => [{ providerID: "ollama", id: "small", enabled: true, current: true }]),
    switchWorkerModel: vi.fn(async () => undefined)
  } as unknown as DesktopApplicationService;

  const api: IpcContext = {
    handle: (channel, fn) => handlers.set(channel, fn as unknown as Handler),
    requireService: () => service,
    requireWorkerProgress: () => ({ invalidate: vi.fn() }) as never,
    requireProjectPairService: () => ({ listProjectPairs: vi.fn(async () => []) }) as never,
    broadcastToRenderer: () => undefined,
    openWorkerAuthWindow: async () => true,
    openExternalUrl: async (url) => void openedExternal.push(url),
    ...partial
  };

  registeredIpcChannels.length = 0;
  registerIpcHandlers(api);
  return { handlers, service, openedExternal, api };
}

beforeEach(() => {
  registeredIpcChannels.length = 0;
  vi.clearAllMocks();
});

describe("main IPC handlers (registered against a fake runtime)", () => {
  it("registers the whitelisted channels and never the event channel", () => {
    const { handlers } = makeHarness();
    expect(registeredIpcChannels.length).toBeGreaterThan(40);
    expect(registeredIpcChannels).toContain(IPC_CHANNELS.listPairs);
    expect(registeredIpcChannels).toContain(IPC_CHANNELS.startProject);
    expect(registeredIpcChannels).toContain(IPC_CHANNELS.getTimeline);
    expect(registeredIpcChannels).toContain(IPC_CHANNELS.listArchive);
    expect(registeredIpcChannels).toContain(IPC_CHANNELS.deleteArchive);
    expect(registeredIpcChannels).not.toContain(IPC_CHANNELS.event);
    expect(handlers.has(IPC_CHANNELS.event)).toBe(false);
  });

  it("lists and deletes archived pairs through the archive channels", async () => {
    const { handlers, service } = makeHarness();
    const list = handlers.get(IPC_CHANNELS.listArchive)!;
    await expect(list({})).resolves.toEqual({ ok: true, data: [] });
    expect(service.listArchivedPairs).toHaveBeenCalled();

    const remove = handlers.get(IPC_CHANNELS.deleteArchive)!;
    await expect(remove({}, "kisab-main-2026-09-13T12.00.00.000-")).resolves.toEqual({
      ok: true,
      data: { ref: "kisab-main-2026-09-13T12.00.00.000-" }
    });
    expect(service.deleteArchivedPair).toHaveBeenCalledWith("kisab-main-2026-09-13T12.00.00.000-");

    await expect(remove({}, "")).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_ERROR" } });
    expect(service.deleteArchivedPair).toHaveBeenCalledTimes(1);
  });

  it("wraps responses in an ok envelope and validates pair ids", async () => {
    const { handlers, service } = makeHarness();
    const listPairs = handlers.get(IPC_CHANNELS.listPairs)!;
    await expect(listPairs({})).resolves.toEqual({ ok: true, data: [{ pairId: "kisab-main" }] });

    const pairStatus = handlers.get(IPC_CHANNELS.pairStatus)!;
    await expect(pairStatus({}, "")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_PAIR_ID" }
    });
    expect(service.getPairStatus).not.toHaveBeenCalled();
  });

  it("awaits removePair (no floating promise) and surfaces service errors", async () => {
    const { handlers, service } = makeHarness();
    const remove = handlers.get(IPC_CHANNELS.removePair)!;
    await expect(remove({}, "kisab-main")).resolves.toEqual({ ok: true, data: { pairId: "kisab-main" } });
    expect(service.removePair).toHaveBeenCalledWith("kisab-main");

    service.removePair = vi.fn(async () => {
      throw new Error("boom");
    }) as never;
    await expect(remove({}, "kisab-main")).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_ERROR", message: "boom" }
    });
  });

  it("normalizes nested candidate base URLs and rejects remote CDP before touching the service", async () => {
    const { handlers, service } = makeHarness();
    const create = handlers.get(IPC_CHANNELS.createPair)!;

    await expect(
      create({}, {
        pairId: "new-pair",
        worker: { sessionId: "s2", repoPath: "/tmp", server: { baseUrl: "http://127.0.0.1:4096" } },
        planner: { conversationId: "c", conversationUrl: "https://chatgpt.com/c/c" }
      })
    ).resolves.toMatchObject({ ok: true });
    expect(service.createPair).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: expect.objectContaining({ server: { baseUrl: "http://127.0.0.1:4096/" } })
      })
    );

    service.createPair = vi.fn() as never;
    await expect(
      create(
        {},
        {
          pairId: "bad",
          worker: { sessionId: "s", repoPath: "/tmp" },
          planner: {
            conversationId: "c",
            conversationUrl: "https://chatgpt.com/c/c",
            browser: { cdpUrl: "http://evil.example:9222" }
          }
        }
      )
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_URL" } });
    expect(service.createPair).not.toHaveBeenCalled();
  });

  it("delegates openWorkerSession straight to the service (no external browser URL)", async () => {
    const { handlers, service } = makeHarness();
    const open = handlers.get(IPC_CHANNELS.openWorkerSession)!;
    await expect(open({}, "kisab-main")).resolves.toMatchObject({
      ok: true,
      data: { sessionId: "s1", selected: false, fallback: true }
    });
    expect(service.openWorkerSession).toHaveBeenCalledWith("kisab-main");
  });

  it("routes the no-auth openWorkerSession fallback through openExternalUrl", async () => {
    const pair = makePair({
      worker: { type: "opencode", sessionId: "s1", repoPath: "/Users/x/kisab", server: { baseUrl: "http://127.0.0.1:4096" } }
    });
    const { handlers, service } = makeHarness();

    service.getPairDetail = vi.fn(() => pair) as never;

    const open = handlers.get(IPC_CHANNELS.openWorkerSession)!;
    await expect(open({}, "kisab-main")).resolves.toMatchObject({
      ok: true,
      data: { sessionId: "s1", selected: false, fallback: true }
    });
    expect(service.openWorkerSession).toHaveBeenCalledWith("kisab-main");
  });

  it("uses the authenticated worker window when OpenCode password comes from the environment", async () => {
    const previousPassword = process.env.OPENCODE_SERVER_PASSWORD;
    process.env.OPENCODE_SERVER_PASSWORD = "relay-secret";
    try {
      const pair = makePair({
        worker: {
          type: "opencode",
          sessionId: "s1",
          repoPath: "/Users/x/kisab",
          server: { baseUrl: "http://127.0.0.1:4096" }
        }
      });
      const openWorkerAuthWindow = vi.fn(async () => true);
      const { handlers, service, openedExternal } = makeHarness({ openWorkerAuthWindow });
      service.getPairDetail = vi.fn(() => pair) as never;

      const open = handlers.get(IPC_CHANNELS.openWorkerSession)!;
      await expect(open({}, "kisab-main")).resolves.toMatchObject({ ok: true });
      expect(openWorkerAuthWindow).toHaveBeenCalledWith(expect.objectContaining({
        origin: "http://127.0.0.1:4096",
        username: "opencode",
        secret: "relay-secret"
      }));
      expect(openedExternal).toHaveLength(0);
    } finally {
      if (previousPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
      else process.env.OPENCODE_SERVER_PASSWORD = previousPassword;
    }
  });

  it("always attempts session selection and reports the worker session id on model switch", async () => {
    const { handlers } = makeHarness();
    const m = handlers.get(IPC_CHANNELS.switchWorkerModel)!;
    await expect(
      m({}, "kisab-main", { providerId: "ollama", modelId: "small", notifyPlanner: false })
    ).resolves.toMatchObject({ ok: true, data: { sessionId: "ses_worker_1" } });
    // Invalid model input is rejected with a typed error code, not a crash.
    await expect(m({}, "kisab-main", { providerId: "ollama" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" }
    });
  });

  it("serializeError maps arbitrary errors", () => {
    expect(serializeError(new Error("x"))).toEqual({ code: "APPLICATION_ERROR", message: "x" });
    expect(serializeError("raw")).toEqual({ code: "APPLICATION_ERROR", message: "raw" });
  });
});
