import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, recoveryOptions, runCli } from "../src/cli.js";
import { LocalDesktopToolLauncher } from "../src/application/desktop-tool-manager.js";
import { recoverOpenCode } from "../src/recovery/opencode.js";
import { ControllableWorker, makePair } from "./helpers.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    try { await rm(path, { force: true, recursive: true }); } catch {}
  }));
});

function makeChild(overrides: Partial<ChildProcess> = {}): ChildProcess {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    killed: false,
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("exit", 0));
      return true;
    }),
    unref: vi.fn(),
    ...overrides
  }) as unknown as ChildProcess;
}

let child: ChildProcess;

function setupSpawnReachingEndpoint(
  worker: ControllableWorker
): void {
  child = makeChild();
  vi.mocked(spawn).mockImplementation(() => {
    worker.reachable = true;
    return child;
  });
}

describe("CLI safe recovery launcher", () => {
  it.each([
    ["supervise", "kisab-main", "--watch"],
    ["supervise", "kisab-main", "--watch", "--relay"],
    ["runtime", "start", "kisab-main"],
    ["recovery", "retry", "kisab-main"]
  ])("wires the shared safe launcher for %s", (...command) => {
    const pair = pairWithServer("http://127.0.0.1:4096");
    const launcher = new LocalDesktopToolLauncher();
    const options = recoveryOptions(parseArgs([...command, "--recovery", "safe"]), pair, launcher);

    expect(options).toMatchObject({ policy: "safe", baseUrl: "http://127.0.0.1:4096" });
    expect(options?.startServerLauncher).toEqual(expect.any(Function));
  });

  it("uses the authoritative launcher only while unreachable, then preserves the exact worker session without replay", async () => {
    const configuredPair = pairWithServer("http://127.0.0.1:4096");
    const pair = { ...configuredPair, worker: { ...configuredPair.worker, sessionId: "bound-not-latest", repoPath: "/tmp" } };
    const launcher = new LocalDesktopToolLauncher();
    const options = recoveryOptions(parseArgs(["recovery", "retry", pair.pairId, "--recovery", "safe"]), pair, launcher);
    const worker = new ControllableWorker([], pair.worker.repoPath);
    worker.setUnreachable();
    let endpointReachable = false;
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    vi.mocked(spawn).mockImplementation(() => {
      endpointReachable = true;
      worker.reachable = true;
      return child;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!endpointReachable) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    const session = vi.spyOn(worker, "getSession");
    const result = await recoverOpenCode({
      worker,
      sessionId: pair.worker.sessionId,
      expectedRepoPath: pair.worker.repoPath,
      baseUrl: options?.baseUrl,
      startServerLauncher: options?.startServerLauncher,
      maxAttempts: 1
    });

    expect(result).toMatchObject({ recovered: true });
    expect(spawn).toHaveBeenCalledOnce();
    expect(session).toHaveBeenCalledExactlyOnceWith("bound-not-latest");
    expect(worker.sentPlannerMessages).toHaveLength(0);
    await launcher.shutdown();
  });

  it("does not spawn when the endpoint is already reachable", async () => {
    const pair = pairWithServer("http://127.0.0.1:4097");
    const launcher = new LocalDesktopToolLauncher();
    const options = recoveryOptions(parseArgs(["supervise", pair.pairId, "--watch", "--recovery", "safe"]), pair, launcher);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    vi.mocked(spawn).mockClear();

    const worker = new ControllableWorker([], pair.worker.repoPath);
    const result = await recoverOpenCode({
      worker,
      sessionId: pair.worker.sessionId,
      expectedRepoPath: pair.worker.repoPath,
      baseUrl: options?.baseUrl,
      startServerLauncher: options?.startServerLauncher,
      maxAttempts: 1
    });

    expect(result).toMatchObject({ recovered: true });
    expect(spawn).not.toHaveBeenCalled();
    await launcher.shutdown();
  });

  it("does not supply a launcher for --recovery none", () => {
    const pair = pairWithServer("http://127.0.0.1:4098");
    const launcher = new LocalDesktopToolLauncher();
    const options = recoveryOptions(parseArgs(["runtime", "start", pair.pairId, "--recovery", "none"]), pair, launcher);

    expect(options).toMatchObject({ policy: "none" });
    expect(options?.startServerLauncher).toBeUndefined();
  });
});

describe("one-shot CLI ownership", () => {
  it("starts a long-lived child via one-shot recovery and completes deterministically", async () => {
    const pair = pairWithServer("http://127.0.0.1:4096");
    pair.worker.repoPath = process.cwd();
    const launcher = new LocalDesktopToolLauncher();
    const options = recoveryOptions(parseArgs(["recovery", "retry", pair.pairId, "--recovery", "safe"]), pair, launcher);

    child = makeChild();
    const unrefSpy = child.unref as ReturnType<typeof vi.fn>;
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let endpointReachable = false;
    vi.mocked(spawn).mockImplementation(() => {
      endpointReachable = true;
      return child;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!endpointReachable) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    const worker = new ControllableWorker([], pair.worker.repoPath);
    const result = await recoverOpenCode({
      worker,
      sessionId: pair.worker.sessionId,
      expectedRepoPath: pair.worker.repoPath,
      baseUrl: options?.baseUrl,
      startServerLauncher: options?.startServerLauncher,
      maxAttempts: 1
    });

    expect(result).toMatchObject({ recovered: true });
    expect(spawn).toHaveBeenCalledOnce();

    launcher.releaseOpenCode();
    expect(unrefSpy).toHaveBeenCalledOnce();
    expect(launcher["openCode"]).toBeUndefined();

    await launcher.shutdown();
  });

  it("keeps the child owned on recovery failure so CLI cleanup can stop it", async () => {
    const pair = pairWithServer("http://127.0.0.1:4096");
    pair.worker.repoPath = process.cwd();
    const launcher = new LocalDesktopToolLauncher();
    const options = recoveryOptions(parseArgs(["recovery", "retry", pair.pairId, "--recovery", "safe"]), pair, launcher);

    child = makeChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let endpointReachable = false;
    vi.mocked(spawn).mockImplementation(() => {
      endpointReachable = true;
      return child;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!endpointReachable) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    const worker = new ControllableWorker([], pair.worker.repoPath);
    worker.setUnreachable();
    await recoverOpenCode({
      worker,
      sessionId: pair.worker.sessionId,
      expectedRepoPath: pair.worker.repoPath,
      baseUrl: options?.baseUrl,
      startServerLauncher: options?.startServerLauncher,
      maxAttempts: 1,
      sleep: async () => {}
    });

    expect(launcher["openCode"]).toBeDefined();
    await launcher.shutdown();
    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    expect(launcher["openCode"]).toBeUndefined();
  });

  it("shuts down owned children on long-running command signal", async () => {
    const pair = pairWithServer("http://127.0.0.1:4096");
    pair.worker.repoPath = process.cwd();
    const launcher = new LocalDesktopToolLauncher();
    const options = recoveryOptions(parseArgs(["supervise", pair.pairId, "--watch", "--recovery", "safe"]), pair, launcher);

    child = makeChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let endpointReachable2 = false;
    vi.mocked(spawn).mockImplementation(() => {
      endpointReachable2 = true;
      return child;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!endpointReachable2) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    const worker = new ControllableWorker([], pair.worker.repoPath);
    await recoverOpenCode({
      worker,
      sessionId: pair.worker.sessionId,
      expectedRepoPath: pair.worker.repoPath,
      baseUrl: options?.baseUrl,
      startServerLauncher: options?.startServerLauncher,
      maxAttempts: 1
    });

    expect(launcher["openCode"]).toBeDefined();

    await launcher.shutdown();
    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    expect(launcher["openCode"]).toBeUndefined();
  });
});

describe("repeated CLI invocations", () => {
  it("does not share launcher state between separate CLI invocations", async () => {
    const pair = pairWithServer("http://127.0.0.1:4096");
    const first = new LocalDesktopToolLauncher();
    const second = new LocalDesktopToolLauncher();
    const options1 = recoveryOptions(parseArgs(["recovery", "retry", pair.pairId, "--recovery", "safe"]), pair, first);
    const options2 = recoveryOptions(parseArgs(["recovery", "retry", pair.pairId, "--recovery", "safe"]), pair, second);

    expect(options1?.startServerLauncher).toBeDefined();
    expect(options2?.startServerLauncher).toBeDefined();
    expect(options1?.startServerLauncher).not.toBe(options2?.startServerLauncher);

    child = makeChild();
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    vi.mocked(spawn).mockImplementation(() => child);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    const worker1 = new ControllableWorker([], pair.worker.repoPath);
    await recoverOpenCode({
      worker: worker1,
      sessionId: pair.worker.sessionId,
      expectedRepoPath: pair.worker.repoPath,
      baseUrl: options1?.baseUrl,
      startServerLauncher: options1?.startServerLauncher,
      maxAttempts: 1
    });

    first.releaseOpenCode();
    await first.shutdown();

    const worker2 = new ControllableWorker([], pair.worker.repoPath);
    vi.mocked(spawn).mockClear();
    await recoverOpenCode({
      worker: worker2,
      sessionId: pair.worker.sessionId,
      expectedRepoPath: pair.worker.repoPath,
      baseUrl: options2?.baseUrl,
      startServerLauncher: options2?.startServerLauncher,
      maxAttempts: 1
    });

    second.releaseOpenCode();
    await second.shutdown();
  });
});

describe("simultaneous starts with single-flight protection", () => {
  it("single-flights simultaneous recovery and manual starts across launchers for the same endpoint", async () => {
    const first = new LocalDesktopToolLauncher();
    const second = new LocalDesktopToolLauncher();
    child = makeChild();
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
});

describe("platform-specific ownership", () => {
  it("uses spawn with executable-plus-argument arrays, not shell strings", async () => {
    const pair = pairWithServer("http://127.0.0.1:4096");
    const launcher = new LocalDesktopToolLauncher();
    child = makeChild();
    vi.mocked(spawn).mockReturnValue(child);
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let fetchCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCalls++;
      if (fetchCalls === 1) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    await launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });

    const [, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(typeof args).toBe("object");
    expect(Array.isArray(args)).toBe(true);
    expect(options).not.toMatchObject({ shell: true });
    expect(options).toMatchObject({ cwd: "/tmp" });

    await launcher.shutdown();
  });

  it("uses platform-neutral Node process APIs for killing children", async () => {
    const launcher = new LocalDesktopToolLauncher();
    child = makeChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;
    vi.stubEnv("AGENT_RELAY_OPENCODE_EXECUTABLE", process.execPath);
    let endpointReachable = false;
    vi.mocked(spawn).mockImplementation(() => {
      endpointReachable = true;
      return child;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!endpointReachable) throw new Error("offline");
      return new Response("{}", { status: 200 });
    }));

    await launcher.startOpenCode({ repoPath: "/tmp", baseUrl: "http://127.0.0.1:4096" });
    await launcher.shutdown();

    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("in-process CLI signal-listener hygiene", () => {
  it("repeated in-process CLI invocations do not accumulate process signal listeners", () => {
    const { configPath, dbPath } = syncFixture();
    const baseline = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");

    for (let i = 0; i < 3; i++) {
      runCli(["runtime", "status", "--all", "--config", configPath, "--db", dbPath]);
    }

    const after = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    expect(after).toBe(baseline);
  });

  it("runtime start error path removes signal listeners before returning", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-listener-cleanup-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "agent-relay.sqlite");
    const pair = makePair({ enabled: false });
    await writeFile(configPath, JSON.stringify({ pairs: [pair] }), "utf8");

    const before = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    await runCli(["runtime", "start", "--all", "--config", configPath, "--db", dbPath]);
    const after = process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");
    expect(after).toBe(before);
  });
});

function pairWithServer(baseUrl: string) {
  const pair = makePair();
  return { ...pair, worker: { ...pair.worker, server: { baseUrl } } };
}

function twoPairs() {
  return [
    makePair(),
    makePair({
      pairId: "susankhya-main",
      worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
      planner: {
        type: "chatgpt-browser",
        conversationId: "planner-conversation-2",
        conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
      }
    })
  ];
}

import { mkdirSync } from "node:fs";

function syncFixture(): { configPath: string; dbPath: string } {
  const dir = join(tmpdir(), "agent-relay-sync-" + Math.random().toString(36).slice(2));
  mkdirSync(dir);
  tempDirs.push(dir);
  const configPath = join(dir, "pairs.json");
  const dbPath = join(dir, "agent-relay.sqlite");
  writeFileSync(configPath, JSON.stringify({ pairs: twoPairs() }), "utf8");
  return { configPath, dbPath };
}
