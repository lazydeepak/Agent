import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import { RecoveryEngine } from "../src/recovery/index.js";
import type { BackoffPolicy } from "../src/recovery/index.js";
import { MemorySupervisorLogger, type SupervisorEvent } from "../src/supervisor/events.js";
import type { ObservationSnapshot, SupervisorContinuity } from "../src/types.js";
import { ControllableWorker, RecordingBrowserManager, makePair, noopSleep } from "./helpers.js";
import { classify, emptyCycleContext } from "../src/supervisor/classifier.js";

const INSTANT_BACKOFF: BackoffPolicy = { delaysMs: [1, 1] };

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-engine-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent-relay.sqlite"));
  await store.init();
  return store;
}

function healthyWorker(snapshot: Partial<ObservationSnapshot["worker"]> = {}): ObservationSnapshot["worker"] {
  return {
    reachable: true,
    sessionExists: true,
    sessionActive: true,
    gathering: false,
    detail: [],
    ...snapshot
  };
}

function healthyPlanner(snapshot: Partial<ObservationSnapshot["planner"]> = {}): ObservationSnapshot["planner"] {
  return {
    reachable: true,
    authenticated: true,
    conversationReachable: true,
    composerAvailable: true,
    generating: false,
    detail: [],
    ...snapshot
  };
}

function snapshot(snapshot: Omit<ObservationSnapshot, "pairId" | "observedAt">, pairId = "kisab-main"): ObservationSnapshot {
  return {
    pairId,
    observedAt: "2026-08-31T10:00:00.000Z",
    ...snapshot
  };
}

function continuity(overrides: Partial<SupervisorContinuity> = {}): SupervisorContinuity {
  return { pairId: "kisab-main", paused: false, ...overrides };
}

async function engineHooks(overrides: Partial<ConstructorParameters<typeof RecoveryEngine>[0]> = {}) {
  const store = await openStore();
  const worker = new ControllableWorker();
  const planner = new FakeChatGPTBrowserAdapter();
  const browser = new RecordingBrowserManager("external");
  const logger = new MemorySupervisorLogger();
  const forwarded: SupervisorEvent[] = [];

  const engine = new RecoveryEngine({
    pair: makePair(),
    worker,
    planner,
    browser,
    store,
    logger,
    onEvent: (event) => forwarded.push(event),
    now: () => new Date("2026-08-31T10:00:00.000Z"),
    backoff: INSTANT_BACKOFF,
    sleep: noopSleep,
    ...overrides
  });

  return { store, worker, planner, browser, logger, engine, forwarded };
}

