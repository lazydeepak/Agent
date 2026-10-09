import { describe, expect, it } from "vitest";
import { LiveOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { OpenCodeHttpClient, OpenCodeHttpError, OpenCodeWriteUnsupportedError } from "../src/adapters/opencode/http.js";
import type { WorkerIdentity } from "../src/types.js";

describe("OpenCodeHttpClient", () => {
  it("lists sessions with directory filtering", async () => {
    const requests: string[] = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        requests.push(String(input));
        if (new URL(String(input)).pathname === "/doc") {
          return jsonResponse({ paths: { "/api/session": {} } });
        }
        return jsonResponse({
          data: [
            {
              id: "ses_worker_1",
              title: "Worker",
              location: {
                directory: "/Users/lazydeepak/dev/kisab"
              }
            }
          ]
        });
      }
    });

    const sessions = await client.listSessions({ repoPath: "/Users/lazydeepak/dev/kisab", limit: 5 });

    expect(requests[0]).toContain("/doc");
    expect(requests[1]).toContain("/api/session?");
    expect(requests[1]).toContain("limit=5");
    expect(requests[1]).toContain("directory=%2FUsers%2Flazydeepak%2Fdev%2Fkisab");
    expect(sessions.data[0]?.id).toBe("ses_worker_1");
  });

  it("adds basic auth when credentials are supplied", async () => {
    let authorization: string | null = null;
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "secret",
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization");
        if (new URL(String(_input)).pathname === "/doc") {
          return jsonResponse({ paths: { "/api/health": {} } });
        }
        return jsonResponse({ ok: true });
      }
    });

    await client.health();

    expect(authorization).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`);
  });

  it("raises status-aware errors", async () => {
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async () => new Response("nope", { status: 401, statusText: "Unauthorized" })
    });

    await expect(client.health()).rejects.toBeInstanceOf(OpenCodeHttpError);
  });

  it("falls back to the installed legacy session endpoints", async () => {
    const requests: string[] = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        requests.push(url.pathname);

        if (url.pathname === "/doc") {
          return jsonResponse({ paths: { "/auth/{providerID}": {}, "/log": {} } });
        }
        if (url.pathname === "/api/health") {
          return new Response("not found", { status: 404 });
        }

        return jsonResponse([
          {
            id: "ses_worker_1",
            directory: "/Users/lazydeepak/dev/kisab",
            title: "Worker"
          }
        ]);
      }
    });

    const sessions = await client.listSessions({ repoPath: "/Users/lazydeepak/dev/kisab" });

    expect(requests).toEqual(["/doc", "/api/health", "/session"]);
    expect(sessions.data[0]).toMatchObject({
      id: "ses_worker_1",
      directory: "/Users/lazydeepak/dev/kisab"
    });
  });

  it("treats a 401 on /api/health as an auth-gated v2 server rather than a legacy server", async () => {
    // A v2 server behind auth answers unknown paths with the SPA HTML and /api/* with 401 JSON.
    // Pinning legacy here sent callers to /session, which returned HTML and surfaced as
    // "returned text/html for /session, not JSON" instead of the real authentication problem.
    const requests: string[] = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        const path = new URL(String(input)).pathname;
        requests.push(path);
        if (path.startsWith("/api/")) {
          return new Response(JSON.stringify({ _tag: "UnauthorizedError", message: "Authentication required" }), {
            status: 401,
            headers: { "content-type": "application/json" }
          });
        }
        return new Response("<!doctype html><html lang=\"en\"></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        });
      }
    });

    expect(await client.isV2Api()).toBe(true);
    await expect(client.listSessions()).rejects.toThrow(OpenCodeHttpError);
    // Must never be routed through the legacy /session path.
    expect(requests).not.toContain("/session");
  });

  it("re-pins to v2 when a legacy-pinned client receives SPA HTML on /session", async () => {
    // Discovery can settle on legacy from a stale spec; the SPA catch-all then answers /session
    // with HTML. The client must self-correct to the v2 path instead of reporting a parse error.
    let sessionsCalls = 0;
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        const path = new URL(String(input)).pathname;
        if (path === "/doc") {
          return jsonResponse({ paths: { "/log": {} } });
        }
        if (path === "/api/health") {
          return new Response("not found", { status: 404 });
        }
        if (path === "/session") {
          return new Response("<!doctype html><html lang=\"en\"></html>", {
            status: 200,
            headers: { "content-type": "text/html" }
          });
        }
        sessionsCalls += 1;
        return jsonResponse({ data: [{ id: "ses_worker_1", title: "Worker" }] });
      }
    });

    const sessions = await client.listSessions();

    expect(sessionsCalls).toBe(1);
    expect(sessions.data[0]).toMatchObject({ id: "ses_worker_1" });
    expect(await client.isV2Api()).toBe(true);
  });

  it("sends planner messages with OpenCode text parts", async () => {
    let requestBody = "";
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;

        if (path === "/doc") {
          return jsonResponse({ paths: { "/auth/{providerID}": {}, "/log": {} } });
        }

        requestBody = String(init?.body);
        return jsonResponse({});
      }
    });

    await client.sendSessionMessage("ses_worker_1", "Build the next slice");

    expect(JSON.parse(requestBody)).toEqual({
      parts: [
        {
          type: "text",
          text: "Build the next slice"
        }
      ]
    });
  });

  it("prefers coherent v2 routes: writes to /prompt and reads from /message", async () => {
    // OpenCode v2 has no POST /api/session/{id}/message. Writes go to /prompt (flat { text }),
    // while /message remains the read route, so a v2 client must use both without mixing protocols.
    const requests: Array<{ path: string; method: string }> = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        requests.push({ path, method });

        if (path === "/doc") {
          return jsonResponse({
            paths: {
              "/api/session": {},
              "/api/session/active": { get: {} },
              "/api/session/{sessionID}/prompt": { post: {} },
              "/api/session/{sessionID}/message": { get: {} },
              "/session/status": { get: {} },
              "/session/{sessionID}/message": { get: {}, post: {} }
            }
          });
        }
        if (path === "/api/session/ses_worker_1/message" && method === "GET") {
          expect(new URL(String(input)).searchParams.get("order")).toBe("desc");
          return jsonResponse({ data: [{ id: "msg_1", type: "assistant", content: [] }] });
        }
        if (path === "/api/session/ses_worker_1/prompt" && method === "POST") {
          return jsonResponse({ data: { id: "msg_written" } });
        }
        if (path === "/api/session/active" && method === "GET") {
          return jsonResponse({ data: { ses_worker_1: { type: "busy" } } });
        }
        return new Response("wrong route", { status: 404, statusText: "Not Found" });
      }
    });

    await expect(client.listSessionMessages("ses_worker_1")).resolves.toHaveLength(1);
    await expect(client.sendSessionMessage("ses_worker_1", "Next task")).resolves.toBeUndefined();
    await expect(client.listActiveSessions()).resolves.toEqual({ ses_worker_1: { type: "busy" } });

    expect(requests).toEqual([
      { path: "/doc", method: "GET" },
      { path: "/api/session/ses_worker_1/message", method: "GET" },
      { path: "/api/session/ses_worker_1/prompt", method: "POST" },
      { path: "/api/session/active", method: "GET" }
    ]);
  });

  it("prefers legacy routes when /global/health reports healthy, matching OpenCode's own UI selection", async () => {
    const requests: string[] = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        requests.push(`${method} ${path}`);
        if (path === "/doc") {
          return jsonResponse({
            paths: {
              "/global/health": { get: {} },
              "/api/health": {},
              "/api/session": {},
              "/api/session/{sessionID}/message": { get: {}, post: {} },
              "/session/{sessionID}/message": { get: {}, post: {} }
            }
          });
        }
        if (path === "/global/health") {
          return jsonResponse({ healthy: true, version: "1.18.30" });
        }
        if (path === "/session/ses_worker_1/message" && method === "POST") {
          return jsonResponse({});
        }
        return new Response("wrong message route", { status: 404, statusText: "Not Found" });
      }
    });

    await expect(client.sendSessionMessage("ses_worker_1", "Next task")).resolves.toBeUndefined();
    expect(requests).toContain("POST /session/ses_worker_1/message");
    expect(requests).not.toContain("POST /api/session/ses_worker_1/message");
  });

  it("recognizes OpenCode 2.0.22 as v2 even when /global/health is present", async () => {
    const requests: string[] = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        requests.push(`${method} ${path}`);
        if (path === "/doc") {
          return jsonResponse({
            paths: {
              "/global/health": { get: {} },
              "/api/health": {},
              "/api/session": {},
              "/api/session/{sessionId}/prompt": { post: {} }
            }
          });
        }
        if (path === "/global/health") {
          // Version classification only: a 2.x server is v2 regardless of a healthy global route.
          return jsonResponse({ healthy: true, version: "2.0.22" });
        }
        if (path === "/api/session/ses_worker_1/prompt" && method === "POST") {
          return jsonResponse({ data: { id: "msg_classified" } });
        }
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }
    });

    await expect(client.sendSessionMessage("ses_worker_1", "Hello 2.0.22")).resolves.toBeUndefined();
    expect(requests).toContain("POST /api/session/ses_worker_1/prompt");
    expect(requests).not.toContain("POST /session/ses_worker_1/message");
  });

  it("falls back to legacy message writes when the spec advertises a legacy route", async () => {
    // A 404 proves the v2 route is absent, but the retry is only permitted because the spec
    // independently advertises /session/{id}/message. Absent that evidence the write must fail
    // instead of being replayed on an unverified protocol.
    const requests: string[] = [];
    const bodies: Record<string, unknown> = {};
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        requests.push(`${method} ${path}`);
        if (init?.body) bodies[`${method} ${path}`] = JSON.parse(String(init.body));
        if (path === "/doc") {
          return jsonResponse({
            paths: {
              "/api/session": {},
              "/api/session/{sessionID}/prompt": { post: {} },
              "/api/session/{sessionID}/message": { get: {} },
              "/session/{sessionID}/message": { post: {} }
            }
          });
        }
        if (path === "/api/session/ses_worker_1/prompt" && method === "POST") {
          return new Response("no post", { status: 404, statusText: "Not Found" });
        }
        if (path === "/session/ses_worker_1/message" && method === "POST") {
          return jsonResponse({});
        }
        return jsonResponse({});
      }
    });

    await client.sendSessionMessage("ses_worker_1", "Hello");
    expect(requests).toContain("POST /api/session/ses_worker_1/prompt");
    expect(requests).toContain("POST /session/ses_worker_1/message");
    // v2 uses the flat body; legacy uses `parts`.
    expect(bodies["POST /api/session/ses_worker_1/prompt"]).toEqual({ text: "Hello" });
    expect(bodies["POST /session/ses_worker_1/message"]).toEqual({ parts: [{ type: "text", text: "Hello" }] });
  });
});

describe("LiveOpenCodeAdapter readiness", () => {
  it("confirms a planner message was admitted and promoted via the durable v2 prompt API", async () => {
    let submittedBody: unknown;
    const adapter = new LiveOpenCodeAdapter({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        if (path === "/doc") {
          return jsonResponse({
            paths: {
              "/api/session/{sessionID}/prompt": { post: {} },
              "/api/session/active": { get: {} },
              "/api/session/{sessionID}/history": { get: {} }
            }
          });
        }
        if (path === "/api/session/ses_worker_1/prompt" && method === "POST") {
          submittedBody = JSON.parse(String(init?.body));
          return jsonResponse({
            data: { id: "msg_new", sessionID: "ses_worker_1", type: "user", payload: { text: "Next task" } }
          });
        }
        if (path === "/api/session/active" && method === "GET") {
          return jsonResponse({ type: "running", data: { ses_worker_1: { type: "running" } } });
        }
        if (path.startsWith("/api/session/ses_worker_1/history") && method === "GET") {
          if (!new URL(String(input)).searchParams.has("after")) {
            return jsonResponse({ data: [{ id: "evt-first", durable: { seq: 100 }, type: "session.next.prompted", data: { messageID: "msg_new" } }], hasMore: true });
          }
          expect(new URL(String(input)).searchParams.get("after")).toBe("100");
          return jsonResponse({ data: [{ id: "evt-second", durable: { seq: 101 }, type: "session.next.step.started", data: { assistantMessageID: "assistant-new" } }], hasMore: false });
        }
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
    });

    const result = await adapter.sendPlannerMessage(worker(), {
      id: "planner-1",
      source: "planner",
      role: "assistant",
      text: "Next task"
    });

    expect(result).toMatchObject({
      delivered: true,
      targetId: "msg_new",
      workerDispatchMessageId: "msg_new",
      workerPromptState: "PROMOTED",
      workerStartBlocked: false
    });
    expect(submittedBody).toMatchObject({
      text: "Next task",
      delivery: "queue",
      resume: true
    });
    expect(submittedBody).not.toHaveProperty("prompt");
  });

  it("reports WORKER_START_BLOCKED when an admitted prompt is not promoted in time", async () => {
    const adapter = new LiveOpenCodeAdapter(
      {
        baseUrl: "http://127.0.0.1:4096",
        fetch: async (input: URL | RequestInfo, init) => {
          const path = new URL(String(input)).pathname;
          const method = init?.method ?? "GET";
          if (path === "/doc") {
            return jsonResponse({
              paths: {
                "/api/session/{sessionID}/prompt": { post: {} },
                "/api/session/active": { get: {} }
              }
            });
          }
          if (path === "/api/session/ses_worker_1/prompt" && method === "POST") {
            return jsonResponse({
              data: { id: "msg_admitted", sessionID: "ses_worker_1", type: "user", payload: { text: "Next task" } }
            });
          }
          if (path === "/api/session/active" && method === "GET") {
            return jsonResponse({ type: "running", data: [] });
          }
          return new Response("missing", { status: 404, statusText: "Not Found" });
        }
      },
      { promotionTimeoutMs: 100, promotionPollMs: 10 }
    );

    const result = await adapter.sendPlannerMessage(worker(), {
      id: "planner-1",
      source: "planner",
      role: "assistant",
      text: "Next task"
    });

    expect(result).toMatchObject({
      delivered: true,
      targetId: "msg_admitted",
      workerDispatchMessageId: "msg_admitted",
      workerPromptState: "ADMITTED",
      workerStartBlocked: true
    });
    expect(result.workerStartBlockedReason).toMatch(/did not start within/);
  });

  it("extracts the latest assistant text message for relay", async () => {
    const adapter = new LiveOpenCodeAdapter({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        const path = new URL(String(input)).pathname;

        if (path === "/doc") {
          return jsonResponse({ paths: { "/api/session/{sessionID}/message": {} } });
        }

        if (path === "/api/session/ses_worker_1/message") {
          return jsonResponse({
            data: [
              {
                id: "msg_user",
                role: "user",
                text: "Build it"
              },
              {
                id: "msg_assistant",
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "Done"
                  }
                ],
                metadata: {
                  time: {
                    created: 123
                  }
                }
              }
            ]
          });
        }

        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
    });

    await expect(adapter.getLatestAssistantMessage(worker())).resolves.toMatchObject({
      id: "msg_assistant",
      text: "Done",
      createdAt: 123
    });
  });

  it("checks health, session lookup, repo matching, and active-session status without sending prompts", async () => {
    const calls: string[] = [];
    const adapter = new LiveOpenCodeAdapter({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);

        if (path === "/doc") {
          return jsonResponse({ paths: { "/api/health": {}, "/api/session": {} } });
        }

        if (path === "/api/health") {
          return jsonResponse({ status: "ok" });
        }

        if (path === "/api/session/ses_worker_1") {
          return jsonResponse({
            data: {
              id: "ses_worker_1",
              location: {
                project: {
                  canonical: "/Users/lazydeepak/dev/kisab"
                }
              }
            }
          });
        }

        if (path === "/api/session/active") {
          return jsonResponse({ data: {} });
        }

        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
    });

    const checks = await adapter.checkReadiness(worker());

    expect(checks.every((check) => check.status === "PASS")).toBe(true);
    expect(calls).toEqual(["/doc", "/api/health", "/api/session/ses_worker_1", "/api/session/active"]);
  });

  it("selects the completed response belonging to a dispatch from newest-first v2 messages", async () => {
    const adapter = new LiveOpenCodeAdapter({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo) => {
        const path = new URL(String(input)).pathname;
        if (path === "/doc") {
          return jsonResponse({ paths: { "/api/session": {}, "/api/session/{sessionID}/message": {} } });
        }
        if (path.endsWith("/message")) {
          return jsonResponse({
            data: [
              { id: "later", type: "assistant", finish: "error", error: { message: "Provider quota exhausted" }, time: { created: 500, completed: 510 }, text: "Later" },
              { id: "next-user", type: "user", time: { created: 400 }, text: "Next" },
              { id: "final", type: "assistant", finish: "stop", time: { created: 300, completed: 310 }, text: "Done" },
              { id: "tool", type: "assistant", finish: "tool-calls", time: { created: 200, completed: 210 }, text: "tool" },
              { id: "dispatch", type: "user", time: { created: 100 }, text: "Build" },
              { id: "old", type: "assistant", finish: "stop", time: { created: 50, completed: 60 }, text: "Old" }
            ]
          });
        }
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
    });

    await expect(adapter.getLatestAssistantMessage(worker())).resolves.toMatchObject({ id: "later" });
    await expect(adapter.getAssistantResponseForDispatch(worker(), "dispatch")).resolves.toMatchObject({
      id: "final",
      text: "Done"
    });
    await expect(adapter.getDispatchFailure(worker(), "next-user")).resolves.toBe("Provider quota exhausted");
  });

  it("fails readiness clearly when the server requires authentication", async () => {
    const adapter = new LiveOpenCodeAdapter({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async () => new Response("auth required", { status: 401, statusText: "Unauthorized" })
    });

    const checks = await adapter.checkReadiness(worker());

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "worker.serverReachable",
        status: "FAIL",
        reason: "OpenCode server was not reachable: server requires authentication"
      })
    );
  });
});

function worker(): WorkerIdentity {
  return {
    type: "opencode",
    sessionId: "ses_worker_1",
    repoPath: "/Users/lazydeepak/dev/kisab"
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("OpenCode write contract (v2.0.26)", () => {
  /** Minimal spec shaped like the one OpenCode v2.0.26 actually publishes. */
  const v2Spec = {
    paths: {
      "/api/session": {},
      "/api/session/{sessionID}/prompt": { post: {} },
      "/api/session/{sessionID}/message": { get: {} }
    }
  };

  function clientFor(
    handler: (path: string, method: string, body: string | undefined) => Response,
    spec: unknown = v2Spec
  ) {
    const seen: Array<{ path: string; method: string; body: unknown }> = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        seen.push({ path, method, body });
        if (path === "/doc") return jsonResponse(spec);
        return handler(path, method, body);
      }
    });
    return { client, seen };
  }

  it("writes to /api/session/{id}/prompt with a flat top-level text", async () => {
    const { client, seen } = clientFor((path, method) =>
      path === "/api/session/ses_w/prompt" && method === "POST"
        ? jsonResponse({ data: { id: "msg_ok" } })
        : jsonResponse({})
    );

    await client.sendSessionMessage("ses_w", "hello");

    const post = seen.find((r) => r.method === "POST");
    expect(post?.path).toBe("/api/session/ses_w/prompt");
    expect(post?.body).toEqual({ text: "hello" });
  });

  it("never posts a v2 write to /api/session/{id}/message", async () => {
    const { client, seen } = clientFor(() => jsonResponse({}));

    await client.sendSessionMessage("ses_w", "hello");

    expect(seen.some((r) => r.method === "POST" && r.path === "/api/session/ses_w/message")).toBe(false);
  });

  it("refuses to retry on a legacy route the spec does not advertise", async () => {
    // 404 proves the v2 route is absent, but no evidence supports legacy, so the write must fail
    // loudly rather than being replayed and possibly delivered twice.
    const { client, seen } = clientFor((path, method) =>
      path === "/api/session/ses_w/prompt" && method === "POST"
        ? new Response("absent", { status: 404, statusText: "Not Found" })
        : jsonResponse({})
    );

    await expect(client.sendSessionMessage("ses_w", "hello")).rejects.toThrow(OpenCodeWriteUnsupportedError);
    expect(seen.some((r) => r.method === "POST" && r.path === "/session/ses_w/message")).toBe(false);
  });

  it("honours an explicit legacy pin without probing v2 at all", async () => {
    // Legacy compatibility is unverified against the installed server; it must be opt-in.
    const seen: string[] = [];
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      apiProtocol: "legacy",
      fetch: async (input: URL | RequestInfo, init) => {
        const path = new URL(String(input)).pathname;
        seen.push(`${init?.method ?? "GET"} ${path}`);
        return jsonResponse({});
      }
    });

    await client.sendSessionMessage("ses_w", "hello");

    expect(seen).toContain("POST /session/ses_w/message");
    expect(seen.some((r) => r.includes("/prompt"))).toBe(false);
  });

  it("sends the legacy parts body when legacy is selected", async () => {
    const bodies: Record<string, unknown> = {};
    const client = new OpenCodeHttpClient({
      baseUrl: "http://127.0.0.1:4096",
      apiProtocol: "legacy",
      fetch: async (input: URL | RequestInfo, init) => {
        if (init?.body) bodies[new URL(String(input)).pathname] = JSON.parse(String(init.body));
        return jsonResponse({});
      }
    });

    await client.sendSessionMessage("ses_w", "hello");

    expect(bodies["/session/ses_w/message"]).toEqual({ parts: [{ type: "text", text: "hello" }] });
  });

  it("does not retry a malformed-body rejection on another protocol", async () => {
    // 400 means the route exists and refused the payload. The turn may have been admitted, so a
    // cross-protocol retry could deliver the same instruction twice.
    const { client, seen } = clientFor(
      (path, method) =>
        path === "/api/session/ses_w/prompt" && method === "POST"
          ? new Response(JSON.stringify({ _tag: "InvalidRequestError", message: "Missing key at [\"text\"]" }), {
              status: 400,
              headers: { "content-type": "application/json" }
            })
          : jsonResponse({}),
      { paths: { ...v2Spec.paths, "/session/{sessionID}/message": { post: {} } } }
    );

    await expect(client.sendSessionMessage("ses_w", "hello")).rejects.toThrow(/Missing key/);
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("does not retry when a v2 write times out ambiguously", async () => {
    // A timeout says nothing about whether the server admitted the turn.
    const { client, seen } = clientFor(
      (path, method) =>
        path === "/api/session/ses_w/prompt" && method === "POST"
          ? new Response("gateway timeout", { status: 504, statusText: "Gateway Timeout" })
          : jsonResponse({}),
      { paths: { ...v2Spec.paths, "/session/{sessionID}/message": { post: {} } } }
    );

    await expect(client.sendSessionMessage("ses_w", "hello")).rejects.toThrow(/504/);
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("reports the admitted message id from the v2 prompt response", async () => {
    const { client } = clientFor((path, method) =>
      path === "/api/session/ses_w/prompt" && method === "POST"
        ? jsonResponse({ data: { id: "msg_admitted", sessionID: "ses_w" } })
        : jsonResponse({})
    );

    await expect(client.submitPrompt("ses_w", { text: "hi" })).resolves.toMatchObject({ id: "msg_admitted" });
  });

  it("sends a 2xx with an unparseable body as accepted rather than retrying", async () => {
    const { client, seen } = clientFor((path, method) =>
      path === "/api/session/ses_w/prompt" && method === "POST"
        ? new Response("<html>accepted</html>", { status: 200, headers: { "content-type": "text/html" } })
        : jsonResponse({})
    );

    await expect(client.submitPrompt("ses_w", { text: "hi" })).rejects.toBeInstanceOf(Error);
    expect(seen.filter((r) => r.method === "POST")).toHaveLength(1);
  });
});
