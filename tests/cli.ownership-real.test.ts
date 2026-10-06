import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];
const spawned: ChildProcess[] = [];
const transferredPids: number[] = [];
const ROOT = process.cwd();

afterEach(async () => {
  for (const proc of spawned.splice(0)) {
    try { proc.kill("SIGKILL"); } catch {}
  }
  for (const pid of transferredPids.splice(0)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    try { await rm(path, { force: true, recursive: true }); } catch {}
  }));
});

const FIXTURE_SESSION_ID = "ses_real_fixture";

/**
 * Writes a CJS extensionless Node script named "serve" at <repoPath>/serve.
 * Parses `serve --hostname <host> --port <port>` (matching the launcher's
 * spawn(executable, ["serve", "--hostname", host, "--port", port])).
 * Serves the OpenCode v2 adapter protocol for the given session.
 */
function writeServeScript(repoPath: string, sessionId: string): string {
  const scriptPath = join(repoPath, "serve");
  const script = `var http = require("node:http");
var fs = require("node:fs");

var sessionId = ${JSON.stringify(sessionId)};
var repoPath = ${JSON.stringify(repoPath)};
var pidFile = process.env.AGENT_RELAY_TEST_PID_FILE;
var sessionRequestMarker = process.env.AGENT_RELAY_TEST_SESSION_REQUEST_MARKER;
var sessionResponseDelayMs = parseInt(process.env.AGENT_RELAY_TEST_SESSION_DELAY_MS || "0", 10);

if (pidFile) {
  fs.writeFileSync(pidFile, String(process.pid));
}

var args = process.argv.slice(2);
var parse = function (flag) {
  var i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
var port = parseInt(parse("--port") || "0", 10);
var host = parse("--hostname") || "127.0.0.1";

var server = http.createServer(function (req, res) {
  var url = req.url || "";
  var path = new URL(url, "http://localhost").pathname;
  var respond = function (code, body) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path === "/doc") {
    respond(200, { paths: { "/api/health": {}, "/api/session": {}, "/api/session/active": {}, "/api/session/{sessionID}/message": {} } });
  } else if (path === "/api/health") {
    respond(200, { status: "ok" });
  } else if (path === "/api/session/active") {
    respond(200, { data: { active: { [sessionId]: {} } } });
  } else if (path.indexOf("/api/session/") === 0 && path.endsWith("/message")) {
    respond(200, { data: [] });
  } else if (path.indexOf("/api/session/") === 0) {
    if (sessionRequestMarker) {
      fs.writeFileSync(sessionRequestMarker, url);
    }
    var respondWithSession = function () {
      respond(200, { data: { id: sessionId, directory: repoPath } });
    };
    if (sessionResponseDelayMs > 0) {
      setTimeout(respondWithSession, sessionResponseDelayMs);
    } else {
      respondWithSession();
    }
  } else {
    respond(404, {});
  }
});

server.listen(port, host, function () {
  var actual = server.address();
  if (port === 0 && actual) {
    process.stdout.write(String(actual.port));
  }
});

function shutdown() {
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 500);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`;
  writeFileSync(scriptPath, script, "utf8");
  return scriptPath;
}

async function makeFixtureRepo(sessionId: string): Promise<{ repoDir: string; repoPath: string; fixturePath: string }> {
  const repoDir = await mkdtemp(join(tmpdir(), "agent-relay-repo-"));
  tempDirs.push(repoDir);
  const repoPath = join(repoDir, "repo");
  mkdirSync(repoPath, { recursive: true });
  const fixturePath = writeServeScript(repoPath, sessionId);
  return { repoDir, repoPath, fixturePath };
}

function allocatePort(): Promise<number> {
  const net = require("node:net") as typeof import("node:net");
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForReachable(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fixture on port ${port} did not become reachable within ${timeoutMs}ms`);
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fixture did not create ${path} within ${timeoutMs}ms`);
}

function isReachable(port: number): boolean {
  const r = spawnSync(
    process.execPath,
    ["-e", `fetch("http://127.0.0.1:${port}/api/health").then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})`],
    { encoding: "utf8", timeout: 3_000 }
  );
  return r.status === 0;
}

