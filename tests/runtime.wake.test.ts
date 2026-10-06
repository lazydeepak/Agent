import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import type { PlannerSessionEvent } from "../src/adapters/chatgpt/index.js";
import type {
  OpenCodeEventSource,
  OpenCodeSessionEvent
} from "../src/adapters/opencode/event-source.js";
import { SqliteRelayStore } from "../src/persistence/store.js";
import { PairRuntime, type PairRuntimeOptions } from "../src/runtime/pair-runtime.js";
import { WakeBus } from "../src/runtime/wake-bus.js";
import type { WorkerIdentity, WorkerObservation } from "../src/types.js";
import { ControllableWorker, makePair } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("PairRuntime event-driven reconciliation", () => {
  it("reconciles promptly when its OpenCode event source emits", async () => {
    const context = await runtimeContext();
    try {
      await context.runtime.start();
      expect(context.worker.calls).toBe(1);

      context.events.emit(workerEvent(1));

      await waitFor(() => context.worker.calls === 2);
      expect(context.runtime.state).toBe("RUNNING");
    } finally {
      await context.runtime.stop();
      context.store.close();
    }
  });

  it("serializes observations and coalesces a burst received during reconciliation", async () => {
    const worker = new BlockingWorker();
    const context = await runtimeContext(worker);
    try {
      await context.runtime.start();
      worker.blockNext();

      context.events.emit(workerEvent(10));
      await worker.whenBlocked();
      for (let seq = 11; seq <= 20; seq += 1) {
        context.events.emit(workerEvent(seq));
      }
      worker.release();

      await waitFor(() => worker.calls >= 3);
      await delay(30);
      expect(worker.calls).toBe(3);
      expect(worker.maxConcurrent).toBe(1);
    } finally {
      worker.release();
      await context.runtime.stop();
      context.store.close();
    }
  });

  it("stops the event subscription and leaves no wake-driven observations behind", async () => {
    const context = await runtimeContext();
    await context.runtime.start();
    await context.runtime.stop();
    const callsAfterStop = context.worker.calls;

    context.events.emit(workerEvent(30));
    await delay(30);

    expect(context.worker.calls).toBe(callsAfterStop);
    expect(context.events.subscriptionsEnded).toBe(1);
    context.store.close();
  });

  it("enters dormant watch on failure and wakes to ACTIVE from a completed ChatGPT message", async () => {
    const worker = new CountingWorker();
    worker.setSessionMissing();
    const planner = new PushPlannerAdapter();
    const context = await runtimeContext(worker, planner);
    try {
      await context.runtime.start();
      expect(context.runtime.status().schedulerMode).toBe("DORMANT_WATCH");
      const beforeWake = worker.calls;
      worker.sessionExists = true;
      planner.emit({ type: "planner.message.completed", observedAt: new Date().toISOString(), messageId: "planner-new" });
      await waitFor(() => worker.calls > beforeWake);
      expect(context.runtime.status().schedulerMode).toBe("ACTIVE");
    } finally {
      await context.runtime.stop();
      context.store.close();
    }
  });

  it("records event-source failures while retaining the polling fallback", async () => {
    const runtimeEvents: string[] = [];
    const context = await runtimeContext(new CountingWorker(), new FakeChatGPTBrowserAdapter(), {
      workerEvents: new FailingEventSource(),
      onEvent: (event) => runtimeEvents.push(event.type)
    });
    try {
      await context.runtime.start();
      await waitFor(() => runtimeEvents.includes("EVENT_SOURCE_DEGRADED"));
      expect(context.runtime.state).toBe("RUNNING");
    } finally {
      await context.runtime.stop();
      context.store.close();
    }
  });
});

