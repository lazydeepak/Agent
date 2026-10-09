import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";

export interface ToolLaunchResult {
  ok: true;
  message: string;
  endpoint: string;
  alreadyRunning: boolean;
  /** True when the launched OpenCode server was started with `OPENCODE_SERVER_PASSWORD`. */
  secured?: boolean;
}

export interface ToolActionResult {
  ok: true;
  message: string;
}

export interface OpenCodeToolInput {
  repoPath: string;
  baseUrl: string;
}

export interface BrowserToolInput {
  cdpUrl: string;
}

export interface DesktopToolLauncher {
  startOpenCode(input: OpenCodeToolInput): Promise<ToolLaunchResult>;
  stopOpenCode(): Promise<void>;
  updateOpenCode(): Promise<ToolActionResult>;
  startBrowser(input: BrowserToolInput): Promise<ToolLaunchResult>;
  shutdown(): Promise<void>;
}

export class DesktopToolError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DesktopToolError";
    this.code = code;
    this.details = details;
  }
}

export class LocalDesktopToolLauncher implements DesktopToolLauncher {
  // Shared across launcher instances: publish before any await/check/spawn.
  private static readonly openCodeStarts = new Map<string, Promise<ToolLaunchResult>>();
  private openCode: { child: ChildProcess; repoPath: string; endpoint: string } | undefined;
  private browser: { child: ChildProcess; endpoint: string } | undefined;
  private updater: ChildProcess | undefined;

  async startOpenCode(input: OpenCodeToolInput): Promise<ToolLaunchResult> {
    const endpoint = loopbackEndpoint(input.baseUrl, "OpenCode");
    const key = `${endpointHost(endpoint)}:${endpointPort(endpoint)}`;
    const pending = LocalDesktopToolLauncher.openCodeStarts.get(key);
    if (pending) return pending;
    const start = this.startOpenCodeOnce(input, endpoint);
    LocalDesktopToolLauncher.openCodeStarts.set(key, start);
    try {
      return await start;
    } finally {
      LocalDesktopToolLauncher.openCodeStarts.delete(key);
    }
  }

