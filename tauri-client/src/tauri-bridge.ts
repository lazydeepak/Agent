/** Minimal Tauri v2 IPC bridge.
 *  Uses the window.__TAURI_INTERNALS__ bridge injected by Tauri into the WebView.
 *  No external @tauri-apps/api dependency required.
 */

interface TauriConnectionContext {
  endpoint: string;
  token: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__?.invoke;
}

export async function getConnectionContext(): Promise<TauriConnectionContext | null> {
  if (!isTauri()) return null;
  try {
    const result = await window.__TAURI_INTERNALS__!.invoke("get_connection_context");
    if (result && typeof result === "object" && "endpoint" in result && "token" in result) {
      return result as TauriConnectionContext;
    }
    return null;
  } catch {
    return null;
  }
}
