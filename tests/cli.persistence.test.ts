import { createServer, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];
let server: Server | undefined;
let serverPort = 0;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("relay CLI persistence and duplicate suppression", () => {
  it("delivers once, skips the identical retry as SKIPPED_DUPLICATE, and inspects state", async () => {
    await startOpenCodeServer();
    const { configPath, dbPath } = await fixture();

    const first = await runCli([
      "relay",
      "worker-to-planner",
      "kisab-main",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("DELIVERED");

    const second = await runCli([
      "relay",
      "worker-to-planner",
      "kisab-main",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("SKIPPED_DUPLICATE");

    const messagesJson = await runCli(["state", "messages", "kisab-main", "--json", "--db", dbPath]);
    const records = JSON.parse(messagesJson.stdout) as unknown[];
    expect(records).toHaveLength(1);

    const pairState = await runCli(["state", "pair", "kisab-main", "--db", dbPath]);
    expect(pairState.status).toBe(0);
    expect(pairState.stdout).toContain("Last worker \u2192 planner:");
    expect(pairState.stdout).toContain("msg_assistant");
    expect(pairState.stdout).toContain("Pending ambiguous attempts: 0");

    const messages = await runCli(["state", "messages", "kisab-main", "--db", dbPath]);
    expect(messages.status).toBe(0);
    expect(messages.stdout).toContain("worker-to-planner");
    expect(messages.stdout).toContain("DELIVERED");
  }, 30_000);

  it("suppresses duplicates across fresh CLI process invocations (restart persistence)", async () => {
    await startOpenCodeServer();
    const { configPath, dbPath } = await fixture();

    const first = await runCli([
      "relay",
      "worker-to-planner",
      "kisab-main",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);
    expect(first.stdout).toContain("DELIVERED");

    const afterDelivery = await runCli(["state", "messages", "kisab-main", "--json", "--db", dbPath]);
    expect(JSON.parse(afterDelivery.stdout)).toHaveLength(1);

    const third = await runCli([
      "relay",
      "worker-to-planner",
      "kisab-main",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);
    expect(third.stdout).toContain("SKIPPED_DUPLICATE");

    const final = await runCli(["state", "messages", "kisab-main", "--json", "--db", dbPath]);
    expect(JSON.parse(final.stdout)).toHaveLength(1);
  }, 30_000);

  it("--force bypasses duplicate suppression and records a new attempt", async () => {
    await startOpenCodeServer();
    const { configPath, dbPath } = await fixture();

    await runCli([
      "relay",
      "worker-to-planner",
      "kisab-main",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);

    const forced = await runCli([
      "relay",
      "worker-to-planner",
      "kisab-main",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath,
      "--force"
    ]);

    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain("[force] Duplicate suppression bypassed");
    expect(forced.stdout).toContain("DELIVERED");

    const after = await runCli(["state", "messages", "kisab-main", "--json", "--db", dbPath]);
    const records = JSON.parse(after.stdout) as Array<{ attemptCount: number }>;
    expect(records).toHaveLength(1);
    expect(records[0]?.attemptCount).toBeGreaterThan(1);
  }, 30_000);

  it("initializes state and reports inspect output", async () => {
    const { dbPath } = await fixture();
    const init = await runCli(["state", "init", "--db", dbPath]);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain("Relay state initialized");

    const inspect = await runCli(["state", "inspect", "--db", dbPath]);
    expect(inspect.status).toBe(0);
    expect(inspect.stdout).toContain("Relay state database");
  }, 30_000);
});

async function startOpenCodeServer(): Promise<void> {
  server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    res.setHeader("content-type", "application/json");

    if (path === "/doc") {
      return respond(res, {
        paths: { "/api/health": {}, "/api/session": {}, "/api/session/{sessionID}": {}, "/api/session/active": {} }
      });
    }
    if (path === "/api/health") {
      return respond(res, { status: "ok" });
    }
    if (path === "/api/session/ses_worker_1") {
      return respond(res, {
        data: { id: "ses_worker_1", location: { project: { canonical: "/Users/lazydeepak/dev/kisab" } } }
      });
    }
    if (path === "/api/session/active") {
      return respond(res, { data: {} });
    }
    if (path === "/api/session/ses_worker_1/message") {
      return respond(res, {
        data: [
          { id: "msg_user", role: "user", text: "Build it" },
          { id: "msg_assistant", role: "assistant", content: [{ type: "text", text: "Build the next slice" }] }
        ]
      });
    }
    return respond(res, { error: "not found" }, 404);
  });

  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const address = server?.address();
  if (address && typeof address !== "string") {
    serverPort = address.port;
  }
}

function respond(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function url(): string {
  return `http://127.0.0.1:${serverPort}`;
}

async function fixture(): Promise<{ configPath: string; dbPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-cli-persist-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  await writeFile(
    configPath,
    JSON.stringify({
      pairs: [
        makePair({
          worker: {
            type: "opencode",
            sessionId: "ses_worker_1",
            repoPath: "/Users/lazydeepak/dev/kisab"
          }
        })
      ]
    }),
    "utf8"
  );
  const dbPath = join(directory, "agent-relay.sqlite");
  return { configPath, dbPath };
}

function runCli(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ status: code, stdout, stderr });
    });
  });
}
