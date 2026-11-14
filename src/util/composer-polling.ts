/**
 * Agent codebase — module explanation / info.
 * File: src/util/composer-polling.ts
 * Purpose: Polling helper that waits for the ChatGPT composer to become ready before sending; injectable clock/sleep/AbortSignal. Consolidated from TerminalBot/RelayLoop.
 */

import { isComposerReady, type ComposerSnapshot, type ComposerReadinessResult } from "./composer-readiness.js";

export interface ComposerPollingOptions {
  timeoutMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export async function waitForComposerReady(
  snapshot: () => Promise<ComposerSnapshot>,
  options: ComposerPollingOptions
): Promise<{ ready: boolean; last: ComposerReadinessResult; attempts: number }> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + options.timeoutMs;
  let attempts = 0;
  let last: ComposerReadinessResult = { ready: false, reasons: ["not checked"] };

  while (true) {
    if (options.signal?.aborted) {
      return { ready: false, last: { ready: false, reasons: ["aborted"] }, attempts };
    }
    attempts += 1;
    const snap = await snapshot();
    last = isComposerReady(snap);
    if (last.ready) return { ready: true, last, attempts };
    if (now() >= deadline) return { ready: false, last, attempts };
    const wait = Math.min(options.intervalMs, Math.max(0, deadline - now()));
    if (wait <= 0) return { ready: false, last, attempts };
    await sleep(wait);
  }
}
