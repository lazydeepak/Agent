import { afterEach, describe, expect, it } from "vitest";
import { createRemoteServer, type RemoteServiceOptions } from "../src/remote/remote-server.js";

interface Started {
  baseUrl: string;
  close: () => Promise<void>;
}

const started: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (started.length > 0) {
    await started.pop()!();
  }
});

function adapter(overrides: Partial<RemoteServiceOptions["adapter"]> = {}): RemoteServiceOptions["adapter"] {
  return {
    getStatus: () => ({ pairs: [] }) as never,
    getTimeline: () => [],
    startProject: async (id: string) => ({ projectPairId: id, action: "start" }),
    pauseProject: async (id: string) => ({ projectPairId: id, action: "pause" }),
    ...overrides
  } as RemoteServiceOptions["adapter"];
}

async function start(options: Partial<RemoteServiceOptions> & { token?: string } = {}): Promise<Started> {
  const created = createRemoteServer({
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    adapter: adapter(),
    ...options
  });
  await new Promise<void>((resolve) => created.server.listen(0, "127.0.0.1", () => resolve()));
  const address = created.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  started.push(created.close);
  return { baseUrl: `http://127.0.0.1:${port}`, close: created.close };
}

function get(baseUrl: string, path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

function post(baseUrl: string, path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("remote server startup guards", () => {
  it("refuses to start without a token", () => {
    expect(() => createRemoteServer({ token: "", adapter: adapter() })).toThrow(/RELAY_REMOTE_TOKEN/);
  });

  it("refuses a non-loopback bind without explicit opt-in", () => {
    expect(() => createRemoteServer({ token: "t", host: "0.0.0.0", adapter: adapter() })).toThrow(
      /Refusing to bind/
    );
  });

  it("allows a non-loopback bind when explicitly opted in", () => {
    expect(() =>
      createRemoteServer({ token: "t", host: "0.0.0.0", allowPublicBind: true, adapter: adapter() })
    ).not.toThrow();
  });
});

describe("remote server authentication", () => {
  it("rejects requests without a token", async () => {
    const { baseUrl } = await start();
    const response = await get(baseUrl, "/status");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
  });

  it("rejects an incorrect token", async () => {
    const { baseUrl } = await start();
    expect((await get(baseUrl, "/status", "wrong")).status).toBe(401);
  });

  it("accepts the configured token", async () => {
    const { baseUrl } = await start();
    const response = await get(baseUrl, "/status", "test-token");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { pairs: [] } });
  });

  it("throttles repeated authentication failures", async () => {
    const { baseUrl } = await start();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await get(baseUrl, "/status", "wrong");
    }
    expect((await get(baseUrl, "/status", "wrong")).status).toBe(429);
  });
});

describe("remote server endpoints", () => {
  it("serves health and timeline", async () => {
    const { baseUrl } = await start({
      adapter: adapter({ getTimeline: () => [{ time: "now", type: "X", pairId: "local-dev" }] })
    });
    await expect((await get(baseUrl, "/health", "test-token")).json()).resolves.toEqual({
      ok: true,
      data: { status: "ready" }
    });
    const timeline = await get(baseUrl, "/timeline?pairId=local-dev", "test-token");
    await expect(timeline.json()).resolves.toMatchObject({ ok: true, data: [{ pairId: "local-dev" }] });
  });

  it("starts and pauses a project with a valid id", async () => {
    const { baseUrl } = await start();
    await expect(
      (await post(baseUrl, "/start-project", { projectPairId: "local-dev" }, "test-token")).json()
    ).resolves.toMatchObject({ ok: true, data: { action: "start" } });
    await expect(
      (await post(baseUrl, "/pause-project", { projectPairId: "local-dev" }, "test-token")).json()
    ).resolves.toMatchObject({ ok: true, data: { action: "pause" } });
  });

  it("rejects malformed project ids", async () => {
    const { baseUrl } = await start();
    for (const projectPairId of ["", "Not Valid!", "../../etc", "a".repeat(200)]) {
      const response = await post(baseUrl, "/start-project", { projectPairId }, "test-token");
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_PROJECT_PAIR_ID" }
      });
    }
  });

  it("rejects oversized and malformed bodies", async () => {
    const { baseUrl } = await start();
    const oversized = JSON.stringify({ projectPairId: `x${"a".repeat(70_000)}` });
    expect((await post(baseUrl, "/start-project", oversized, "test-token")).status).toBe(400);
    expect((await post(baseUrl, "/start-project", "{not json", "test-token")).status).toBe(400);
  });

  it("does not reflect unknown paths or internal error messages", async () => {
    const { baseUrl } = await start({
      adapter: adapter({
        startProject: async () => {
          throw new Error("sqlite file /secret/path is locked by user@example.com");
        }
      })
    });
    const missing = await get(baseUrl, "/nope?secret=1", "test-token");
    const missingBody = await missing.text();
    expect(JSON.parse(missingBody) as { error: { code: string } }).toMatchObject({
      error: { code: "NOT_FOUND" }
    });
    expect(missingBody).not.toContain("/nope");

    const failed = await post(baseUrl, "/start-project", { projectPairId: "local-dev" }, "test-token");
    const body = (await failed.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain("/secret/path");
    expect(body.error.message).not.toContain("user@example.com");
  });

  it("rejects the wrong method", async () => {
    const { baseUrl } = await start();
    const response = await fetch(`${baseUrl}/status`, {
      method: "POST",
      headers: { authorization: "Bearer test-token" }
    });
    expect(response.status).toBe(405);
  });
});
