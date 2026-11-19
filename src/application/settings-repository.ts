/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/settings-repository.ts
 * Purpose: Tiny operator settings store (config/settings.local.json).
 * Holds the operator's history retention preference (Rule 24). Absent/zero
 * means keep everything forever.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { SettingsDto } from "../contracts/desktop.js";

function settingsPath(): string {
  return process.env.AGENT_SETTINGS_PATH ?? resolve("config", "settings.local.json");
}

export function readSettings(): SettingsDto {
  const path = settingsPath();
  try {
    if (!existsSync(path)) {
      return {};
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SettingsDto;
    const days = parsed.historyRetentionDays;
    return {
      ...(Number.isFinite(days) && (days as number) >= 0 ? { historyRetentionDays: Math.floor(days as number) } : {}),
      ...(parsed.syncDevProjectsOnStartup !== false ? { syncDevProjectsOnStartup: true } : { syncDevProjectsOnStartup: false }),
      ...(typeof parsed.devProjectsRoot === "string" && parsed.devProjectsRoot.trim()
        ? { devProjectsRoot: resolve(parsed.devProjectsRoot.trim()) }
        : {})
    };
  } catch {
    return {};
  }
}

export function writeSettings(input: SettingsDto): SettingsDto {
  const normalized: SettingsDto = {};
  const days = input.historyRetentionDays;
  if (Number.isFinite(days) && (days as number) >= 0) {
    const floored = Math.floor(days as number);
    if (floored > 0) {
      normalized.historyRetentionDays = Math.min(floored, 36500);
    }
  }
  normalized.syncDevProjectsOnStartup = input.syncDevProjectsOnStartup !== false;
  if (typeof input.devProjectsRoot === "string" && input.devProjectsRoot.trim()) {
    normalized.devProjectsRoot = resolve(input.devProjectsRoot.trim());
  }
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(normalized, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  return normalized;
}
