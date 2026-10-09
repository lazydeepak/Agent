/**
 * Agent-relay codebase — module explanation / info.
 * File: src/recovery/schedule.ts
 * Purpose: Source module for schedule.ts.
 */
export interface BackoffPolicy {
  delaysMs: readonly number[];
  maxDelayMs?: number;
}

export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  delaysMs: [1_000, 2_000, 5_000, 10_000, 30_000]
};

export function delayForAttempt(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY): number {
  const maxDelay = policy.maxDelayMs ?? Math.max(...policy.delaysMs);
  const index = Math.min(Math.max(attempt, 1), policy.delaysMs.length) - 1;
  const delay = policy.delaysMs[index] ?? maxDelay;
  return Math.min(maxDelay, delay);
}

export function abortError(): Error {
  return new Error("Recovery attempt was cancelled.");
}

export function interruptibleSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}