async function runtimeContext(
  worker: CountingWorker = new CountingWorker(),
  planner: FakeChatGPTBrowserAdapter = new FakeChatGPTBrowserAdapter(),
  options: Partial<Pick<PairRuntimeOptions, "workerEvents" | "onEvent">> = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-runtime-wake-"));
  tempDirs.push(directory);
  const store = new SqliteRelayStore(join(directory, "relay.sqlite"));
  await store.init();
  const events = new PushEventSource();
  const runtime = new PairRuntime({
    pair: makePair(),
    store,
    worker,
    planner,
    workerEvents: options.workerEvents ?? events,
    wakeBus: new WakeBus(),
    pollIntervalMs: 60_000,
    onEvent: options.onEvent
  });
  return { runtime, worker, events, store };
}

class PushPlannerAdapter extends FakeChatGPTBrowserAdapter {
  private readonly queue: PlannerSessionEvent[] = [];
  private notify?: () => void;

  emit(event: PlannerSessionEvent): void {
    this.queue.push(event);
    this.notify?.();
  }

  async *subscribePlannerEvents(
    _planner: Parameters<FakeChatGPTBrowserAdapter["observePlannerConversation"]>[0],
    signal: AbortSignal
  ): AsyncIterable<PlannerSessionEvent> {
    while (!signal.aborted) {
      if (this.queue.length === 0) {
        await new Promise<void>((resolve) => {
          const wake = () => resolve();
          this.notify = wake;
          signal.addEventListener("abort", wake, { once: true });
        });
      }
      const event = this.queue.shift();
      if (event) yield event;
    }
  }
}

class CountingWorker extends ControllableWorker {
  calls = 0;
  concurrent = 0;
  maxConcurrent = 0;

  override async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    this.calls += 1;
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    try {
      return await super.observeWorkerSession(worker);
    } finally {
      this.concurrent -= 1;
    }
  }
}

class BlockingWorker extends CountingWorker {
  private shouldBlock = false;
  private releaseGate: () => void = () => undefined;
  private blockedGate: Promise<void> = Promise.resolve();
  private resolveBlocked: () => void = () => undefined;

  blockNext(): void {
    this.shouldBlock = true;
    this.blockedGate = new Promise<void>((resolve) => {
      this.resolveBlocked = resolve;
    });
  }

  whenBlocked(): Promise<void> {
    return this.blockedGate;
  }

  release(): void {
    this.releaseGate();
  }

  override async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    if (!this.shouldBlock) {
      return super.observeWorkerSession(worker);
    }

    this.shouldBlock = false;
    const gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
    this.resolveBlocked();
    this.calls += 1;
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    try {
      await gate;
      return await ControllableWorker.prototype.observeWorkerSession.call(this, worker);
    } finally {
      this.concurrent -= 1;
    }
  }
}

class PushEventSource implements OpenCodeEventSource {
  private readonly queue: OpenCodeSessionEvent[] = [];
  private notify?: () => void;
  subscriptionsEnded = 0;

  emit(event: OpenCodeSessionEvent): void {
    this.queue.push(event);
    this.notify?.();
  }

  async *subscribe(
    _sessionId: string,
    signal: AbortSignal
  ): AsyncIterable<OpenCodeSessionEvent> {
    try {
      while (!signal.aborted) {
        if (this.queue.length === 0) {
          await new Promise<void>((resolve) => {
            const wake = () => {
              signal.removeEventListener("abort", wake);
              resolve();
            };
            this.notify = wake;
            signal.addEventListener("abort", wake, { once: true });
          });
          this.notify = undefined;
        }
        while (!signal.aborted && this.queue.length > 0) {
          yield this.queue.shift() as OpenCodeSessionEvent;
        }
      }
    } finally {
      this.subscriptionsEnded += 1;
    }
  }
}

class FailingEventSource implements OpenCodeEventSource {
  async *subscribe(): AsyncIterable<OpenCodeSessionEvent> {
    throw new Error("SSE disconnected");
  }
}

function workerEvent(seq: number): OpenCodeSessionEvent {
  return {
    sessionId: "ses_worker_1",
    type: "session.next.step.ended",
    id: `evt_${seq}`,
    seq,
    messageId: `msg_${seq}`,
    observedAt: "2026-09-03T00:00:00.000Z"
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  throw new Error("Timed out waiting for runtime condition.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
