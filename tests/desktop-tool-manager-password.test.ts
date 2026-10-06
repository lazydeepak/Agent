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

  it("reports unsecured when no password is configured", async () => {
    const { env, secured } = await launch("http://127.0.0.1:4100");
    expect(env?.OPENCODE_SERVER_PASSWORD).toBeUndefined();
    expect(secured).toBe(false);
  });

  it("never launches on a non-loopback endpoint", async () => {
    const launcher = new LocalDesktopToolLauncher();
    await expect(
      launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://opencode.example:4096" })
    ).rejects.toMatchObject({ code: "INVALID_ENDPOINT" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
