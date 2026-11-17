import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import {
  OpenCodeEventSourceTerminalError,
  type OpenCodeEventSource,
  type OpenCodeSessionEvent
} from "../src/adapters/opencode/event-source.js";
import { SqliteRelayStore } from "../src/persistence/store.js";
import { PairRuntime } from "../src/runtime/pair-runtime.js";
import { WakeBus } from "../src/runtime/wake-bus.js";
import { ControllableWorker, makePair } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function workerEvent(seq: number): OpenCodeSessionEvent {
  return {
    sessionId: "ses_worker_1",
    type: "session.next.step.ended",
    id: `evt_${seq}`,
    seq,
    messageId: `msg_${seq}`,
    observedAt: "2026-11-18T00:00:00.000Z"
  };
}

async function runtimeContext(source: OpenCodeEventSource, onEvent?: (event: { type: string }) => void) {
  const directory = await mkdtemp(join(tmpdir(), "agent-runtime-gaps-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "relay.sqlite"));
  await store.init();
  const runtime = new PairRuntime({
    pair: makePair(),
    store,
    worker: new ControllableWorker(),
    planner: new FakeChatGPTBrowserAdapter(),
    workerEvents: source,
    wakeBus: new WakeBus(),
    pollIntervalMs: 60_000,
    onEvent
  });
  return { runtime, store };
}

/** Emits one event, then fails — records every subscribe's afterSeq cursor. */
class FailingAfterCursorEventSource implements OpenCodeEventSource {
  readonly subscribeCalls: Array<{ afterSeq?: number }> = [];

  async *subscribe(
    _sessionId: string,
    _signal: AbortSignal,
    options?: { afterSeq?: number }
  ): AsyncIterable<OpenCodeSessionEvent> {
    this.subscribeCalls.push({ afterSeq: options?.afterSeq });
    if (this.subscribeCalls.length === 1) {
      yield workerEvent(7);
    }
    throw new Error("SSE disconnected");
  }
}

class TerminalEventSource implements OpenCodeEventSource {
  calls = 0;

  async *subscribe(
    _sessionId: string,
    _signal: AbortSignal,
    _options?: { afterSeq?: number }
  ): AsyncIterable<OpenCodeSessionEvent> {
    this.calls += 1;
    throw new OpenCodeEventSourceTerminalError(400, "session replay not supported");
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for runtime condition.");
}

describe("PairRuntime worker event-source gaps (v1.1 §7.2 / §8.5)", () => {
  it("resubscribes a bounded number of times with the replay cursor, then marks UNRECOVERABLE_GAPS", async () => {
    const source = new FailingAfterCursorEventSource();
    const events: string[] = [];
    const { runtime, store } = await runtimeContext(source, (event) => events.push(event.type));
    try {
      await runtime.start();
      await waitFor(() => {
        const marker = store.getSupervisorState("kisab-main")?.lastError ?? "";
        return marker.includes("UNRECOVERABLE_GAPS");
      });
      // Exactly 3 bounded attempts: first without a cursor, later ones with the last observed seq.
      expect(source.subscribeCalls.length).toBe(3);
      expect(source.subscribeCalls[0].afterSeq).toBeUndefined();
      expect(source.subscribeCalls[1].afterSeq).toBe(7);
      expect(source.subscribeCalls[2].afterSeq).toBe(7);
      expect(events).toContain("EVENT_SOURCE_DEGRADED");
      // The marker is advisory and explicitly states completeness is UNKNOWN.
      expect(store.getSupervisorState("kisab-main")?.lastError).toMatch(/UNRECOVERABLE_GAPS.*UNKNOWN/);
    } finally {
      await runtime.stop();
      store.close();
    }
  });

  it("does not retry terminal event-source errors, but still marks the gap marker", async () => {
    const source = new TerminalEventSource();
    const events: string[] = [];
    const { runtime, store } = await runtimeContext(source, (event) => events.push(event.type));
    try {
      await runtime.start();
      await waitFor(() => (store.getSupervisorState("kisab-main")?.lastError ?? "").includes("UNRECOVERABLE_GAPS"));
      expect(source.calls).toBe(1);
      expect(events).toContain("EVENT_SOURCE_DEGRADED");
    } finally {
      await runtime.stop();
      store.close();
    }
  });
});
