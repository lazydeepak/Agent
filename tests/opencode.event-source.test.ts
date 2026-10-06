import { describe, expect, it } from "vitest";
import {
  HttpOpenCodeEventSource,
  type OpenCodeSessionEvent
} from "../src/adapters/opencode/event-source.js";

const fixedNow = new Date("2026-09-03T00:00:00.000Z");

describe("HttpOpenCodeEventSource", () => {
  it("normalizes a session event, durable sequence, and nested message ID", async () => {
    const source = eventSource([
      sseResponse([
        sse({
          id: "evt_1",
          type: "session.next.prompted",
          durable: { aggregateID: "ses_worker_1", seq: 12 },
          data: { sessionID: "ses_worker_1", messageID: "msg_1" }
        })
      ])
    ]);

    await expect(take(source, 1)).resolves.toEqual([
      {
        sessionId: "ses_worker_1",
        type: "session.next.prompted",
        id: "evt_1",
        seq: 12,
        messageId: "msg_1",
        observedAt: fixedNow.toISOString()
      }
    ]);
  });

  it("parses one event split across arbitrary chunks", async () => {
    const encoded = sse({ type: "session.next.step.started", durable: { seq: 2 } });
    const source = eventSource([
      sseResponse([encoded.slice(0, 7), encoded.slice(7, 31), encoded.slice(31)])
    ]);

    const events = await take(source, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "session.next.step.started", seq: 2 });
  });

  it("parses multiple events from one chunk", async () => {
    const source = eventSource([
      sseResponse([
        sse({ type: "session.next.step.started", durable: { seq: 3 } }) +
          sse({ type: "session.next.step.ended", durable: { seq: 4 } })
      ])
    ]);

    const events = await take(source, 2);
    expect(events.map((event) => event.type)).toEqual([
      "session.next.step.started",
      "session.next.step.ended"
    ]);
    expect(events.map((event) => event.seq)).toEqual([3, 4]);
  });

  it("supports CRLF records and SSE multiline data", async () => {
    const payload = JSON.stringify({ type: "session.next.step.ended", durable: { seq: 5 } });
    const split = payload.indexOf(",") + 1;
    const record = `data: ${payload.slice(0, split)}\r\ndata:${payload.slice(split)}\r\n\r\n`;
    const source = eventSource([sseResponse([record])]);

    const events = await take(source, 1);
    expect(events[0]).toMatchObject({ type: "session.next.step.ended", seq: 5 });
  });

  it("skips malformed JSON and comments, then continues with a valid event", async () => {
    const source = eventSource([
      sseResponse([
        ": heartbeat\n\n",
        "data: {not-json}\n\n",
        sse({ type: "session.next.step.ended", durable: { seq: 7 } })
      ])
    ]);

    const events = await take(source, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "session.next.step.ended", seq: 7 });
  });

  it("skips valid JSON values that are not event objects", async () => {
    const source = eventSource([
      sseResponse([
        "data: []\n\n",
        sse({ type: "session.next.step.ended", durable: { seq: 71 } })
      ])
    ]);

    const events = await take(source, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "session.next.step.ended", seq: 71 });
  });

  it("does not coerce arbitrary sequence strings into replay cursors", async () => {
    const source = eventSource([
      sseResponse([sse({ type: "session.next.step.started", durable: { seq: "12garbage" } })])
    ]);

    const events = await take(source, 1);
    expect(events[0]?.seq).toBeUndefined();
  });

  it("keeps the SSE event ID distinct from the worker message ID", async () => {
    const source = eventSource([
      sseResponse([sse({ id: "evt_only", type: "session.next.step.started", durable: { seq: 8 } })])
    ]);

    const events = await take(source, 1);
    expect(events[0]?.id).toBe("evt_only");
    expect(events[0]?.messageId).toBeUndefined();
  });

  it("encodes a valid afterSeq in the request URL", async () => {
    let requestedUrl = "";
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096/",
      reconnectDelayMs: 0,
      now: () => fixedNow,
      fetch: async (input) => {
        requestedUrl = String(input);
        return sseResponse([sse({ type: "session.next.step.ended", durable: { seq: 10 } })]);
      }
    });

    await take(source, 1, { afterSeq: 9 });
    expect(requestedUrl).toBe(
      "http://127.0.0.1:4096/api/session/ses_worker_1/event?after=9"
    );
  });

  it("terminates cleanly when already aborted", async () => {
    let fetchCalls = 0;
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async () => {
        fetchCalls += 1;
        return sseResponse([]);
      }
    });
    const controller = new AbortController();
    controller.abort();
    const events: OpenCodeSessionEvent[] = [];

    for await (const event of source.subscribe("ses_worker_1", controller.signal)) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(fetchCalls).toBe(0);
  });

  it("terminates an active subscription when aborted", async () => {
    const controller = new AbortController();
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      reconnectDelayMs: 0,
      fetch: async (_input, init) => {
        const requestSignal = init?.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              requestSignal?.addEventListener(
                "abort",
                () => streamController.error(new DOMException("Aborted", "AbortError")),
                { once: true }
              );
            }
          }),
          { headers: { "content-type": "text/event-stream" } }
        );
      }
    });
    const iterator = source.subscribe("ses_worker_1", controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();

    controller.abort();

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
  });

  it("reconnects from the latest sequence without duplicating replayed data", async () => {
    let fetchCalls = 0;
    const requestedUrls: string[] = [];
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      reconnectDelayMs: 0,
      now: () => fixedNow,
      fetch: async (input) => {
        requestedUrls.push(String(input));
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return sseResponse([sse({ type: "first", durable: { seq: 20 } })]);
        }
        return sseResponse([
          sse({ type: "duplicate", durable: { seq: 20 } }) +
            sse({ type: "second", durable: { seq: 21 } })
        ]);
      }
    });

    const events = await take(source, 2);
    expect(events.map((event) => [event.type, event.seq])).toEqual([
      ["first", 20],
      ["second", 21]
    ]);
    expect(requestedUrls[1]).toContain("?after=20");
  });
});

function eventSource(responses: Response[]): HttpOpenCodeEventSource {
  let index = 0;
  return new HttpOpenCodeEventSource({
    baseUrl: "http://127.0.0.1:4096",
    reconnectDelayMs: 0,
    now: () => fixedNow,
    fetch: async () => responses[Math.min(index++, responses.length - 1)] as Response
  });
}

async function take(
  source: HttpOpenCodeEventSource,
  count: number,
  options?: { afterSeq?: number }
): Promise<OpenCodeSessionEvent[]> {
  const controller = new AbortController();
  const events: OpenCodeSessionEvent[] = [];
  for await (const event of source.subscribe("ses_worker_1", controller.signal, options)) {
    events.push(event);
    if (events.length === count) {
      controller.abort();
    }
  }
  return events;
}

function sse(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}
