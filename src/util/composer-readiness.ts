/**
 * Agent codebase — module explanation / info.
 * File: src/util/composer-readiness.ts
 * Purpose: Pure composer-readiness check: not generating, latest message is assistant, exactly one editable composer, draft matches expected payload. Consolidated from TerminalBot/RelayLoop.
 */

export interface ComposerSnapshot {
  generating: boolean;
  latestMessageRole?: "assistant" | "user" | string;
  composerCount: number;
  composerVisible: boolean;
  composerEnabled: boolean;
  composerText?: string;
  expectedText?: string;
}

export interface ComposerReadinessResult {
  ready: boolean;
  reasons: string[];
}

export function isComposerReady(snapshot: ComposerSnapshot): ComposerReadinessResult {
  const reasons: string[] = [];
  if (snapshot.generating) reasons.push("planner is generating");
  if (snapshot.latestMessageRole !== "assistant") reasons.push("latest message is not an assistant message");
  if (snapshot.composerCount !== 1) reasons.push(`expected exactly one composer, found ${snapshot.composerCount}`);
  if (!snapshot.composerVisible) reasons.push("composer is not visible");
  if (!snapshot.composerEnabled) reasons.push("composer is not enabled");
  if (snapshot.expectedText !== undefined && snapshot.composerText !== undefined) {
    const normalize = (v: string) => v.replace(/\s+/g, " ").trim();
    if (normalize(snapshot.composerText) !== "" && normalize(snapshot.composerText) !== normalize(snapshot.expectedText)) {
      reasons.push("composer draft does not match expected payload");
    }
  }
  return { ready: reasons.length === 0, reasons };
}

/** TerminalBot/RelayLoop default 10-minute windows (milliseconds). */
export const PLANNER_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
export const PLANNER_READY_TIMEOUT_MS = 10 * 60 * 1000;
export const RECEIPT_TIMEOUT_MS = 10 * 60 * 1000;
export const RECEIPT_POLL_INTERVAL_MS = 5 * 1000;
