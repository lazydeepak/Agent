import { app, safeStorage } from "electron";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { join } from "node:path";
import { credentialsAllowed } from "../../src/util/net.js";
import { saveOpenCodeEndpoint } from "./endpoint-settings.js";

const execFileAsync = promisify(execFile);
const CREDENTIALS_FILE = "opencode-credentials.json";

interface StoredCredentials {
  username: string;
  encryptedPassword: string;
  baseUrl?: string;
}

/** Restore credentials into the main-process environment for existing core adapters. */
export function restoreOpenCodeCredentials(): boolean {
  const path = join(app.getPath("userData"), CREDENTIALS_FILE);
  if (!existsSync(path)) return false;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable.");
  }
  const stored = JSON.parse(readFileSync(path, "utf8")) as StoredCredentials;
  if (typeof stored.username !== "string" || typeof stored.encryptedPassword !== "string") {
    throw new Error("Stored OpenCode credentials are invalid.");
  }
  if (!process.env.AGENT_OPENCODE_USERNAME) process.env.AGENT_OPENCODE_USERNAME = stored.username;
  const password = safeStorage.decryptString(Buffer.from(stored.encryptedPassword, "base64"));
  if (!process.env.AGENT_OPENCODE_PASSWORD && !process.env.OPENCODE_SERVER_PASSWORD) {
    process.env.AGENT_OPENCODE_PASSWORD = password;
    process.env.OPENCODE_SERVER_PASSWORD = password;
  }
  if (!process.env.AGENT_OPENCODE_BASE_URL && stored.baseUrl) {
    process.env.AGENT_OPENCODE_BASE_URL = stored.baseUrl;
  }
  return true;
}

/** Native macOS prompts keep the password out of the app renderer and command arguments. */
export async function promptAndStoreOpenCodeCredentials(
  defaultEndpoint: string
): Promise<{ saved: boolean; username?: string; endpoint?: string }> {
  if (process.platform !== "darwin") {
    throw new Error("Secure OpenCode credential setup is currently available on macOS only.");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("macOS Keychain-backed secure storage is unavailable.");
  }

  const enteredEndpoint = await promptText([
    "-e",
    `text returned of (display dialog "OpenCode server URL" default answer "${escapeAppleScript(defaultEndpoint)}" buttons {"Cancel", "Continue"} default button "Continue")`
  ]);
  if (enteredEndpoint === undefined) return { saved: false };
  const endpoint = enteredEndpoint.trim();
  const username = await promptText(
    [
      "-e",
      'text returned of (display dialog "OpenCode username" default answer "opencode" buttons {"Cancel", "Continue"} default button "Continue")'
    ]
  );
  if (username === undefined) return { saved: false };
  const normalizedUsername = username.trim();
  if (!normalizedUsername) throw new Error("OpenCode username cannot be empty.");

  const password = await promptText(
    [
      "-e",
      'text returned of (display dialog "OpenCode server password" default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save")'
    ]
  );
  if (password === undefined) return { saved: false };
  if (!password) throw new Error("OpenCode password cannot be empty.");

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("The configured OpenCode endpoint is invalid.");
  }
  if (!credentialsAllowed(parsedEndpoint.toString())) {
    throw new Error("Credentials will not be sent to a non-loopback HTTP OpenCode endpoint. Use HTTPS or a loopback URL.");
  }
  const authorization = `Basic ${Buffer.from(`${normalizedUsername}:${password}`).toString("base64")}`;
  let authenticated = false;
  for (const path of ["/api/session", "/session"]) {
    let response: Response;
    try {
      response = await fetch(new URL(path, parsedEndpoint), {
        headers: { authorization },
        signal: AbortSignal.timeout(5_000)
      });
    } catch {
      throw new Error(`Could not reach the OpenCode server at ${parsedEndpoint.origin}; credentials were not saved.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `OpenCode at ${parsedEndpoint.origin} rejected those credentials (HTTP ${response.status}). Check the username and password; credentials were not saved.`
      );
    }
    if (response.status === 404) continue;
    if (response.status >= 500) {
      throw new Error(`OpenCode returned HTTP ${response.status}; credentials were not saved.`);
    }
    authenticated = true;
    break;
  }
  if (!authenticated) {
    throw new Error("Could not verify credentials against an OpenCode session endpoint; credentials were not saved.");
  }

  const path = join(app.getPath("userData"), CREDENTIALS_FILE);
  const tempPath = `${path}.tmp`;
  const credentials: StoredCredentials = {
    username: normalizedUsername,
    encryptedPassword: safeStorage.encryptString(password).toString("base64"),
    baseUrl: parsedEndpoint.toString()
  };
  writeFileSync(tempPath, JSON.stringify(credentials), { mode: 0o600 });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, path);

  // The existing core and adapter APIs resolve credentials from the main process environment.
  process.env.AGENT_OPENCODE_USERNAME = normalizedUsername;
  process.env.AGENT_OPENCODE_PASSWORD = password;
  process.env.OPENCODE_SERVER_PASSWORD = password;
  process.env.AGENT_OPENCODE_BASE_URL = parsedEndpoint.toString();
  saveOpenCodeEndpoint(parsedEndpoint.toString());
  return { saved: true, username: normalizedUsername, endpoint: parsedEndpoint.toString() };
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function promptText(args: string[]): Promise<string | undefined> {
  try {
    return (await execFileAsync("osascript", args)).stdout.replace(/\r?\n$/, "");
  } catch (error) {
    const details = error as { stderr?: string };
    if (details.stderr?.includes("User canceled")) return undefined;
    throw new Error("Could not open the macOS credential prompt.");
  }
}
