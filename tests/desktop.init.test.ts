import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopLifecycle, type DesktopLifecycleHooks } from "../src/application/desktop-lifecycle.js";
import { DesktopApplicationError, DesktopApplicationService } from "../src/application/desktop-service.js";
import { WorkerProgressService } from "../src/application/worker-progress.js";
import type { RelayStore } from "../src/persistence/index.js";
import { createTestDesktopService } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  vi.restoreAllMocks();
});

function validStore(): RelayStore {
  return { listCycles: () => [] } as unknown as RelayStore;
}

function trackingHooks(overrides: Partial<DesktopLifecycleHooks> = {}): DesktopLifecycleHooks & {
  calls: { createWorkerProgress: number; register: number; unregister: number; window: number; resume: number };
  errors: DesktopApplicationError[];
} {
  const calls = { createWorkerProgress: 0, register: 0, unregister: 0, window: 0, resume: 0 };
  const errors: DesktopApplicationError[] = [];
  return {
    calls,
    errors,
    createWorkerProgress: () => {
      calls.createWorkerProgress += 1;
      return { dispose: () => undefined };
    },
    registerOperationalHandlers: () => {
      calls.register += 1;
    },
    unregisterOperationalHandlers: () => {
      calls.unregister += 1;
    },
    createWindow: async () => {
      calls.window += 1;
    },
    resumeManagedPairs: async () => {
      calls.resume += 1;
    },
    reportFatalError: (error) => {
      errors.push(error);
    },
    ...overrides
  };
}

function fakeService(overrides: {
  init?: () => Promise<void>;
  store?: RelayStore | undefined;
  shutdown?: () => Promise<void>;
} = {}): {
  service: { init: () => Promise<void>; getStore: () => RelayStore | undefined; shutdown: () => Promise<void> };
  shutdownCalls: { count: number };
} {
  const shutdownCalls = { count: 0 };
  let shutdown = overrides.shutdown;
  if (!shutdown) {
    shutdown = async () => {
      shutdownCalls.count += 1;
    };
  } else {
    const inner = shutdown;
    shutdown = async () => {
      shutdownCalls.count += 1;
      await inner();
    };
  }
  return {
    shutdownCalls,
    service: {
      init: overrides.init ?? (async () => undefined),
      getStore: () => overrides.store,
      shutdown
    }
  };
}

