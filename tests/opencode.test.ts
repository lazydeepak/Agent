import { describe, expect, it } from "vitest";
import { LiveOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { OpenCodeHttpClient, OpenCodeHttpError } from "../src/adapters/opencode/http.js";
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

  it("prefers coherent v2 message routes when OpenCode exposes mixed API generations", async () => {
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
              "/api/session/{sessionID}/message": { get: {}, post: {} },
              "/session/status": { get: {} },
              "/session/{sessionID}/message": { get: {}, post: {} }
            }
          });
        }
        if (path === "/api/session/ses_worker_1/message" && method === "GET") {
          expect(new URL(String(input)).searchParams.get("order")).toBe("desc");
          return jsonResponse({ data: [{ id: "msg_1", type: "assistant", content: [] }] });
        }
        if (path === "/api/session/ses_worker_1/message" && method === "POST") {
          return jsonResponse({});
        }
        if (path === "/api/session/active" && method === "GET") {
          return jsonResponse({ data: { ses_worker_1: { type: "busy" } } });
        }
        return new Response("wrong message route", { status: 404, statusText: "Not Found" });
      }
    });

    await expect(client.listSessionMessages("ses_worker_1")).resolves.toHaveLength(1);
    await expect(client.sendSessionMessage("ses_worker_1", "Next task")).resolves.toBeUndefined();
    await expect(client.listActiveSessions()).resolves.toEqual({ ses_worker_1: { type: "busy" } });

    expect(requests).toEqual([
      { path: "/doc", method: "GET" },
      { path: "/api/session/ses_worker_1/message", method: "GET" },
      { path: "/api/session/ses_worker_1/message", method: "POST" },
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
              "/api/session/{sessionId}/message": { get: {}, post: {} }
            }
          });
        }
        if (path === "/global/health") {
          return jsonResponse({ healthy: true, version: "2.0.22" });
        }
        if (path === "/api/session/ses_worker_1/message" && method === "POST") {
          return jsonResponse({});
        }
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }
    });

    await expect(client.sendSessionMessage("ses_worker_1", "Hello 2.0.22")).resolves.toBeUndefined();
    expect(requests).toContain("POST /api/session/ses_worker_1/message");
    expect(requests).not.toContain("POST /session/ses_worker_1/message");
  });

  it("falls back to legacy message writes when v2 posts are unavailable", async () => {
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
              "/api/session": {},
              "/api/session/{sessionID}/message": { get: {} },
              "/session/{sessionID}/message": { post: {} }
            }
          });
        }
        if (path === "/api/session/ses_worker_1/message" && method === "POST") {
          return new Response("no post", { status: 404, statusText: "Not Found" });
        }
        if (path === "/session/ses_worker_1/message" && method === "POST") {
          return jsonResponse({});
        }
        if (path === "/api/session/ses_worker_1/message" && method === "GET") {
          return jsonResponse({ data: [] });
        }
        return jsonResponse({});
      }
    });

    await client.sendSessionMessage("ses_worker_1", "Hello");
    expect(requests).toContain("POST /api/session/ses_worker_1/message");
    expect(requests).toContain("POST /session/ses_worker_1/message");
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
      prompt: { text: "Next task" },
      delivery: "queue",
      resume: true
    });
    expect(submittedBody).not.toHaveProperty("text");
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
