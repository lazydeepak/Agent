import { describe, expect, it } from "vitest";
import { HttpOpenCodeEventSource } from "../src/adapters/opencode/event-source.js";
import { WakeBus, type WakeSignal } from "../src/runtime/wake-bus.js";

describe("WakeBus", () => {
  it("delivers only to subscribers for the matching pair in subscription order", () => {
    const bus = new WakeBus();
    const received: string[] = [];
    bus.subscribe("pair-a", () => received.push("a-first"));
    bus.subscribe("pair-b", () => received.push("b"));
    bus.subscribe("pair-a", () => received.push("a-second"));

    bus.emit(wakeSignal("pair-a"));

    expect(received).toEqual(["a-first", "a-second"]);
  });

  it("does not deliver a pair A wake to a pair B subscriber", () => {
    const bus = new WakeBus();
    const received: WakeSignal[] = [];
    bus.subscribe("pair-b", (signal) => received.push(signal));

    bus.emit(wakeSignal("pair-a"));

    expect(received).toEqual([]);
  });

  it("stops delivery after unsubscribe", () => {
    const bus = new WakeBus();
    const received: WakeSignal[] = [];
    const unsubscribe = bus.subscribe("pair-a", (signal) => received.push(signal));

    bus.emit(wakeSignal("pair-a"));
    unsubscribe();
    bus.emit(wakeSignal("pair-a"));

    expect(received).toHaveLength(1);
  });

  it("carries one normalized OpenCode event through to one pair subscriber", async () => {
    const payload = {
      id: "evt_99",
      type: "session.next.step.ended",
      durable: { aggregateID: "ses_worker_1", seq: 99 },
      data: { sessionID: "ses_worker_1", messageID: "msg_worker_1" }
    };
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      reconnectDelayMs: 0,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
      fetch: async () => responseFor(`data: ${JSON.stringify(payload)}\n\n`)
    });
    const bus = new WakeBus();
    const received: WakeSignal[] = [];
    bus.subscribe("pair-a", (signal) => received.push(signal));
    const controller = new AbortController();

    for await (const event of source.subscribe("ses_worker_1", controller.signal)) {
      bus.emit({
        pairId: "pair-a",
        source: "opencode",
        reason: event.type,
        observedAt: event.observedAt,
        seq: event.seq,
        messageId: event.messageId
      });
      controller.abort();
    }

    expect(received).toEqual([
      {
        pairId: "pair-a",
        source: "opencode",
        reason: "session.next.step.ended",
        observedAt: "2026-09-03T00:00:00.000Z",
        seq: 99,
        messageId: "msg_worker_1"
      }
    ]);
  });
});

function wakeSignal(pairId: string): WakeSignal {
  return {
    pairId,
    source: "opencode",
    reason: "session.next.step.ended",
    observedAt: "2026-09-03T00:00:00.000Z",
    seq: 1,
    messageId: "msg_1"
  };
}

function responseFor(chunk: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      }
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
}
