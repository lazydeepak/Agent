import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDesktopToolLauncher } from "../src/application/desktop-tool-manager.js";
import { recoverOpenCode } from "../src/recovery/opencode.js";
import { ControllableWorker } from "./helpers.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("desktop managed tool launcher", () => {
  it("single-flights simultaneous recovery and manual starts across launchers for the same endpoint", async () => {
    const first = new LocalDesktopToolLauncher();
    const second = new LocalDesktopToolLauncher();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      killed: false,
      kill: vi.fn(() => { queueMicrotask(() => child.emit("exit", 0)); return true; })
    }) as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let ready = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!ready) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));
    const recover = (launcher: LocalDesktopToolLauncher, baseUrl: string) => recoverOpenCode({
      worker: new ControllableWorker([], "/tmp"),
      sessionId: "existing-session",
      expectedRepoPath: "/tmp",
      baseUrl,
      startServerLauncher: (repoPath, endpoint) => launcher.startOpenCode({ repoPath, baseUrl: endpoint })
    });
    try {
      const results = Promise.all([
        recover(first, "http://localhost:4096/"),
        recover(second, "http://127.0.0.1:4096"),
        second.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" })
      ]);
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
      ready = true;
      const [a, b, manual] = await results;
      expect(a).toMatchObject({ recovered: true });
      expect(b).toMatchObject({ recovered: true });
      expect(manual).toMatchObject({ alreadyRunning: false });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(process.execPath,
        ["serve", "--hostname", "127.0.0.1", "--port", "4096"], expect.objectContaining({ cwd: "/tmp" }));
      await second.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      ready = true;
      await first.shutdown();
      await second.shutdown();
    }
  });

  it("releases a rejected single-flight so a later start can retry", async () => {
    const launcher = new LocalDesktopToolLauncher();
    const input = { repoPath: "/definitely/missing/agent-relay-test", baseUrl: "http://127.0.0.1:4097" };
    const failures = await Promise.allSettled([launcher.startOpenCode(input), launcher.startOpenCode(input)]);
    expect(failures.every((result) => result.status === "rejected")).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await expect(launcher.startOpenCode({ ...input, repoPath: "/tmp" })).resolves.toMatchObject({ alreadyRunning: true });
    await launcher.shutdown();
  });

  it("refuses to launch tools on remote or implicit-port endpoints", async () => {
    const launcher = new LocalDesktopToolLauncher();
    await expect(
      launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "https://example.com:4096" })
    ).rejects.toMatchObject({ code: "INVALID_ENDPOINT" });
    await expect(
      launcher.startBrowser({ cdpUrl: "http://127.0.0.1" })
    ).rejects.toMatchObject({ code: "INVALID_ENDPOINT" });
    await launcher.shutdown();
  });

  it("rejects a missing selected repository before spawning OpenCode", async () => {
    const launcher = new LocalDesktopToolLauncher();
    await expect(
      launcher.startOpenCode({ repoPath: "/definitely/missing/agent-relay-test", baseUrl: "http://127.0.0.1:4096" })
    ).rejects.toMatchObject({ code: "OPENCODE_REPO_NOT_FOUND" });
  });
});

describe("launcher ownership", () => {
  it("releaseOpenCode unrefs and clears the child without killing it", async () => {
    const launcher = new LocalDesktopToolLauncher();
    const unrefSpy = vi.fn();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      killed: false,
      kill: vi.fn(() => true),
      unref: unrefSpy
    }) as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let fetchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCalls++;
      if (fetchCalls <= 4) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    await launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });
    launcher.releaseOpenCode();

    expect(unrefSpy).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    await launcher.shutdown();
  });

  it("shutdown kills owned children", async () => {
    const launcher = new LocalDesktopToolLauncher();
    const killSpy = vi.fn(() => { queueMicrotask(() => child.emit("exit", 0)); return true; });
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      killed: false,
      kill: killSpy,
      unref: vi.fn()
    }) as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let fetchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCalls++;
      if (fetchCalls <= 4) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    await launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });
    await launcher.shutdown();

    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
  });

  it("releaseOpenCode followed by shutdown does not double-kill", async () => {
    const launcher = new LocalDesktopToolLauncher();
    const killSpy = vi.fn(() => { queueMicrotask(() => child.emit("exit", 0)); return true; });
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      killed: false,
      kill: killSpy,
      unref: vi.fn()
    }) as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let fetchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCalls++;
      if (fetchCalls <= 4) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    await launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });
    launcher.releaseOpenCode();
    await launcher.shutdown();

    expect(killSpy).not.toHaveBeenCalled();
  });

  it("separate launcher instances have independent child state", async () => {
    const first = new LocalDesktopToolLauncher();
    const second = new LocalDesktopToolLauncher();

    const makeFakeChild = () => Object.assign(new EventEmitter(), {
      exitCode: null,
      killed: false,
      kill: vi.fn(() => { queueMicrotask(() => fakeChild.emit("exit", 0)); return true; }),
      unref: vi.fn()
    }) as unknown as ChildProcess;

    let fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let fetchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCalls++;
      if (fetchCalls <= 4) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    await first.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });

    fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild);
    fetchCalls = 0;
    await second.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4097" });

    first.releaseOpenCode();
    await first.shutdown();

    expect(fakeChild.kill).not.toHaveBeenCalled();
    await second.shutdown();
    expect(fakeChild.kill).toHaveBeenCalled();
  });
});
