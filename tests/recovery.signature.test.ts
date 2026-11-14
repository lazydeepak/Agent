import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import { RecoveryEngine } from "../src/recovery/index.js";
import type { BackoffPolicy } from "../src/recovery/index.js";
import { MemorySupervisorLogger } from "../src/supervisor/events.js";
import type { ObservationSnapshot, SupervisorContinuity } from "../src/types.js";
import { ControllableWorker, RecordingBrowserManager, makePair, noopSleep } from "./helpers.js";

const INSTANT_BACKOFF: BackoffPolicy = { delaysMs: [1, 1] };
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-signature-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent.sqlite"));
  await store.init();
  return store;
}

function healthyPlanner(): ObservationSnapshot["planner"] {
  return {
    reachable: true,
    authenticated: true,
    conversationReachable: true,
    composerAvailable: true,
    generating: false,
    detail: []
  };
}

function snapshot(): ObservationSnapshot {
  return {
    pairId: "kisab-main",
    observedAt: "2026-08-31T10:00:00.000Z",
    worker: {
      reachable: false,
      sessionExists: true,
      sessionActive: false,
      gathering: false,
      detail: []
    },
    planner: healthyPlanner()
  };
}

function continuity(overrides: Partial<SupervisorContinuity> = {}): SupervisorContinuity {
  return { pairId: "kisab-main", paused: false, ...overrides };
}

describe("RecoveryEngine — identical failure signature (v1.1 §11.4)", () => {
  it("suspends automated recovery after two identical recovery failures and keeps operator-only release", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    worker.failHealthNext(1_000);
    const logger = new MemorySupervisorLogger();
    const engine = new RecoveryEngine({
      pair: makePair(),
      worker,
      planner: new FakeChatGPTBrowserAdapter(),
      browser: new RecordingBrowserManager("external"),
      store,
      logger,
      now: () => new Date("2026-08-31T10:00:00.000Z"),
      backoff: INSTANT_BACKOFF,
      sleep: noopSleep
    });

    try {
      const first = await engine.attempt({ state: "DISCONNECTED", snapshot: snapshot(), continuity: continuity() });
      expect(first.performed).toBe(true);
      expect(first.recovered).toBe(false);
      expect(store.getSupervisorState("kisab-main")?.identicalFailureCount).toBe(1);
      expect(store.getSupervisorState("kisab-main")?.recoverySuspended).toBeUndefined();

      const persisted = store.getSupervisorState("kisab-main");
      const second = await engine.attempt({ state: "DISCONNECTED", snapshot: snapshot(), continuity: persisted ?? continuity() });
      expect(second.performed).toBe(true);
      expect(second.recovered).toBe(false);

      const after = store.getSupervisorState("kisab-main");
      expect(after?.identicalFailureCount).toBe(2);
      expect(after?.recoverySuspended).toBe(true);
      expect(after?.incidentDisposition).toBe("awaiting_operator");
      const suspension = logger.events.find((event) => event.type === "RECOVERY_SUSPENDED");
      expect(suspension?.details).toMatchObject({ action: "identical-failure-signature", count: 2 });

      const third = await engine.attempt({ state: "DISCONNECTED", snapshot: snapshot(), continuity: after ?? continuity() });
      expect(third.code).toBe("RECOVERY_SUSPENDED");
      expect(third.performed).toBe(false);
    } finally {
      store.close();
    }
  });

  it("a different failure signature resets the repeat counter", async () => {
    const store = await openStore();
    const worker = new ControllableWorker();
    const logger = new MemorySupervisorLogger();
    const engine = new RecoveryEngine({
      pair: makePair(),
      worker,
      planner: new FakeChatGPTBrowserAdapter(),
      browser: new RecordingBrowserManager("external"),
      store,
      logger,
      now: () => new Date("2026-08-31T10:00:00.000Z"),
      backoff: INSTANT_BACKOFF,
      sleep: noopSleep
    });

    try {
      worker.failHealthNext(1_000);
      const first = await engine.attempt({ state: "DISCONNECTED", snapshot: snapshot(), continuity: continuity() });
      expect(first.performed).toBe(true);

      worker.failHealthNext(0);
      worker.setSessionMissing();
      const second = await engine.attempt({
        state: "DISCONNECTED",
        snapshot: snapshot(),
        continuity: store.getSupervisorState("kisab-main") ?? continuity()
      });
      expect(second.performed).toBe(true);
      expect(second.recovered).toBe(false);
      // Session-missing failure is a *different* signature — counter resets, no suspension.
      expect(store.getSupervisorState("kisab-main")?.identicalFailureCount).toBe(1);
      expect(store.getSupervisorState("kisab-main")?.recoverySuspended).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