describe("desktop initialization lifecycle", () => {
  it("fails closed on store initialization failure without constructing worker progress or registering handlers", async () => {
    const storeError = new DesktopApplicationError("STORE_INIT_FAILED", "cannot open database");
    const { service, shutdownCalls } = fakeService({
      init: async () => {
        throw storeError;
      },
      store: undefined
    });
    const hooks = trackingHooks();
    const lifecycle = new DesktopLifecycle(service, hooks);

    const result = await lifecycle.boot();

    expect(result.status).toBe("failed");
    expect(lifecycle.getState()).toBe("failed");
    // WorkerProgressService is never constructed after a fatal failure.
    expect(hooks.calls.createWorkerProgress).toBe(0);
    // No IPC/runtime/event registration after a fatal failure.
    expect(hooks.calls.register).toBe(0);
    expect(hooks.calls.window).toBe(0);
    expect(hooks.calls.resume).toBe(0);
    expect(hooks.calls.unregister).toBe(0);
    // Partial initialization is cleaned up exactly once (service shutdown).
    expect(shutdownCalls.count).toBe(1);
    expect(lifecycle.getCleanupCount()).toBe(1);
    // One clear actionable error, reported exactly once.
    expect(hooks.errors).toHaveLength(1);
    expect(hooks.errors[0]).toBe(storeError);
    expect(lifecycle.getErrorReportCount()).toBe(1);

    // Repeated shutdown after partial initialization stays safe and single-cleanup.
    await lifecycle.shutdown();
    await lifecycle.shutdown();
    expect(lifecycle.getState()).toBe("stopped");
    expect(lifecycle.getCleanupCount()).toBe(1);
    expect(shutdownCalls.count).toBe(1);
    expect(hooks.errors).toHaveLength(1);
  });

  it("fails closed when the store is missing after init even without a thrown error", async () => {
    const { service } = fakeService({ store: undefined });
    const hooks = trackingHooks();
    const lifecycle = new DesktopLifecycle(service, hooks);

    const result = await lifecycle.boot();

    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") {
      expect(result.error.code).toBe("STORE_UNAVAILABLE");
      expect(result.error.message).toMatch(/database/i);
    }
    expect(hooks.calls.createWorkerProgress).toBe(0);
    expect(hooks.calls.register).toBe(0);
    expect(hooks.errors).toHaveLength(1);
    expect(lifecycle.getState()).toBe("failed");
  });

  it("rejects an invalid store object without constructing worker progress", async () => {
    const { service } = fakeService({ store: {} as unknown as RelayStore });
    const hooks = trackingHooks();
    const lifecycle = new DesktopLifecycle(service, hooks);

    const result = await lifecycle.boot();

    expect(result.status).toBe("failed");
    expect(hooks.calls.createWorkerProgress).toBe(0);
    expect(hooks.calls.register).toBe(0);
    expect(hooks.errors).toHaveLength(1);
  });

  it("fails closed when worker-progress construction throws, without registering handlers", async () => {
    const { service } = fakeService({ store: validStore() });
    const hooks = trackingHooks({
      createWorkerProgress: () => {
        throw new Error("progress blew up");
      }
    });
    const lifecycle = new DesktopLifecycle(service, hooks);

    const result = await lifecycle.boot();

    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") {
      expect(result.error.code).toBe("WORKER_PROGRESS_INIT_FAILED");
    }
    expect(hooks.calls.register).toBe(0);
    expect(hooks.calls.window).toBe(0);
    expect(hooks.calls.resume).toBe(0);
    expect(hooks.errors).toHaveLength(1);
    expect(lifecycle.getState()).toBe("failed");
  });

  it("unregisters handlers and reports once when window creation fails", async () => {
    const { service } = fakeService({ store: validStore() });
    const hooks = trackingHooks();
    hooks.createWindow = async () => {
      hooks.calls.window += 1;
      throw new Error("no display");
    };
    const lifecycle = new DesktopLifecycle(service, hooks);

    const result = await lifecycle.boot();

    expect(result).toMatchObject({ status: "failed" });
    if (result.status === "failed") {
      expect(result.error.code).toBe("WINDOW_CREATION_FAILED");
    }
    expect(hooks.calls.register).toBe(1);
    expect(hooks.calls.unregister).toBe(1);
    expect(hooks.calls.resume).toBe(0);
    expect(hooks.errors).toHaveLength(1);
    expect(lifecycle.getCleanupCount()).toBe(1);
  });

  it("reaches ready with handlers, window, and resume when the store is usable", async () => {
    const { service } = fakeService({ store: validStore() });
    const hooks = trackingHooks();
    const lifecycle = new DesktopLifecycle(service, hooks);

    const result = await lifecycle.boot();

    expect(result).toEqual({ status: "ready" });
    expect(lifecycle.getState()).toBe("ready");
    expect(lifecycle.isOperational()).toBe(true);
    expect(hooks.calls.createWorkerProgress).toBe(1);
    expect(hooks.calls.register).toBe(1);
    expect(hooks.calls.window).toBe(1);
    expect(hooks.calls.resume).toBe(1);
    expect(hooks.errors).toHaveLength(0);
  });

  it("completes persisted-pair resume before reporting the desktop lifecycle ready", async () => {
    const order: string[] = [];
    const { service } = fakeService({ store: validStore() });
    const hooks = trackingHooks();
    hooks.createWindow = async () => {
      order.push("window");
      hooks.calls.window += 1;
    };
    hooks.resumeManagedPairs = async () => {
      order.push("resume");
      hooks.calls.resume += 1;
    };
    const lifecycle = new DesktopLifecycle(service, hooks);

    await lifecycle.boot();

    expect(order).toEqual(["window", "resume"]);
    expect(lifecycle.getState()).toBe("ready");
  });

  it("still reaches ready when resume fails (best-effort) without a second error report", async () => {
    const { service } = fakeService({ store: validStore() });
    const hooks = trackingHooks();
    hooks.resumeManagedPairs = async () => {
      hooks.calls.resume += 1;
      throw new Error("resume failed");
    };
    const lifecycle = new DesktopLifecycle(service, hooks);

    const result = await lifecycle.boot();

    expect(result).toEqual({ status: "ready" });
    expect(hooks.errors).toHaveLength(0);
    expect(lifecycle.getState()).toBe("ready");
  });

  it("honors shutdown racing with a deferred initialization without constructing anything", async () => {
    let resolveInit!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
    const { service, shutdownCalls } = fakeService({
      init: () => gate,
      store: validStore()
    });
    const hooks = trackingHooks();
    const lifecycle = new DesktopLifecycle(service, hooks);

    const bootPromise = lifecycle.boot();
    // Shutdown arrives while service.init() is still pending.
    const shutdownPromise = lifecycle.shutdown();
    resolveInit();
    const [result] = await Promise.all([bootPromise, shutdownPromise.then(() => ({ status: "aborted" as const }))]);

    expect(result.status).toBe("aborted");
    expect(lifecycle.getState()).toBe("stopped");
    // Shutdown during init cannot race with service construction: nothing operational was built.
    expect(hooks.calls.createWorkerProgress).toBe(0);
    expect(hooks.calls.register).toBe(0);
    expect(hooks.calls.window).toBe(0);
    expect(hooks.calls.resume).toBe(0);
    expect(hooks.errors).toHaveLength(0);
    expect(lifecycle.getCleanupCount()).toBe(1);
    expect(shutdownCalls.count).toBe(1);

    // Repeated shutdown requests remain safe.
    await lifecycle.shutdown();
    expect(lifecycle.getCleanupCount()).toBe(1);
  });

  it("aborts before init when shutdown was already requested", async () => {
    const { service, shutdownCalls } = fakeService({ store: validStore() });
    const hooks = trackingHooks();
    const lifecycle = new DesktopLifecycle(service, hooks);
    await lifecycle.shutdown();

    const result = await lifecycle.boot();

    expect(result.status).toBe("aborted");
    expect(hooks.calls.createWorkerProgress).toBe(0);
    expect(hooks.calls.register).toBe(0);
    expect(shutdownCalls.count).toBe(1);
  });
});

