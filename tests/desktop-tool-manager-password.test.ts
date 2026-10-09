import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalDesktopToolLauncher } from "../src/application/desktop-tool-manager.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const PASSWORD_VARS = ["OPENCODE_SERVER_PASSWORD", "AGENT_RELAY_OPENCODE_PASSWORD"];

beforeEach(() => {
  for (const name of PASSWORD_VARS) {
    delete process.env[name];
  }
  vi.mocked(spawn).mockReset();
});

afterEach(() => {
  for (const name of PASSWORD_VARS) {
    delete process.env[name];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function readyChild(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    killed: false,
    kill: vi.fn(() => true)
  }) as unknown as ChildProcess;
}

/** fetch fails until the launcher has spawned the server, then reports ready. */
function stubEndpoint(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (vi.mocked(spawn).mock.calls.length === 0) throw new Error("offline");
      return new Response("{}", { status: 200 });
    })
  );
}

async function launch(baseUrl: string): Promise<{ env?: NodeJS.ProcessEnv; secured?: boolean }> {
  vi.mocked(spawn).mockReturnValue(readyChild());
  vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
  stubEndpoint();
  const launcher = new LocalDesktopToolLauncher();
  try {
    const result = await launcher.startOpenCode({ repoPath: "/tmp", baseUrl });
    const options = vi.mocked(spawn).mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    return { env: options?.env, secured: result.secured };
  } finally {
    await launcher.shutdown();
  }
}

describe("managed opencode server password handling", () => {
  it("passes OPENCODE_SERVER_PASSWORD through to the spawned server", async () => {
    process.env.OPENCODE_SERVER_PASSWORD = "relay-secret";
    const { env, secured } = await launch("http://127.0.0.1:4098");
    expect(env?.OPENCODE_SERVER_PASSWORD).toBe("relay-secret");
    expect(secured).toBe(true);
  });

  it("falls back to AGENT_RELAY_OPENCODE_PASSWORD", async () => {
    process.env.AGENT_RELAY_OPENCODE_PASSWORD = "canonical-secret";
    const { env, secured } = await launch("http://127.0.0.1:4099");
    expect(env?.OPENCODE_SERVER_PASSWORD).toBe("canonical-secret");
    expect(secured).toBe(true);
  });

  it("mints and shares a password when none is configured", async () => {
    // OpenCode >= 2 always authenticates its API. Given no OPENCODE_SERVER_PASSWORD it generates
    // a random one and prints it to its own stdout, which no client can discover -- so a launcher
    // that starts the server without supplying a password ends up holding a server that rejects
    // every request with 401. The launcher must therefore always supply the credential, and it
    // must be the same one the in-process client will present.
    const { env, secured } = await launch("http://127.0.0.1:4100");
    expect(env?.OPENCODE_SERVER_PASSWORD).toBeTruthy();
    expect(secured).toBe(true);
    // The launcher publishes it so the OpenCode client picks up the same secret.
    expect(process.env.OPENCODE_SERVER_PASSWORD).toBe(env?.OPENCODE_SERVER_PASSWORD);
  });

  it("does not treat an auth-rejecting server as ready", async () => {
    // A server that answers 401 to every probe is up but unusable. Reporting it as ready makes the
    // launcher claim success while every real request fails, so 401/403 must never satisfy the probe.
    const launcher = new LocalDesktopToolLauncher();
    vi.mocked(spawn).mockReturnValue(readyChild());
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    const apiProbes: Array<string | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      // Only readiness probes against /api must carry credentials; the separate conflict check
      // deliberately probes unauthenticated to learn whether anything is bound to the port.
      if (new URL(String(input)).pathname.startsWith("/api")) {
        apiProbes.push(headers.get("authorization") ?? undefined);
      }
      return new Response(JSON.stringify({ _tag: "UnauthorizedError" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    }));

    // The already-running check must fail, so the launcher falls through and starts its own server.
    // This mock keeps a server bound to the port, so the accurate diagnosis is a conflicting server
    // rather than a timeout -- either way it must not report success.
    await expect(
      launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4101" })
    ).rejects.toMatchObject({ code: "OPENCODE_ENDPOINT_OCCUPIED" });

    expect(apiProbes.length).toBeGreaterThan(0);
    // Every /api probe presented credentials; none was satisfied by a bare unauthenticated 401.
    expect(apiProbes.every((value) => typeof value === "string" && value.startsWith("Basic "))).toBe(true);
    await launcher.shutdown();
  }, 30_000);

  it("ignores the unauthenticated SPA shell when probing readiness", async () => {
    // OpenCode's SPA catch-all answers /doc, /global/health and / with 200 HTML without any
    // credential. Accepting those would declare an already-running server usable when every real
    // API call is rejected. Only a non-HTML answer from an /api route proves the credential works.
    const launcher = new LocalDesktopToolLauncher();
    vi.mocked(spawn).mockReturnValue(readyChild());
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    const apiResponses = new Map<string, Response>();
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      const canned = apiResponses.get(path);
      if (canned) return canned.clone();
      // Everything outside /api is the unauthenticated SPA shell.
      return new Response("<!doctype html><html lang=\"en\"></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }));

    // The SPA answers instantly, but no /api route does, so the launcher must not short-circuit as
    // "already running"; it spawns its own server and then reports the conflict.
    await expect(
      launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4102" })
    ).rejects.toMatchObject({ code: "OPENCODE_ENDPOINT_OCCUPIED" });
    // Proof it did not accept the SPA shell as an already-running server.
    expect(spawn).toHaveBeenCalledTimes(1);
    await launcher.shutdown();
  }, 30_000);

  it("reports a conflicting server instead of a generic start failure", async () => {
    // A server that already owns the endpoint but rejects our credential is a distinct problem from
    // "our server is still starting", and must not be reported as a timeout.
    const launcher = new LocalDesktopToolLauncher();
    const child = readyChild();
    child.once?.("exit", () => {});
    queueMicrotask(() => child.emit("exit", 1));
    vi.mocked(spawn).mockReturnValue(child);
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      // Probe with credentials -> 401 (not ours). Plain shell probe -> 200 HTML (something is bound).
      if (headers.get("authorization")) {
        return new Response(JSON.stringify({ _tag: "UnauthorizedError" }), {
          status: 401,
          headers: { "content-type": "application/json" }
        });
      }
      void input;
      return new Response("<!doctype html><html lang=\"en\"></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }));

    await expect(
      launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4103" })
    ).rejects.toMatchObject({ code: "OPENCODE_ENDPOINT_OCCUPIED" });
    await launcher.shutdown();
  }, 30_000);

  it("never launches on a non-loopback endpoint", async () => {
    const launcher = new LocalDesktopToolLauncher();
    await expect(
      launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://opencode.example:4096" })
    ).rejects.toMatchObject({ code: "INVALID_ENDPOINT" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
