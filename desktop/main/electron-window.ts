import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";

/**
 * Electron window helpers used by the IPC context and the dashboard window.
 * Kept out of index.ts so window policy (nav guards, sandboxed auth window) is one unit.
 */

export function installNavigationGuards(window: BrowserWindow, options: { allowHttpNavigation?: boolean } = {}): void {
  const allowHttpNavigation = options.allowHttpNavigation === true;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    let protocol: string;
    try {
      protocol = new URL(target).protocol;
    } catch {
      event.preventDefault();
      return;
    }
    const allowed = allowHttpNavigation
      ? protocol === "http:" || protocol === "https:"
      : protocol === "file:";
    if (!allowed) {
      event.preventDefault();
    }
  });
}

const activeAuthWindows = new Map<string, BrowserWindow>();

export async function openWorkerAuthWindowImpl(input: {
  url: string;
  title: string;
  origin: string;
  username?: string;
  secret?: string;
}): Promise<boolean> {
  // Key by the full destination so two worker sessions on one server do not
  // incorrectly reuse the first session’s window.
  const windowKey = input.url;
  const existing = activeAuthWindows.get(windowKey);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return true;
  }
  const authBrowser = new BrowserWindow({
    width: 1280,
    height: 720,
    show: true,
    title: input.title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `worker-session-auth-${randomUUID()}`
    }
  });
  installNavigationGuards(authBrowser, { allowHttpNavigation: true });
  const session = authBrowser.webContents.session;
  const injectAuth = (details: Electron.OnBeforeSendHeadersListenerDetails, callback: (response: Electron.BeforeSendResponse) => void): void => {
    const headers: Record<string, string> = { ...(details.requestHeaders ?? {}) };
    let sameOrigin = false;
    try {
      sameOrigin = new URL(details.url).origin === input.origin;
    } catch {
      // Ignore malformed/non-HTTP request URLs; no credential should be added.
    }
    if (sameOrigin) {
      headers["Authorization"] = `Basic ${Buffer.from(`${input.username ?? "opencode"}:${input.secret ?? ""}`).toString("base64")}`;
    }
    callback({ requestHeaders: headers });
  };
  session.webRequest.onBeforeSendHeaders(injectAuth);
  activeAuthWindows.set(windowKey, authBrowser);
  authBrowser.once("closed", () => {
    activeAuthWindows.delete(windowKey);
    session.webRequest.onBeforeSendHeaders(null);
  });
  try {
    await authBrowser.loadURL(input.url);
  } catch (error) {
    authBrowser.destroy();
    throw error;
  }
  return true;
}