describe("WorkerProgressService store guard", () => {
  it("throws instead of accepting an undefined store", () => {
    expect(() => new WorkerProgressService(undefined as unknown as RelayStore)).toThrow(TypeError);
    expect(() => new WorkerProgressService({} as unknown as RelayStore)).toThrow(TypeError);
  });
});

describe("DesktopApplicationService store access", () => {
  it("requireStore throws STORE_UNAVAILABLE before init", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-init-"));
    tempDirs.push(directory);
    const service = createTestDesktopService({
      configPath: join(directory, "pairs.json"),
      dbPath: join(directory, "relay.sqlite")
    });
    expect(() => service.requireStore()).toThrow(expect.objectContaining({ code: "STORE_UNAVAILABLE" }));
    await service.shutdown();
  });

  it("stays recoverable with a missing pair configuration when the store is usable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-init-"));
    tempDirs.push(directory);
    const service = createTestDesktopService({
      configPath: join(directory, "missing-pairs.json"),
      dbPath: join(directory, "relay.sqlite")
    });
    await service.init();
    expect(service.requireStore().listCycles("kisab-main")).toEqual([]);
    expect(service.listPairs()).toEqual([]);
    expect(service.getStatus().enabled).toBe(0);
    await service.shutdown();
  });

  it("stays recoverable with an invalid pair configuration when the store is usable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-init-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    await writeFile(configPath, "{ not valid json", "utf8");
    const service = createTestDesktopService({
      configPath,
      dbPath: join(directory, "relay.sqlite")
    });
    await service.init();
    expect(service.requireStore().listCycles("kisab-main")).toEqual([]);
    expect(service.listPairs()).toEqual([]);
    await service.shutdown();
  });
});
