/**
 * Agent codebase — module explanation / info.
 * File: src/application/opencode-desktop.ts
 * Purpose: Rule 5 step 5 — OpenCode Desktop process control for approved recovery.
 *
 * Terminates ONLY the OpenCode desktop app by exact image name and relaunches it.
 * This path runs only when no other active pair has a responding Worker (checked by
 * the caller); it never kills the shared server when a healthy worker depends on it.
 */
import { platform } from "node:process";

export type ExecFileFn = (file: string, args: string[]) => Promise<unknown>;

const defaultExec: ExecFileFn = async (file, args) => {
  // Lazy import so merely loading this module never touches child_process.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(file, args);
};

export interface OpenCodeDesktopControl {
  terminateOpenCodeDesktop: () => Promise<void>;
  relaunchOpenCodeDesktop: () => Promise<void>;
}

export function createOpenCodeDesktopControl(exec: ExecFileFn = defaultExec): OpenCodeDesktopControl {
  const isDarwin = platform === "darwin";
  const isLinux = platform === "linux";
  const isWin32 = platform === "win32";

  async function terminate(): Promise<void> {
    try {
      if (isDarwin) {
        // Exact app executable name — matches the OpenCode desktop app, not `opencode serve`.
        await exec("pkill", ["-x", "OpenCode"]);
        return;
      }
      if (isLinux) {
        // Exact image name — matches the Linux desktop binary.
        await exec("pkill", ["-x", "opencode"]);
        return;
      }
      if (isWin32) {
        await exec("taskkill", ["/F", "/IM", "OpenCode.exe"]);
        return;
      }
      throw new Error(`Unsupported platform "${platform}" for OpenCode Desktop management.`);
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      // pkill exits 1 when no process matched (already gone) — treat as success.
      if (code === 1 || code === 128) {
        return;
      }
      throw error;
    }
  }

  async function relaunch(): Promise<void> {
    if (isDarwin) {
      await exec("open", ["-a", "OpenCode"]);
      return;
    }
    if (isLinux) {
      // Detach so the desktop app outlives the supervisor process.
      await exec("sh", ["-c", "nohup opencode >/dev/null 2>&1 &"]);
      return;
    }
    if (isWin32) {
      await exec("cmd", ["/c", "start", "", "OpenCode"]);
      return;
    }
    throw new Error(`Unsupported platform "${platform}" for OpenCode Desktop management.`);
  }

  return { terminateOpenCodeDesktop: terminate, relaunchOpenCodeDesktop: relaunch };
}