function spawnCliAsync(args: string[], env?: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

interface CollectedOutput {
  getStdout(): string;
  getStderr(): string;
  promise: Promise<number | null>;
}

/** Collects stdout/stderr by mutating an object — avoids the stale-reference
 *  bug where `let stdout = ""; proc.on("data", c => stdout += ...)` reassigns
 *  the local but the caller still holds the original "". */
function collectOutput(proc: ChildProcess): CollectedOutput {
  const state = { stdout: "", stderr: "" };
  proc.stdout?.on("data", (c: Buffer) => { state.stdout += c.toString(); });
  proc.stderr?.on("data", (c: Buffer) => { state.stderr += c.toString(); });
  const promise = new Promise<number | null>((resolve) => {
    proc.on("exit", (code) => resolve(code));
    proc.on("error", () => resolve(null));
  });
  return {
    getStdout: () => state.stdout,
    getStderr: () => state.stderr,
    promise,
  };
}

function makePairConfig(sessionId: string, repoPath: string, baseUrl: string) {
  return {
    pairId: "kisab-main",
    enabled: true,
    worker: { type: "opencode" as const, sessionId, repoPath, server: { baseUrl } },
    planner: { type: "chatgpt-browser" as const, conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" }
  };
}

describe("real-process CLI ownership", () => {
  it("recovery retry starts fixture via launcher, transfers ownership, fixture survives CLI exit", async () => {
    const { repoDir, repoPath } = await makeFixtureRepo(FIXTURE_SESSION_ID);
    const configPath = join(repoDir, "pairs.json");
    const dbPath = join(repoDir, "agent-relay.sqlite");
    const pidPath = join(repoDir, "fixture.pid");
    const port = await allocatePort();
    const pair = makePairConfig(FIXTURE_SESSION_ID, repoPath, `http://127.0.0.1:${port}`);
    await writeFile(configPath, JSON.stringify({ pairs: [pair] }), "utf8");

    // The endpoint is unreachable — recovery must start the fixture via the launcher.
    expect(isReachable(port)).toBe(false);

    const cli = spawnCliAsync(
      ["recovery", "retry", "kisab-main", "--json", "--recovery", "safe", "--config", configPath, "--db", dbPath],
      { AGENT_RELAY_OPENCODE_EXECUTABLE: process.execPath, AGENT_RELAY_TEST_PID_FILE: pidPath }
    );
    const output = collectOutput(cli);
    const code = await output.promise;

    // Parse the structured JSON report from stdout.
    const stdout = output.getStdout();
    const jsonLine = stdout.trim().split("\n").find((l) => l.startsWith("{"));
    expect(jsonLine).toBeDefined();
    const report = JSON.parse(jsonLine!);
    expect(report.recovery).not.toBeNull();
    expect(report.recovery.recovered).toBe(true);
    expect(code).toBe(0);
    await waitForFile(pidPath, 5_000);
    transferredPids.push(Number(await readFile(pidPath, "utf8")));

    // Successful one-shot recovery calls releaseOpenCode() → child.unref(),
    // so the fixture survives the CLI's exit.
    expect(isReachable(port)).toBe(true);
  }, 30_000);

  it("recovery retry with --recovery none connects to existing fixture, never spawns or kills it", async () => {
    const { repoDir, repoPath, fixturePath } = await makeFixtureRepo(FIXTURE_SESSION_ID);
    const configPath = join(repoDir, "pairs.json");
    const dbPath = join(repoDir, "agent-relay.sqlite");
    const port = await allocatePort();
    const pair = makePairConfig(FIXTURE_SESSION_ID, repoPath, `http://127.0.0.1:${port}`);
    await writeFile(configPath, JSON.stringify({ pairs: [pair] }), "utf8");

    // Pre-start the fixture so the endpoint is reachable.
    const fixtureProc = spawn(process.execPath, [fixturePath, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: repoPath,
      stdio: "ignore",
    });
    spawned.push(fixtureProc);
    await waitForReachable(port, 10_000);

    const cli = spawnCliAsync(
      ["recovery", "retry", "kisab-main", "--json", "--recovery", "none", "--config", configPath, "--db", dbPath],
      { AGENT_RELAY_OPENCODE_EXECUTABLE: process.execPath }
    );
    const output = collectOutput(cli);
    const code = await output.promise;
    expect(code).toBe(0);

    // With --recovery none there is no launcher; the fixture is never owned or killed.
    expect(isReachable(port)).toBe(true);
  }, 30_000);

  it("failed recovery retains ownership and stops the launcher-started fixture", async () => {
    const { repoDir, repoPath } = await makeFixtureRepo("different-session");
    const configPath = join(repoDir, "pairs.json");
    const dbPath = join(repoDir, "agent-relay.sqlite");
    const port = await allocatePort();
    const pair = makePairConfig(FIXTURE_SESSION_ID, repoPath, `http://127.0.0.1:${port}`);
    await writeFile(configPath, JSON.stringify({ pairs: [pair] }), "utf8");

    expect(isReachable(port)).toBe(false);
    const cli = spawnCliAsync(
      ["recovery", "retry", "kisab-main", "--json", "--recovery", "safe", "--config", configPath, "--db", dbPath],
      { AGENT_RELAY_OPENCODE_EXECUTABLE: process.execPath }
    );
    const output = collectOutput(cli);
    const code = await output.promise;

    expect(code).toBe(1);
    const jsonLine = output.getStdout().trim().split("\n").find((line) => line.startsWith("{"));
    expect(jsonLine).toBeDefined();
    const report = JSON.parse(jsonLine!);
    expect(report.recovery).toMatchObject({ recovered: false, intervention: true });
    await waitForUnreachable(port, 5_000);
  }, 30_000);

  it("runtime start starts fixture via launcher, SIGINT shuts down and kills it", async () => {
    const { repoDir, repoPath } = await makeFixtureRepo(FIXTURE_SESSION_ID);
    const configPath = join(repoDir, "pairs.json");
    const dbPath = join(repoDir, "agent-relay.sqlite");
    const port = await allocatePort();
    const pair = makePairConfig(FIXTURE_SESSION_ID, repoPath, `http://127.0.0.1:${port}`);
    await writeFile(configPath, JSON.stringify({ pairs: [pair] }), "utf8");

    // Endpoint unreachable → recovery starts the fixture.
    expect(isReachable(port)).toBe(false);

    const cli = spawnCliAsync(
      [
        "runtime", "start", "--all",
        "--poll-interval", "500",
        "--recovery", "safe",
        "--config", configPath,
        "--db", dbPath,
      ],
      { AGENT_RELAY_OPENCODE_EXECUTABLE: process.execPath }
    );

    // Wait until the fixture becomes reachable (launcher started it).
    await waitForReachable(port, 15_000);

    // SIGINT triggers shutdown → orchestrator.shutdown() + launcher.shutdown().
    cli.kill("SIGINT");
    const code = await new Promise<number | null>((resolve) => cli.on("exit", resolve));

    // During recovery, shutdown() sees status.failed > 0 (transient failure) → exit 1.
    // After recovery, it would be 0. Either way the cleanup path fires.
    expect([0, 1]).toContain(code);

    // The launcher shutdown kills the fixture.
    await waitForUnreachable(port, 5_000);
    expect(isReachable(port)).toBe(false);
  }, 30_000);

  it("runtime start exits when SIGINT interrupts the initial observation", async () => {
    const { repoDir, repoPath } = await makeFixtureRepo(FIXTURE_SESSION_ID);
    const configPath = join(repoDir, "pairs.json");
    const dbPath = join(repoDir, "agent-relay.sqlite");
    const markerPath = join(repoDir, "session-requested");
    const port = await allocatePort();
    const pair = makePairConfig(FIXTURE_SESSION_ID, repoPath, `http://127.0.0.1:${port}`);
    await writeFile(configPath, JSON.stringify({ pairs: [pair] }), "utf8");

    const cli = spawnCliAsync(
      [
        "runtime", "start", "--all",
        "--poll-interval", "500",
        "--recovery", "safe",
        "--config", configPath,
        "--db", dbPath,
      ],
      {
        AGENT_RELAY_OPENCODE_EXECUTABLE: process.execPath,
        AGENT_RELAY_TEST_SESSION_REQUEST_MARKER: markerPath,
        AGENT_RELAY_TEST_SESSION_DELAY_MS: "10000",
      }
    );
    const output = collectOutput(cli);

    // The exact-session request is inside the first observation. Holding its
    // response makes the signal timing deterministic rather than probabilistic.
    await waitForFile(markerPath, 15_000);
    cli.kill("SIGINT");
    const code = await Promise.race([
      output.promise,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("runtime start did not exit after SIGINT")), 5_000)
      ),
    ]);

    expect(code).toBe(0);
    expect(output.getStderr()).not.toContain("unsettled top-level await");
    await waitForUnreachable(port, 5_000);
  }, 30_000);

  it("supervise --watch starts fixture via launcher, SIGINT shuts down and kills it", async () => {
    const { repoDir, repoPath } = await makeFixtureRepo(FIXTURE_SESSION_ID);
    const configPath = join(repoDir, "pairs.json");
    const dbPath = join(repoDir, "agent-relay.sqlite");
    const port = await allocatePort();
    const pair = makePairConfig(FIXTURE_SESSION_ID, repoPath, `http://127.0.0.1:${port}`);
    await writeFile(configPath, JSON.stringify({ pairs: [pair] }), "utf8");

    // Endpoint unreachable → recovery starts the fixture.
    expect(isReachable(port)).toBe(false);

    const cli = spawnCliAsync(
      [
        "supervise", "kisab-main", "--watch",
        "--poll-interval", "500",
        "--recovery", "safe",
        "--config", configPath,
        "--db", dbPath,
      ],
      { AGENT_RELAY_OPENCODE_EXECUTABLE: process.execPath }
    );

    // Wait until the fixture becomes reachable.
    await waitForReachable(port, 15_000);

    cli.kill("SIGINT");
    const code = await new Promise<number | null>((resolve) => cli.on("exit", resolve));
    expect(code).toBe(0);

    // SIGINT → stop() → supervisor.stop() + launcher.shutdown() → kills the fixture.
    await waitForUnreachable(port, 5_000);
    expect(isReachable(port)).toBe(false);
  }, 30_000);
});

async function waitForUnreachable(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isReachable(port)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fixture on port ${port} remained reachable after ${timeoutMs}ms`);
}