  private async startOpenCodeOnce(input: OpenCodeToolInput, endpoint: string): Promise<ToolLaunchResult> {
    const repoPath = input.repoPath.trim();
    if (!repoPath) throw new DesktopToolError("INVALID_INPUT", "Select an OpenCode session with a repository first.");
    try {
      if (!(await stat(repoPath)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new DesktopToolError("OPENCODE_REPO_NOT_FOUND", `The selected repository does not exist: ${repoPath}`);
    }

    if (await openCodeEndpointReachable(endpoint)) {
      return { ok: true, endpoint, alreadyRunning: true, message: `OpenCode is already reachable at ${endpoint}.` };
    }
    if (this.openCode) {
      await stopChild(this.openCode.child);
      this.openCode = undefined;
    }

    const executable = findOpenCodeExecutable();
    if (!executable) {
      throw new DesktopToolError(
        "OPENCODE_EXECUTABLE_NOT_FOUND",
        "Agent Relay could not find the OpenCode command.",
        { fallbackCommand: `opencode serve --hostname ${endpointHost(endpoint)} --port ${endpointPort(endpoint)}` }
      );
    }
    const child = spawn(executable, [
      "serve",
      "--hostname",
      endpointHost(endpoint),
      "--port",
      String(endpointPort(endpoint))
    ], { cwd: repoPath, stdio: "ignore", env: openCodeServerEnv() });
    this.openCode = { child, repoPath, endpoint };
    child.once("exit", () => {
      if (this.openCode?.child === child) this.openCode = undefined;
    });
    try {
      await waitForOpenCodeEndpoint(endpoint, child, 15_000);
    } catch (error) {
      await stopChild(child);
      if (this.openCode?.child === child) this.openCode = undefined;
      throw error;
    }
    return {
      ok: true,
      endpoint,
      alreadyRunning: false,
      secured: Boolean(resolveOpenCodeServerPassword()),
      message: `OpenCode server started for ${basename(repoPath)}.`
    };
  }

  async startBrowser(input: BrowserToolInput): Promise<ToolLaunchResult> {
    const endpoint = loopbackEndpoint(input.cdpUrl, "Chrome automation");
    if (await endpointReachable(`${endpoint}/json/version`)) {
      return { ok: true, endpoint, alreadyRunning: true, message: "Automation Chrome is already running." };
    }
    if (this.browser) {
      await stopChild(this.browser.child);
      this.browser = undefined;
    }
    const executable = findChromeExecutable();
    if (!executable) {
      throw new DesktopToolError("CHROME_EXECUTABLE_NOT_FOUND", "Agent Relay could not find Google Chrome.");
    }
    const profile = join(homedir(), ".agent-relay", "chrome-profile");
    await mkdir(profile, { recursive: true });
    const child = spawn(executable, [
      `--remote-debugging-address=${endpointHost(endpoint)}`,
      `--remote-debugging-port=${endpointPort(endpoint)}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "https://chatgpt.com/"
    ], { stdio: "ignore", env: process.env });
    this.browser = { child, endpoint };
    child.once("exit", () => {
      if (this.browser?.child === child) this.browser = undefined;
    });
    try {
      await waitForEndpoint(`${endpoint}/json/version`, child, 15_000);
    } catch (error) {
      await stopChild(child);
      if (this.browser?.child === child) this.browser = undefined;
      throw error;
    }
    return { ok: true, endpoint, alreadyRunning: false, message: "Automation Chrome launched. Sign in and open the conversation to pair." };
  }

  async updateOpenCode(): Promise<ToolActionResult> {
    const executable = findOpenCodeExecutable();
    if (!executable) {
      throw new DesktopToolError("OPENCODE_EXECUTABLE_NOT_FOUND", "Agent Relay could not find the OpenCode command.");
    }
    if (this.openCode) await this.stopOpenCode();
    let child = spawn(executable, ["upgrade"], { stdio: "ignore", env: process.env });
    this.updater = child;
    try {
      let exitCode = await waitForExit(child, 120_000);
      if (exitCode !== 0) {
        child = spawn(executable, ["update"], { stdio: "ignore", env: process.env });
        this.updater = child;
        exitCode = await waitForExit(child, 120_000);
      }
      if (exitCode !== 0) {
        throw new DesktopToolError("OPENCODE_UPDATE_FAILED", `OpenCode update exited with code ${exitCode}.`);
      }
      return { ok: true, message: "OpenCode command updated for version 2.0.22 compatibility. Start the OpenCode server again." };
    } finally {
      if (this.updater === child) this.updater = undefined;
    }
  }

  releaseOpenCode(): void {
    if (this.openCode) {
      this.openCode.child.unref();
      this.openCode = undefined;
    }
  }

  async stopOpenCode(): Promise<void> {
    const child = this.openCode?.child;
    this.openCode = undefined;
    if (child) await stopChild(child);
  }

  async shutdown(): Promise<void> {
    const children = [this.openCode?.child, this.browser?.child, this.updater].filter((child): child is ChildProcess => Boolean(child));
    this.openCode = undefined;
    this.browser = undefined;
    this.updater = undefined;
    await Promise.all(children.map(stopChild));
  }
}

/**
 * Resolves the password used to secure a locally launched OpenCode server. Both names are read:
 * `AGENT_RELAY_OPENCODE_PASSWORD` is the Agent Relay spelling, `OPENCODE_SERVER_PASSWORD` is the
 * variable OpenCode itself checks (and therefore the one commonly set in `.env`).
 */
function resolveOpenCodeServerPassword(): string | undefined {
  const relay = process.env.AGENT_RELAY_OPENCODE_PASSWORD?.trim();
  if (relay) return relay;
  const opencode = process.env.OPENCODE_SERVER_PASSWORD?.trim();
  return opencode ? opencode : undefined;
}

/**
 * Environment for a spawned `opencode serve`. When a password is configured it is passed
 * explicitly so the server never starts unsecured just because the launcher was started from a
 * shell that had not sourced `.env`.
 */
function openCodeServerEnv(): NodeJS.ProcessEnv {
  const password = resolveOpenCodeServerPassword();
  return password ? { ...process.env, OPENCODE_SERVER_PASSWORD: password } : { ...process.env };
}

function loopbackEndpoint(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DesktopToolError("INVALID_ENDPOINT", `${label} endpoint must be a valid HTTP URL.`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || !url.port) {
    throw new DesktopToolError("INVALID_ENDPOINT", `${label} can only be launched on a loopback HTTP endpoint with an explicit port.`);
  }
  return `${url.protocol}//${url.host}`;
}

function endpointHost(endpoint: string): string {
  const hostname = new URL(endpoint).hostname;
  return hostname === "localhost" ? "127.0.0.1" : hostname;
}

function endpointPort(endpoint: string): number {
  return Number(new URL(endpoint).port);
}

function findOpenCodeExecutable(): string | undefined {
  const configured = process.env.AGENT_RELAY_OPENCODE_EXECUTABLE;
  const names = process.platform === "win32" ? ["opencode.exe"] : ["opencode"];
  const pathCandidates = (process.env.PATH ?? "").split(delimiter).flatMap((directory) =>
    names.map((name) => join(directory, name))
  );

  // Common macOS and Linux installation directories for Homebrew (Apple Silicon + Intel), npm, curl, and XDG local bins
  const wellKnownCandidates = [
    "/opt/homebrew/bin/opencode", // macOS Apple Silicon Homebrew
    "/usr/local/bin/opencode",   // macOS Intel Homebrew / global npm
    join(homedir(), ".local", "bin", "opencode"),
    join(homedir(), ".opencode", "bin", "opencode")
  ];

  const candidates = [
    configured,
    ...pathCandidates,
    ...wellKnownCandidates,
    ...names.map((name) => join(homedir(), ".opencode", "bin", name))
  ];

  return candidates.find((candidate): candidate is string => {
    if (!candidate || !existsSync(candidate)) return false;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function findChromeExecutable(): string | undefined {
  const configured = process.env.AGENT_RELAY_CHROME_EXECUTABLE;
  const candidates = process.platform === "darwin"
    ? [configured, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
      ? [configured, process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : undefined]
      : [configured, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

async function endpointReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * OpenCode 2.0.22 serves its primary health check at /api/health.
 * Fall back to /global/health and /doc to accommodate different OpenCode server configurations.
 */
async function openCodeEndpointReachable(endpoint: string): Promise<boolean> {
  const normalized = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  const probeUrls = [
    `${normalized}/api/health`,
    `${normalized}/global/health`,
    `${normalized}/doc`,
    `${normalized}/`
  ];
  for (const url of probeUrls) {
    if (await endpointReachable(url)) {
      return true;
    }
  }
  return false;
}

async function waitForOpenCodeEndpoint(endpoint: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new DesktopToolError("TOOL_START_FAILED", "The managed process exited before its endpoint became ready.");
    }
    if (await openCodeEndpointReachable(endpoint)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new DesktopToolError("TOOL_START_TIMEOUT", `Timed out waiting for OpenCode at ${endpoint}.`);
}

async function waitForEndpoint(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new DesktopToolError("TOOL_START_FAILED", "The managed process exited before its endpoint became ready.");
    }
    if (await endpointReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new DesktopToolError("TOOL_START_TIMEOUT", `Timed out waiting for ${url}.`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new DesktopToolError("TOOL_START_TIMEOUT", "Timed out waiting for the OpenCode update."));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}
