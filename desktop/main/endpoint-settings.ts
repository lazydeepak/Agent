import { app } from "electron";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_FILE = "desktop-endpoint-settings.json";

export function restoreOpenCodeEndpoint(): string | undefined {
  const path = join(app.getPath("userData"), SETTINGS_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const settings = JSON.parse(readFileSync(path, "utf8")) as { opencodeBaseUrl?: unknown };
    return typeof settings.opencodeBaseUrl === "string" ? settings.opencodeBaseUrl : undefined;
  } catch {
    return undefined;
  }
}

export function saveOpenCodeEndpoint(endpoint: string): void {
  const path = join(app.getPath("userData"), SETTINGS_FILE);
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ opencodeBaseUrl: endpoint }), { mode: 0o600 });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, path);
}
