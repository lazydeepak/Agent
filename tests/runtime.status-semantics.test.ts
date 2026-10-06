import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import type { BackoffPolicy } from "../src/recovery/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import { RuntimeOrchestrator } from "../src/runtime/orchestrator.js";
import { PairRuntime } from "../src/runtime/pair-runtime.js";
import { MemorySupervisorLogger } from "../src/supervisor/events.js";
import { ControllableWorker, makePair } from "./helpers.js";

const INSTANT_BACKOFF: BackoffPolicy = { delaysMs: [1, 1, 1] };
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-status-semantics-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();
  return store;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for runtime condition.");
}

describe("PairRuntime status semantics (Connected/Idle/Working/Recovering)", () => {
  it("reports a reachable, idle worker as connected + idle (not degraded)", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    worker.setSessionActive(false);
    store.touchSupervisorState({ pairId: makePair().pairId, lastRecoveryErrorCode: "OPENCODE_UNREACHABLE", lastRecoveryError: "old outage" });
    const runtime = new PairRuntime({
      pair: makePair(),
      store,
      worker,
      planner: new FakeChatGPTBrowserAdapter(),
      pollIntervalMs: 60_000
    });
    try {
      await runtime.start();
      await waitFor(() => runtime.status().supervisorState !== undefined);
      const status = runtime.status();
      expect(status.worker).toBe("connected");
      expect(status.workerActivity).toBe("idle");
      expect(status.recovering).toBe(false);
      expect(status.lastError).toBeUndefined();
      expect(store.getSupervisorState(runtime.pairId)?.lastRecoveryErrorCode).toBeUndefined();
    } finally {
      await runtime.stop();
      store.close();
    }
  });

  it("reports an actively generating worker as connected + working", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    worker.setSessionActive(true);
    const runtime = new PairRuntime({
      pair: makePair(),
      store,
      worker,
      planner: new FakeChatGPTBrowserAdapter(),
      pollIntervalMs: 60_000
    });
    try {
      await runtime.start();
      await waitFor(() => runtime.status().supervisorState !== undefined);
      const status = runtime.status();
      expect(status.worker).toBe("connected");
      expect(status.workerActivity).toBe("working");
    } finally {
      await runtime.stop();
      store.close();
    }
  });

  it("reports server unreachable as a transport-level failure, not idle", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    worker.setUnreachable();
    const runtime = new PairRuntime({
      pair: makePair(),
      store,
      worker,
      planner: new FakeChatGPTBrowserAdapter(),
      pollIntervalMs: 60_000
    });
    try {
      await runtime.start();
      await waitFor(() => runtime.status().worker === "failed");
      const status = runtime.status();
      expect(status.worker).toBe("failed");
      expect(status.workerFailureReason).toBe("transport");
      expect(status.workerActivity).toBeUndefined();
    } finally {
      await runtime.stop();
      store.close();
    }
  });

  it("reports a missing session as a session-level failure, distinct from transport failure", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    worker.setSessionMissing();
    const runtime = new PairRuntime({
      pair: makePair(),
      store,
      worker,
      planner: new FakeChatGPTBrowserAdapter(),
      pollIntervalMs: 60_000
    });
    try {
      await runtime.start();
      await waitFor(() => runtime.status().worker === "failed");
      const status = runtime.status();
      expect(status.worker).toBe("failed");
      expect(status.workerFailureReason).toBe("session");
    } finally {
      await runtime.stop();
      store.close();
    }
  });

  it("clears the current recovery error on successful recovery while historical Events survive", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    worker.setUnreachable();
    const events: string[] = [];
    const runtime = new PairRuntime({
      pair: makePair(),
      store,
      worker,
      planner: new FakeChatGPTBrowserAdapter(),
      pollIntervalMs: 20,
      onEvent: (event) => events.push(event.type),
      recovery: {
        policy: "safe",
        baseUrl: "http://127.0.0.1:4096",
        maxAttempts: 5,
        backoff: INSTANT_BACKOFF,
        startServerLauncher: async () => {
          worker.reachable = true;
          return { endpoint: "http://127.0.0.1:4096", alreadyRunning: false };
        }
      }
    });
    try {
      await runtime.start();
      await waitFor(() => runtime.status().worker === "failed");
      expect(store.getSupervisorState(runtime.pairId)?.lastRecoveryErrorCode).toBeUndefined();

      // Allow recovery attempts (server becomes reachable inside startServerLauncher above).
      await waitFor(() => runtime.status().worker === "connected", 10_000);

      const continuity = store.getSupervisorState(runtime.pairId);
      expect(continuity?.lastRecoveryErrorCode).toBeUndefined();
      expect(continuity?.lastRecoverySuccessAt).toBeDefined();
      // Historical recovery events must remain even though the current error cleared.
      expect(events.some((type) => type === "RECOVERY_STARTED" || type === "RECOVERY_SUCCEEDED")).toBe(true);
    } finally {
      await runtime.stop();
      store.close();
    }
  }, 20_000);
});

describe("getPairStatus reflects persisted runtime ownership from a fresh process", () => {
  it("reports RUNNING for an unloaded pair whose runtime_enabled is persisted", async () => {
    const store = await openStore();
    const pair = makePair();
    store.touchRuntimeState({ pairId: pair.pairId, runtimeEnabled: true, lastRuntimeStartAt: new Date().toISOString() });
    store.touchSupervisorState({ pairId: pair.pairId, lastSupervisorState: "IDLE" });

    const orchestrator = new RuntimeOrchestrator({
      pairs: [pair],
      store,
      logger: new MemorySupervisorLogger(),
      perPairLogs: false,
      pollIntervalMs: 60_000,
      adapterFor: () => ({ worker: new ControllableWorker(), planner: new FakeChatGPTBrowserAdapter() })
    });

    // The pair was never started in this process: the status is sourced purely from persistence.
    const status = orchestrator.getPairStatus(pair.pairId);
    expect(status).toMatchObject({
      runtimeState: "RUNNING",
      supervisorState: "IDLE",
      worker: "unknown",
      planner: "unknown"
    });

    store.close();
  });

  it("reports STOPPED for an unloaded pair with runtime_enabled cleared (explicit stop)", async () => {
    const store = await openStore();
    const pair = makePair();
    store.touchRuntimeState({ pairId: pair.pairId, runtimeEnabled: false });

    const orchestrator = new RuntimeOrchestrator({
      pairs: [pair],
      store,
      logger: new MemorySupervisorLogger(),
      perPairLogs: false,
      pollIntervalMs: 60_000,
      adapterFor: () => ({ worker: new ControllableWorker(), planner: new FakeChatGPTBrowserAdapter() })
    });

    expect(orchestrator.getPairStatus(pair.pairId)?.runtimeState).toBe("STOPPED");
    store.close();
  });
});
