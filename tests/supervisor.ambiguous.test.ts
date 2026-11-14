/**
 * Rule 12/13 — ambiguous delivery verification: identity-based reconciliation,
 * the 2-minute verification interval, and bounded attempts with Recovery Agent escalation.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { StaticOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";
import { hashText } from "../src/util/canonical.js";
import { MemorySupervisorLogger } from "../src/supervisor/events.js";
import { Supervisor } from "../src/supervisor/supervisor.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function openStore(): Promise<RelayStore> {
  const directory = await mkdtemp(join(tmpdir(), "agent-ambig-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "agent.sqlite"));
  await store.init();
  return store;
}

function backdateVerifyAttempt(store: RelayStore, iso: string): void {
  const rawDb = (store as unknown as { db: DatabaseSync }).db;
  rawDb.prepare("UPDATE relay_records SET verify_last_attempt_at = ? WHERE verify_last_attempt_at IS NOT NULL").run(iso);
}

function verificationAttempts(store: RelayStore): { count: number; last: string | undefined } {
  const record = store.listRecords("kisab-main")[0]!;
  return { count: record.verifyAttemptCount ?? 0, last: record.verifyLastAttemptAt };
}

function seedAmbiguousPlannerToWorker(store: RelayStore): { pairId: string; direction: "planner-to-worker"; sourceMessageId: string; sourceHash: string } {
  const identity = {
    pairId: "kisab-main",
    direction: "planner-to-worker" as const,
    sourceMessageId: "planner-msg-1",
    sourceHash: hashText("Do the next slice")
  };
  store.createRecord(identity);
  store.updateStatus(identity, "DELIVERING", {});
  return identity;
}

describe("ambiguous delivery verification (Rules 12 and 13)", () => {
  it("verifies a delivered message by identity and reconciles without resending", async () => {
    const store = await openStore();
    const identity = seedAmbiguousPlannerToWorker(store);
    const worker = new StaticOpenCodeAdapter([
      { id: "user-1", source: "planner", role: "user", text: "Do the next slice\n\n⟦relay:11111111-1111-1111-1111-111111111111 20260831T100000Z⟧" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();
    const logger = new MemorySupervisorLogger();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, logger, mode: "relay", stabilityMs: 0 });
    try {
      const report = await supervisor.observeOnce();
      expect(logger.events.map((event) => event.type)).toContain("AMBIGUOUS_DELIVERY_RECONCILED");
      expect(store.listRecords("kisab-main").find((r) => r.sourceMessageId === "planner-msg-1")?.status).toBe("DELIVERED");
      expect(worker.sentPlannerMessages).toHaveLength(0); // never resent
    } finally {
      store.close();
    }
  });

  it("waits 2 minutes between verification attempts and escalates to the Recovery Agent after 3", async () => {
    const store = await openStore();
    seedAmbiguousPlannerToWorker(store);
    const worker = new StaticOpenCodeAdapter([
      { id: "unrelated", source: "worker", role: "assistant", text: "unrelated" }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();
    const logger = new MemorySupervisorLogger();
    const pair = makePair({ masterWorkerSessionId: "ses_master_1" });
    const supervisor = new Supervisor({ pair, worker, planner, store, logger, mode: "relay", stabilityMs: 0 });
    try {
      await supervisor.observeOnce(); // attempt 1
      expect(verificationAttempts(store).count).toBe(1);

      await supervisor.observeOnce(); // too soon — Rule 13
      expect(verificationAttempts(store).count).toBe(1);

      backdateVerifyAttempt(store, new Date(Date.now() - 2 * 60 * 1000 - 1).toISOString());
      await supervisor.observeOnce(); // attempt 2
      expect(verificationAttempts(store).count).toBe(2);

      backdateVerifyAttempt(store, new Date(Date.now() - 2 * 60 * 1000 - 1).toISOString());
      await supervisor.observeOnce(); // attempt 3 → escalation
      expect(verificationAttempts(store).count).toBe(3);
      expect(worker.sentPlannerMessages).toHaveLength(1);
      expect(worker.sentPlannerMessages[0]?.worker.sessionId).toBe("ses_master_1");
      expect(worker.sentPlannerMessages[0]?.message.text).toContain("Ambiguous delivery investigation");
      expect(logger.events.map((event) => event.type)).toContain("ESCALATED_TO_AGENT");
      expect(worker.sentPlannerMessages.every((entry) => entry.message.text !== "Do the next slice")).toBe(true); // never resent
    } finally {
      store.close();
    }
  });

  it("requires operator intervention on 3 failed verifications when no Recovery Agent is configured", async () => {
    const store = await openStore();
    seedAmbiguousPlannerToWorker(store);
    const worker = new StaticOpenCodeAdapter();
    const planner = new FakeChatGPTBrowserAdapter();
    const logger = new MemorySupervisorLogger();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, logger, mode: "relay", stabilityMs: 0 });
    try {
      await supervisor.observeOnce();
      backdateVerifyAttempt(store, new Date(Date.now() - 2 * 60 * 1000 - 1).toISOString());
      await supervisor.observeOnce();
      backdateVerifyAttempt(store, new Date(Date.now() - 2 * 60 * 1000 - 1).toISOString());
      await supervisor.observeOnce();
      expect(verificationAttempts(store).count).toBe(3);
      expect(logger.events.map((event) => event.type)).toContain("INTERVENTION_REQUIRED");
      expect(worker.sentPlannerMessages).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("attests worker-to-planner delivery via the fake adapter and reconciles", async () => {
    const store = await openStore();
    const planner = new FakeChatGPTBrowserAdapter();
    await planner.sendWorkerMessage(makePair().planner, {
      id: "worker-report-1",
      source: "worker",
      role: "assistant",
      text: "Worker report body",
      createdAt: Date.now()
    });
    const identity = {
      pairId: "kisab-main",
      direction: "worker-to-planner" as const,
      sourceMessageId: "worker-report-1",
      sourceHash: hashText("Worker report body")
    };
    store.createRecord(identity);
    store.updateStatus(identity, "DELIVERING", {});
    const worker = new StaticOpenCodeAdapter();
    const logger = new MemorySupervisorLogger();
    const supervisor = new Supervisor({ pair: makePair(), worker, planner, store, logger, mode: "relay", stabilityMs: 0 });
    try {
      await supervisor.observeOnce();
      expect(store.listRecords("kisab-main")[0]?.status).toBe("DELIVERED");
      expect(logger.events.map((event) => event.type)).toContain("AMBIGUOUS_DELIVERY_RECONCILED");
    } finally {
      store.close();
    }
  });
});
