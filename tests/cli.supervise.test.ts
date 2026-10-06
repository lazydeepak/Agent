import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
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

describe("supervise CLI", () => {
  it("observes a pair once and prints its deterministic state", async () => {
    await startOpenCodeServer();
    const { configPath, dbPath } = await fixture();

    const result = await runCli([
      "supervise",
      "kisab-main",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("kisab-main  WORKING");
  }, 30_000);

  it("prints a JSON report for a one-shot supervise", async () => {
    await startOpenCodeServer();
    const { configPath, dbPath } = await fixture();

    const result = await runCli([
      "supervise",
      "kisab-main",
      "--once",
      "--json",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { pairId: string; state: string };
    expect(report.pairId).toBe("kisab-main");
    expect(report.state).toBe("WORKING");
  }, 30_000);

  it("watch --relay delivers a worker report once and stops cleanly on SIGTERM", async () => {
    await startOpenCodeServer();
    const { configPath, dbPath } = await fixture();
    const { child, output, finished } = spawnCli([
      "supervise",
      "kisab-main",
      "--watch",
      "--relay",
      "--poll-interval",
      "100",
      "--config",
      configPath,
      "--opencode-url",
      url(),
      "--db",
      dbPath
    ]);

    try {
      await waitForOutput(output, (stdout) => stdout.includes("relay  worker-to-planner  DELIVERED"), 30_000);
      child.kill("SIGTERM");
      const result = await finished;
      expect(result.status).toBe(0);
      expect(output.stdout).toContain("relay  worker-to-planner  DELIVERED");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
  }, 40_000);
});

describe("supervisor CLI", () => {
  it("pauses, reports status, and resumes a pair", async () => {
    const { dbPath } = await fixture();

    const paused = await runCli(["supervisor", "pause", "kisab-main", "--db", dbPath]);
    expect(paused.status).toBe(0);
    expect(paused.stdout).toContain("Paused supervision for kisab-main.");

    const statusPaused = await runCli(["supervisor", "status", "kisab-main", "--db", dbPath]);
    expect(statusPaused.stdout).toContain("paused: true");

    const resumed = await runCli(["supervisor", "resume", "kisab-main", "--db", dbPath]);
    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toContain("Resumed supervision for kisab-main.");

    const statusResumed = await runCli(["supervisor", "status", "kisab-main", "--db", dbPath]);
    expect(statusResumed.stdout).toContain("paused: false");
  }, 30_000);

  it("reports that no supervisor state exists for an untouched pair", async () => {
    const { dbPath } = await fixture();
    const result = await runCli(["supervisor", "status", "kisab-main", "--db", dbPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No supervisor state recorded");
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
      return respond(res, {
        data: {
          "19871": { sessionID: "ses_worker_1", type: "idle", dir: "/Users/lazydeepak/dev/kisab" }
        }
      });
    }
    if (path === "/api/session/ses_worker_1/message") {
      return respond(res, {
        data: [
          { id: "req-2", role: "user", text: "Build it" },
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
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-supervise-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  await writeFile(configPath, JSON.stringify({ pairs: [makePair()] }), "utf8");
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
  throw new Error(`Timed out waiting for supervise output. Got:\n${output.stdout}`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