describe("RecoveryEngine", () => {
  it("holds a rate-limited planner without attempting authentication recovery", async () => {
    const { store, engine, logger } = await engineHooks();
    const observed = snapshot({ worker: healthyWorker(), planner: healthyPlanner({ reachable: false,
      authenticated: false, rateLimitedUntil: Date.parse("2026-08-31T10:05:00.000Z") }) });
    try {
      expect(classify({ snapshot: observed, cycle: emptyCycleContext(), continuity: continuity() }).state).toBe("WAITING_PLANNER");
      const run = await engine.attempt({ state: "DISCONNECTED", snapshot: observed, continuity: continuity() });
      expect(run).toMatchObject({ performed: false, intervention: false });
      expect(run.code).toBeUndefined();
      expect(logger.events).toHaveLength(0);
    } finally { store.close(); }
  });
  it("does not announce transport recovery for a failed step on healthy endpoints", async () => {
    const { store, engine, logger } = await engineHooks();
    try {
      for (let tick = 0; tick < 3; tick++) {
        const run = await engine.attempt({ state: "FAILED",
          snapshot: snapshot({ worker: healthyWorker(), planner: healthyPlanner() }),
          continuity: continuity() });
        expect(run).toMatchObject({ performed: false, intervention: true, attemptCount: 0 });
      }
      expect(logger.events).toHaveLength(0);
    } finally { store.close(); }
  });
  it("does nothing while the pair is paused", async () => {
    const { store, engine, logger } = await engineHooks();
    const run = await engine.attempt({
      state: "DISCONNECTED",
      snapshot: snapshot({ worker: healthyWorker({ reachable: false }), planner: healthyPlanner() }),
      continuity: continuity({ paused: true })
    });

    expect(run.performed).toBe(false);
    expect(run.attemptCount).toBe(0);
    expect(logger.events).toHaveLength(0);
    expect(store.getSupervisorState("kisab-main")?.recoveryAttemptCount).toBeUndefined();
    store.close();
  });

  it("does nothing under recovery policy none", async () => {
    const { engine, logger, store } = await engineHooks({ policy: "none" });
    const run = await engine.attempt({
      state: "DISCONNECTED",
      snapshot: snapshot({ worker: healthyWorker({ reachable: false }), planner: healthyPlanner() }),
      continuity: continuity()
    });

    expect(run.performed).toBe(false);
    expect(logger.events).toHaveLength(0);
    store.close();
  });

  it("blocks automatic recovery while an interrupted delivery is pending and demands intervention", async () => {
    const { store, engine, logger } = await engineHooks();
    store.createRecord({
      pairId: "kisab-main",
      direction: "worker-to-planner",
      sourceMessageId: "partial-1",
      sourceHash: "hash-partial"
    });
    store.updateStatus(
      {
        pairId: "kisab-main",
        direction: "worker-to-planner",
        sourceMessageId: "partial-1",
        sourceHash: "hash-partial"
      },
      "DELIVERING",
      {}
    );

    const run = await engine.attempt({
      state: "DISCONNECTED",
      snapshot: snapshot({ worker: healthyWorker({ reachable: false }), planner: healthyPlanner() }),
      continuity: continuity()
    });

    expect(run.code).toBe("RELAY_AMBIGUOUS");
    expect(run.intervention).toBe(true);
    expect(run.performed).toBe(false);
    expect(logger.events.map((event) => event.type)).toContain("AMBIGUOUS_DELIVERY_BLOCKED");
    expect(logger.events.map((event) => event.type)).not.toContain("RECOVERY_RETRY");
    store.close();
  });

  it("reconnects a temporarily unreachable worker and records recovery metadata", async () => {
    const { store, worker, logger, engine, forwarded } = await engineHooks();
    worker.failHealthNext(1);

    const run = await engine.attempt({
      state: "DISCONNECTED",
      snapshot: snapshot({ worker: healthyWorker({ reachable: false }), planner: healthyPlanner() }),
      continuity: continuity(),
      previousState: "WORKING"
    });

    expect(run.performed).toBe(true);
    expect(run.recovered).toBe(true);
    expect(run.code).toBeUndefined();

    const types = logger.events.map((event) => event.type);
    expect(types).toContain("PEER_DISCONNECTED");
    expect(types).toContain("RECOVERY_STARTED");
    expect(types).toContain("RECOVERY_RETRY");
    expect(types).toContain("RECOVERY_SUCCEEDED");
    expect(types).toContain("SESSION_RECONNECTED");

    expect(forwarded.map((event) => event.type)).toEqual(types);
    expect(forwarded.every((event) => event.pairId === "kisab-main" && event.time === "2026-08-31T10:00:00.000Z")).toBe(true);

    const persisted = store.getSupervisorState("kisab-main");
    expect(persisted).toMatchObject({
      recoveryAttemptCount: 1,
      lastRecoverySuccessAt: "2026-08-31T10:00:00.000Z"
    });
    store.close();
  });

  it("emits RECOVERY_EXHAUSTED and persists an error when the worker stays down", async () => {
    const { store, worker, logger, engine } = await engineHooks({ maxAttempts: 2 });
    worker.setUnreachable();

    const run = await engine.attempt({
      state: "DISCONNECTED",
      snapshot: snapshot({ worker: healthyWorker({ reachable: false }), planner: healthyPlanner() }),
      continuity: continuity()
    });

    expect(run.recovered).toBe(false);
    expect(run.code).toBe("OPENCODE_UNREACHABLE");
    expect(run.intervention).toBe(false);
    expect(logger.events.map((event) => event.type)).toContain("RECOVERY_EXHAUSTED");

    const persisted = store.getSupervisorState("kisab-main");
    expect(persisted?.recoveryAttemptCount).toBe(1);
    expect(persisted?.lastRecoveryErrorCode).toBe("OPENCODE_UNREACHABLE");
    expect(persisted?.lastRecoveryError).toBe("The OpenCode server endpoint is unreachable or did not respond.");
    store.close();
  });

  it("surfaces a missing session as intervention and never rebinds", async () => {
    const { store, logger, engine } = await engineHooks();
    const run = await engine.attempt({
      state: "FAILED",
      snapshot: snapshot({ worker: healthyWorker({ sessionExists: false }), planner: healthyPlanner() }),
      continuity: continuity()
    });

    expect(run.code).toBe("OPENCODE_SESSION_MISSING");
    expect(run.intervention).toBe(true);
    expect(logger.events.map((event) => event.type)).toContain("RECOVERY_FAILED");
    const persisted = store.getSupervisorState("kisab-main");
    expect(persisted?.lastRecoveryErrorCode).toBe("OPENCODE_SESSION_MISSING");
    store.close();
  });

  it("surfaces a planner auth failure as intervention", async () => {
    const { store, logger, engine } = await engineHooks();
    const run = await engine.attempt({
      state: "FAILED",
      snapshot: snapshot({ worker: healthyWorker(), planner: healthyPlanner({ authenticated: false }) }),
      continuity: continuity()
    });

    expect(run.code).toBe("CHATGPT_AUTH_REQUIRED");
    expect(run.intervention).toBe(true);
    expect(logger.events.map((event) => event.type)).toContain("INTERVENTION_REQUIRED");
    store.close();
  });

  it("treats STUCK as verify-only and clears the state when progress resumed", async () => {
    const { store, worker, logger, engine } = await engineHooks();
    worker.setMessages([
      { id: "report-2", source: "worker", role: "assistant", text: "new report", createdAt: 3_000 }
    ]);
    const before = snapshot({
      worker: healthyWorker({ gathering: false, latestMessageCreatedAt: 1_000, lastAssistantMessageCreatedAt: 1_000 }),
      planner: healthyPlanner()
    });

    const run = await engine.attempt({
      state: "STUCK",
      snapshot: before,
      continuity: continuity({ lastSupervisorState: "WORKING" })
    });

    expect(run.performed).toBe(true);
    expect(run.recovered).toBe(true);
    expect(run.action).toBe("verify-only");
    expect(logger.events.map((event) => event.type)).toContain("RECOVERY_SUCCEEDED");
    const persisted = store.getSupervisorState("kisab-main");
    expect(persisted?.recoveryAttemptCount).toBe(1);
    store.close();
  });

  it("nudges a healthy but stalled worker once after verification finds no progress", async () => {
    const { store, worker, engine, logger } = await engineHooks();
    worker.setMessages([
      { id: "old-1", source: "worker", role: "assistant", text: "old report", createdAt: 1_000 }
    ]);
    worker.setMessages([
      { id: "old-1", source: "worker", role: "assistant", text: "old report", createdAt: 1_000 }
    ]);

    const run = await engine.attempt({
      state: "STUCK",
      snapshot: snapshot({
        worker: healthyWorker({ gathering: false, latestMessageCreatedAt: 2_000, lastAssistantMessageCreatedAt: 2_000 }),
        planner: healthyPlanner()
      }),
      continuity: continuity({ lastSupervisorState: "WORKING" })
    });

    expect(run.code).toBeUndefined();
    expect(run.intervention).toBe(false);
    expect(logger.events.map((event) => event.type)).toContain("RECOVERY_RETRY");
    expect(worker.sentPlannerMessages).toHaveLength(1);
    expect(worker.sentPlannerMessages[0]?.message.text).toContain("continue the existing work");
    expect(store.listRecords("kisab-main")).toHaveLength(0);
    store.close();
  });

  it("clears the last recovery error after a subsequent success", async () => {
    const { store, worker, engine } = await engineHooks({ maxAttempts: 1 });
    store.touchSupervisorState({
      pairId: "kisab-main",
      recoveryAttemptCount: 4,
      lastRecoveryErrorCode: "OPENCODE_UNREACHABLE",
      lastRecoveryError: "old failure"
    });

    worker.failHealthNext(0);

    const run = await engine.attempt({
      state: "FAILED",
      snapshot: snapshot({ worker: healthyWorker({ reachable: false }), planner: healthyPlanner() }),
      continuity: continuity({ recoveryAttemptCount: 4 })
    });

    expect(run.recovered).toBe(true);
    const persisted = store.getSupervisorState("kisab-main");
    expect(persisted?.recoveryAttemptCount).toBe(5);
    expect(persisted?.lastRecoveryErrorCode).toBeUndefined();
    expect(persisted?.lastRecoveryError).toBeUndefined();
    expect(persisted?.lastRecoverySuccessAt).toBe("2026-08-31T10:00:00.000Z");
    store.close();
  });

  it("does not emit PEER_DISCONNECTED again on a repeated disconnected tick", async () => {
    const { logger, worker, engine, store } = await engineHooks();
    worker.setUnreachable();
    const input = {
      state: "DISCONNECTED" as const,
      snapshot: snapshot({ worker: healthyWorker({ reachable: false }), planner: healthyPlanner() }),
      continuity: continuity()
    };

    await engine.attempt({ ...input, previousState: "WORKING" });
    await engine.attempt({ ...input, previousState: "DISCONNECTED" });

    const disconnected = logger.events.filter((event) => event.type === "PEER_DISCONNECTED");
    expect(disconnected).toHaveLength(1);
    store.close();
  });
});
