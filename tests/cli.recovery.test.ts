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

describe("recovery CLI", () => {
  it("rejects an invalid --recovery policy", async () => {
    const { dbPath } = await fixture();
    const result = await runCli(["supervise", "kisab-main", "--watch", "--recovery", "bogus", "--db", dbPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--recovery must be one of: none, safe.");
  });

  it("requires a valid recovery subcommand and a pairId", async () => {
    const { dbPath } = await fixture();
    const invalid = await runCli(["recovery", "bounce", "kisab-main", "--db", dbPath]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Recovery command requires one of: status, retry.");

    const noPair = await runCli(["recovery", "status", "--db", dbPath]);
    expect(noPair.status).toBe(1);
    expect(noPair.stderr).toContain("Recovery command requires a pairId.");
  });

  it("reports when no recovery state has been recorded", async () => {
    const { configPath, dbPath } = await fixture();
    const result = await runCli(["recovery", "status", "kisab-main", "--config", configPath, "--db", dbPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No recovery state recorded");
  });

  it("runs a single recovery pass against a healthy pair", async () => {
    await startOpenCodeServer();
    const { configPath, dbPath } = await fixture();

    const result = await runCli([
      "recovery",
      "retry",
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
});

describe("browser CLI", () => {
  it("reports external ownership for a config without a CDP target", async () => {
    const { configPath, dbPath } = await fixture();
    const result = await runCli(["browser", "status", "kisab-main", "--config", configPath, "--db", dbPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ownership: external");
  });

  it("refuses to start an externally owned browser", async () => {
    const { configPath, dbPath } = await fixture();
    const result = await runCli(["browser", "start", "kisab-main", "--config", configPath, "--db", dbPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot start an externally owned browser");
  });

  it("requires a pairId", async () => {
    const { dbPath } = await fixture();
    const result = await runCli(["browser", "start", "--db", dbPath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Browser command requires a pairId.");
  });
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
        data: { "19871": { sessionID: "ses_worker_1", dir: "/Users/lazydeepak/dev/kisab" } }
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
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-recovery-cli-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  await writeFile(configPath, JSON.stringify({ pairs: [makePair()] }), "utf8");
  const dbPath = join(directory, "agent-relay.sqlite");
  return { configPath, dbPath };
}

function runCli(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ status: code, stdout, stderr });
    });
  });
}