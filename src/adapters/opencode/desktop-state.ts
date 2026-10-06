import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_STATE_FILE_BYTES = 10 * 1024 * 1024;
const SESSION_ROUTE = /\/session\/(ses_[A-Za-z0-9_-]+)/;

export interface OpenCodeDesktopSession {
  sessionId: string;
  title?: string;
  repoPath?: string;
}

export interface OpenCodeDesktopScanOptions {
  stateDirectories?: string[];
  isRunning?: () => Promise<boolean>;
}

export class OpenCodeDesktopStateError extends Error {
  readonly code: "OPENCODE_DESKTOP_NOT_RUNNING" | "OPENCODE_DESKTOP_SESSION_NOT_FOUND";

  constructor(code: OpenCodeDesktopStateError["code"], message: string) {
    super(message);
    this.name = "OpenCodeDesktopStateError";
    this.code = code;
  }
}

/** Reads OpenCode's persisted recent-tab pointer. It never opens its session database or sidecar credentials. */
export async function scanOpenCodeDesktopActiveSession(
  options: OpenCodeDesktopScanOptions = {}
): Promise<OpenCodeDesktopSession> {
  const running = await (options.isRunning ?? isOpenCodeDesktopRunning)();
  if (!running) {
    throw new OpenCodeDesktopStateError(
      "OPENCODE_DESKTOP_NOT_RUNNING",
      "OpenCode Desktop is not running. Open the desired session there, then scan again."
    );
  }

  const candidates: Array<{ path: string; modifiedAt: number }> = [];
  for (const directory of options.stateDirectories ?? openCodeDesktopStateDirectories()) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("opencode.window.") || !name.endsWith(".dat")) continue;
      const path = join(directory, name);
      try {
        const details = await stat(path);
        if (details.isFile() && details.size <= MAX_STATE_FILE_BYTES) {
          candidates.push({ path, modifiedAt: details.mtimeMs });
        }
      } catch {
        // A window may close while its state is being enumerated.
      }
    }
  }

  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate.path, "utf8")) as unknown;
      const session = parseOpenCodeDesktopWindowState(parsed);
      if (session) return session;
    } catch {
      // Ignore incomplete or incompatible state files and continue to older windows.
    }
  }

  throw new OpenCodeDesktopStateError(
    "OPENCODE_DESKTOP_SESSION_NOT_FOUND",
    "No active OpenCode Desktop session was found. Select a session tab in OpenCode Desktop, then scan again."
  );
}

export function parseOpenCodeDesktopWindowState(value: unknown): OpenCodeDesktopSession | undefined {
  const state = asRecord(value);
  const recent = parseStoredRecord(state?.["tabs.recent"]);
  const key = typeof recent?.key === "string" ? recent.key : undefined;
  if (!key) return undefined;

  const match = SESSION_ROUTE.exec(key);
  const sessionId = match?.[1];
  if (!sessionId) return undefined;

  const info = parseStoredRecord(state?.["tabs.info"]);
  const metadata = asRecord(info?.[key]);
  return {
    sessionId,
    ...(typeof metadata?.title === "string" && metadata.title ? { title: metadata.title } : {}),
    ...(typeof metadata?.directory === "string" && metadata.directory ? { repoPath: metadata.directory } : {})
  };
}

export function openCodeDesktopStateDirectories(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string[] {
  const appData =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : platform === "win32"
        ? environment.APPDATA
        : environment.XDG_CONFIG_HOME ?? join(home, ".config");
  if (!appData) return [];
  return ["ai.opencode.desktop", "ai.opencode.desktop.beta", "ai.opencode.desktop.dev"].map((name) =>
    join(appData, name)
  );
}

async function isOpenCodeDesktopRunning(): Promise<boolean> {
  const command = process.platform === "win32" ? "tasklist" : "ps";
  const args = process.platform === "win32" ? ["/fo", "csv", "/nh"] : ["-ax", "-o", "command="];
  try {
    const output = await execFileText(command, args);
    return /(?:OpenCode\.app\/Contents\/|ai\.opencode\.desktop|opencode-desktop)/i.test(output);
  } catch {
    return false;
  }
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function parseStoredRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return asRecord(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
