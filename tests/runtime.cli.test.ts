import { spawn, type ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRelayStore } from "../src/persistence/store.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];

function twoPairs(enabled = true) {
  return [
    makePair({ enabled }),
    makePair({
      pairId: "susankhya-main",
      enabled,
      worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
      planner: {
        type: "chatgpt-browser",
        conversationId: "planner-conversation-2",
        conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
      }
    })
  ];
}

describe("runtime CLI", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  it("prints a status table from persistence", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs() });
    const result = runCli(["runtime", "status", "--all", "--config", configPath, "--db", dbPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("runtime status");
    expect(result.stdout).toContain("enabled: 2  running: 0  healthy: 0  degraded: 0  failed: 0");
    expect(result.stdout).toContain("kisab-main");
    expect(result.stdout).toContain("susankhya-main");
    expect(result.stdout).toContain("STOPPED(enabled)");
  }, 30_000);

  it("prints a JSON status report", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs() });
    const result = runCli(["runtime", "status", "kisab-main", "--json", "--config", configPath, "--db", dbPath]);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      enabled: number;
      running: number;
      pairs: Array<{ pairId: string; runtimeState: string; enabled: boolean }>;
    };
    expect(report.enabled).toBe(1);
    expect(report.running).toBe(0);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]).toMatchObject({ pairId: "kisab-main", runtimeState: "STOPPED", enabled: true });
  }, 30_000);

  it("runtime stop records stop metadata and subsequent status stays stopped", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs() });

    const stopped = runCli(["runtime", "stop", "kisab-main", "--config", configPath, "--db", dbPath]);
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toContain("Stopped runtime for kisab-main.");

    const store = new SqliteRelayStore(dbPath);
    await store.init();
    try {
      const metadata = store.getRuntimeState("kisab-main");
      expect(metadata?.runtimeEnabled).toBe(false);
      expect(metadata?.lastRuntimeStopAt).toBeTruthy();
      expect(store.getRuntimeState("susankhya-main")).toBeUndefined();
    } finally {
      store.close();
    }

    const status = runCli(["runtime", "status", "--all", "--config", configPath, "--db", dbPath]);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("running: 0");
  }, 30_000);

  it("runtime start runs both pairs and stops cleanly on SIGTERM", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs() });
    const { child, output, finished } = spawnCli([
      "runtime",
      "start",
      "--all",
      "--poll-interval",
      "100",
      "--config",
      configPath,
      "--db",
      dbPath
    ]);

    try {
      await waitForOutput(output, (stdout) => stdout.includes("enabled: 2  running: 2"), 30_000);
      expect(output.stdout).toContain("runtime status");
      expect(output.stdout).toContain("healthy: 2");

      child.kill("SIGTERM");
      const result = await finished;
      expect(result.status).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }

    const store = new SqliteRelayStore(dbPath);
    await store.init();
    try {
      const kisab = store.getRuntimeState("kisab-main");
      const susankhya = store.getRuntimeState("susankhya-main");
      expect(kisab?.runtimeEnabled).toBe(false);
      expect(kisab?.lastRuntimeStartAt).toBeTruthy();
      expect(susankhya?.runtimeEnabled).toBe(false);
    } finally {
      store.close();
    }
  }, 40_000);

  it("rejects a duplicate identity across configured pairs at runtime start", async () => {
    const { configPath, dbPath } = await fixture({
      pairs: [
        makePair(),
        makePair({
          pairId: "susankhya-main",
          worker: { type: "opencode", sessionId: "ses_worker_1", repoPath: "/Users/lazydeepak/dev/susankhya" },
          planner: {
            type: "chatgpt-browser",
            conversationId: "planner-conversation-2",
            conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
          }
        })
      ]
    });

    const result = runCli(["runtime", "start", "--all", "--config", configPath, "--db", dbPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid configuration");
    expect(result.stderr).toContain("Duplicate OpenCode session ownership");
  }, 30_000);

  it("refuses to start a disabled pair", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs(false) });
    const result = runCli(["runtime", "start", "kisab-main", "--config", configPath, "--db", dbPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot start disabled pair(s)");
  }, 30_000);

  it("rejects an all-disabled runtime start", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs(false) });
    const result = runCli(["runtime", "start", "--all", "--config", configPath, "--db", dbPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No runtime pairs were selected");
  }, 30_000);

  it("reports an unknown pairId for runtime commands", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs() });
    const result = runCli(["runtime", "status", "missing-pair", "--config", configPath, "--db", dbPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown pairId "missing-pair"');
  }, 30_000);

  it("requires a runtime subcommand, an eligible identity, and exclusive selectors", async () => {
    const { configPath, dbPath } = await fixture({ pairs: twoPairs() });

    const noSubcommand = runCli(["runtime", "--config", configPath, "--db", dbPath]);
    expect(noSubcommand.status).toBe(1);
    expect(noSubcommand.stderr).toContain("Runtime command requires one of: start, status, stop");

    const unknownSubcommand = runCli(["runtime", "fly", "kisab-main", "--config", configPath, "--db", dbPath]);
    expect(unknownSubcommand.status).toBe(1);
    expect(unknownSubcommand.stderr).toContain("Runtime command requires one of: start, status, stop");

    const noSelector = runCli(["runtime", "status", "--config", configPath, "--db", dbPath]);
    expect(noSelector.status).toBe(1);
    expect(noSelector.stderr).toContain("Runtime command requires --all or at least one pairId");

    const both = runCli(["runtime", "status", "--all", "kisab-main", "--config", configPath, "--db", dbPath]);
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("Choose either --all or pairIds, not both.");
  }, 30_000);
});

interface Fixture {
  configPath: string;
  dbPath: string;
}

async function fixture(config: unknown): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-runtime-cli-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");
  return { configPath, dbPath: join(directory, "agent-relay.sqlite") };
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function spawnCli(args: string[]): {
  child: ChildProcess;
  output: { stdout: string; stderr: string };
  finished: Promise<{ status: number | null }>;
} {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk: Buffer) => {
    output.stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output.stderr += chunk.toString();
  });

  const finished = new Promise<{ status: number | null }>((resolve) => {
    child.on("close", (code) => resolve({ status: code }));
  });

  return { child, output, finished };
}

async function waitForOutput(
  output: { stdout: string },
  matches: (stdout: string) => boolean,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (matches(output.stdout)) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for runtime output. Got:\n${output.stdout}`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}