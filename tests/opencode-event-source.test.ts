import { describe, expect, it } from "vitest";
import {
  HttpOpenCodeEventSource,
  OpenCodeEventSourceTerminalError
} from "../src/adapters/opencode/event-source.js";

/** Splits a text/event-stream body into the frames the source should see. */
function sse(...frames: string[]): string {
  return frames.map((f) => `${f}\n\n`).join("");
}

function streamOf(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    ...init
  });
}

async function collect(
  source: HttpOpenCodeEventSource,
  sessionId: string,
  ms = 250
): Promise<Array<{ type: string; seq?: number; messageId?: string }>> {
  const controller = new AbortController();
  const out: Array<{ type: string; seq?: number; messageId?: string }> = [];
  const task = (async () => {
    for await (const event of source.subscribe(sessionId, controller.signal)) {
      out.push(event);
      if (out.length >= 3) break;
    }
  })();
  await new Promise((r) => setTimeout(r, ms));
  controller.abort();
  await task.catch(() => undefined);
  return out;
}

describe("OpenCode event source transport", () => {
  it("subscribes to the server-wide /api/event stream", async () => {
    const paths: string[] = [];
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      reconnectDelayMs: 50,
      fetch: async (input: URL | RequestInfo) => {
        paths.push(new URL(String(input)).pathname);
        return streamOf(
          sse(
            'data: {"id":"evt_c","type":"server.connected","data":{}}',
            'data: {"id":"evt_a","type":"session.inbox.enqueued","data":{"sessionID":"ses_w","inboxID":"msg_1"},"durable":{"aggregateID":"ses_w","seq":7}}'
          )
        );
      }
    });

    const events = await collect(source, "ses_w");

    expect(paths).toContain("/api/event");
    expect(events.map((e) => e.type)).toEqual(["session.inbox.enqueued"]);
    expect(events[0]?.seq).toBe(7);
  });

  it("does not use the per-session event route, which does not exist", async () => {
    const paths: string[] = [];
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        paths.push(new URL(String(input)).pathname);
        return streamOf("");
      }
    });

    await collect(source, "ses_w", 120);

    expect(paths.some((p) => p.includes("/event") && p.includes("/session/"))).toBe(false);
  });

  it("drops frames belonging to other sessions on the shared stream", async () => {
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async () =>
        streamOf(
          sse(
            'data: {"id":"evt_1","type":"session.inbox.enqueued","data":{"sessionID":"ses_other"},"durable":{"seq":1}}',
            'data: {"id":"evt_2","type":"session.inbox.enqueued","data":{"sessionID":"ses_w"},"durable":{"seq":2}}'
          )
        )
    });

    const events = await collect(source, "ses_w");

    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(2);
  });

  it("ignores frames that carry no session identity", async () => {
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async () =>
        streamOf(
          sse(
            'data: {"id":"evt_1","type":"server.connected","data":{}}',
            'data: {"id":"evt_2","type":"shell.exited","data":{"id":"sh_1"}}'
          )
        )
    });

    expect(await collect(source, "ses_w")).toHaveLength(0);
  });

  it("extracts the assistant message id carried by tool frames", async () => {
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async () =>
        streamOf(
          sse('data: {"id":"evt_1","type":"session.tool.success","data":{"sessionID":"ses_w","assistantMessageID":"msg_a"},"durable":{"seq":3}}')
        )
    });

    const events = await collect(source, "ses_w");

    expect(events[0]?.messageId).toBe("msg_a");
  });

  it("surfaces an unauthenticated stream instead of retrying forever", async () => {
    let calls = 0;
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      reconnectDelayMs: 20,
      fetch: async () => {
        calls += 1;
        return new Response("unauthorized", { status: 401, statusText: "Unauthorized" });
      }
    });

    const controller = new AbortController();
    await expect(async () => {
      for await (const _ of source.subscribe("ses_w", controller.signal)) void _;
    }).rejects.toBeInstanceOf(OpenCodeEventSourceTerminalError);
    // A hard rejection must not turn into a reconnect loop.
    expect(calls).toBe(1);
  });

  it("surfaces a missing event route instead of retrying forever", async () => {
    let calls = 0;
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      reconnectDelayMs: 20,
      fetch: async () => {
        calls += 1;
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }
    });

    const controller = new AbortController();
    await expect(async () => {
      for await (const _ of source.subscribe("ses_w", controller.signal)) void _;
    }).rejects.toBeInstanceOf(OpenCodeEventSourceTerminalError);
    expect(calls).toBe(1);
  });

  it("reconnects after a transient stream drop", async () => {
    let calls = 0;
    const source = new HttpOpenCodeEventSource({
      baseUrl: "http://127.0.0.1:4096",
      reconnectDelayMs: 20,
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("socket reset");
        return streamOf(
          sse('data: {"id":"evt_1","type":"session.inbox.enqueued","data":{"sessionID":"ses_w"},"durable":{"seq":9}}')
        );
      }
    });

    const events = await collect(source, "ses_w", 300);

    expect(calls).toBeGreaterThan(1);
    expect(events[0]?.seq).toBe(9);
  });
});
