import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteRelayStore } from "../src/persistence/index.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];

describe("relay CLI", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  it("exits 0 when the requested pair is READY", async () => {
    const configPath = await writeConfig({ pairs: [makePair()] });
    const result = runCli(["validate", "kisab-main", "--config", configPath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("kisab-main  READY");
    expect(result.stdout).toContain("worker.sessionExists");
  }, 15_000);

  it("exits non-zero when any validate-all pair is NOT_READY", async () => {
    const configPath = await writeConfig({
      pairs: [
        makePair(),
        makePair({
          pairId: "kisab-secondary",
          worker: {
            type: "opencode",
            sessionId: "ses_worker_2",
            repoPath: "/Users/lazydeepak/dev/other",
            readiness: {
              "worker.sessionExists": "OpenCode session was not found."
            }
          },
          planner: {
            type: "chatgpt-browser",
            conversationId: "planner-conversation-2",
            conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
          }
        })
      ]
    });
    const result = runCli(["validate", "--all", "--config", configPath]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("kisab-main  READY");
    expect(result.stdout).toContain("kisab-secondary  NOT_READY");
    expect(result.stdout).toContain("OpenCode session was not found.");
  }, 15_000);

  it("exits non-zero with an explicit message for an unknown pair", async () => {
    const configPath = await writeConfig({ pairs: [makePair()] });
    const result = runCli(["validate", "missing-pair", "--config", configPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown pairId "missing-pair"');
  }, 15_000);

  it("exits non-zero with an explicit message for invalid config", async () => {
    const configPath = await writeConfig({
      pairs: [makePair({ pairId: "Invalid Pair" })]
    });
    const result = runCli(["validate", "--all", "--config", configPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pairId must use lowercase");
  }, 15_000);

  it("accepts an empty pairs config without a schema failure", async () => {
    const configPath = await writeConfig({ pairs: [] });
    const result = runCli(["validate", "--all", "--config", configPath]);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("Invalid configuration");
  }, 15_000);

  it("prints a usage error for missing relay subcommand", async () => {
    const configPath = await writeConfig({ pairs: [makePair()] });
    const result = runCli(["relay", "kisab-main", "--config", configPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Relay command requires worker-to-planner or planner-to-worker");
  }, 15_000);

  it("requires an explicit message for planner-to-worker while ChatGPT is mocked", async () => {
    const configPath = await writeConfig({ pairs: [makePair()] });
    const result = runCli(["relay", "planner-to-worker", "kisab-main", "--config", configPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Relay planner-to-worker requires --message");
  }, 15_000);

  it("requires a pairId for supervise", async () => {
    const result = runCli(["supervise"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: npm run relay -- supervise");
  }, 15_000);

  it("requires --watch before allowing --relay", async () => {
    const configPath = await writeConfig({ pairs: [makePair()] });
    const result = runCli(["supervise", "kisab-main", "--relay", "--config", configPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--relay requires --watch");
  }, 15_000);

  it("requires a supervisor subcommand", async () => {
    const result = runCli(["supervisor"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Supervisor command requires one of: pause, resume, status");
  }, 15_000);

  it("requires a pairId for supervisor commands", async () => {
    const result = runCli(["supervisor", "pause"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Supervisor command requires a pairId.");
  }, 15_000);

it("requires --once when supervise is combined with --watch", async () => {
    const configPath = await writeConfig({ pairs: [makePair()] });
    const result = runCli(["supervise", "kisab-main", "--once", "--watch", "--config", configPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be used exclusively");
  });

  it("prune in dry-run lists configured-but-unconfigured pairs without deleting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-cli-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    await writeFile(configPath, JSON.stringify({ pairs: [makePair({ pairId: "kisab-main" })] }), "utf8");
    const dbPath = join(directory, "agent-relay.sqlite");

    const store = new SqliteRelayStore(dbPath);
    await store.init();
    const r1 = store.createRecord({
      pairId: "kisab-main",
      direction: "planner-to-worker",
      sourceMessageId: "m1",
      sourceHash: "h1"
    });
    store.updateStatus({ pairId: "kisab-main", direction: "planner-to-worker", sourceMessageId: "m1", sourceHash: "h1" }, "DELIVERED", { targetId: "t1" });
    store.touchPairState({ pairId: "kisab-main", lastWorkerMessageId: String(r1.id) });

    const r2 = store.createRecord({
      pairId: "orphan-main",
      direction: "planner-to-worker",
      sourceMessageId: "m2",
      sourceHash: "h2"
    });
    store.updateStatus({ pairId: "orphan-main", direction: "planner-to-worker", sourceMessageId: "m2", sourceHash: "h2" }, "DELIVERED", { targetId: "t2" });
    store.touchPairState({ pairId: "orphan-main", lastWorkerMessageId: String(r2.id) });
    store.close();

    const dry = runCli(["prune", "--config", configPath, "--db", dbPath]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("orphan-main");
    expect(dry.stdout).not.toContain("kisab-main");
    expect(dry.stdout).toContain("Run with --force to delete.");

    const forced = runCli(["prune", "--config", configPath, "--db", dbPath, "--force"]);
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain("Pruned 1 of 1 orphaned pair(s).");

    const after = new SqliteRelayStore(dbPath);
    await after.init();
    expect(after.getPairState("kisab-main")).toBeDefined();
    expect(after.listRecords("kisab-main")).toHaveLength(1);
    expect(after.getPairState("orphan-main")).toBeUndefined();
    expect(after.listRecords("orphan-main")).toHaveLength(0);
    after.close();
  });
});

async function writeConfig(config: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-cli-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  await writeFile(configPath, JSON.stringify(config), "utf8");
  return configPath;
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}
