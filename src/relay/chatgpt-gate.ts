export const DEFAULT_CHATGPT_MIN_SUBMIT_INTERVAL_MS = 30_000;
export const DEFAULT_CHATGPT_BACKOFF_INITIAL_MS = 30_000;
export const DEFAULT_CHATGPT_BACKOFF_MAX_MS = 5 * 60_000;
export const DEFAULT_CHATGPT_BACKOFF_BASE = 2;

export interface ChatGptSubmissionGateOptions {
  minIntervalMs?: number;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  backoffBase?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  isRateLimitedError?: (error: unknown) => boolean;
}

export interface ChatGptSubmissionDecision {
  allowed: boolean;
  // True when a previous submission is still blocked by rate limiting and this
  // submission is simply being held (preserved, not dropped, not re-sent).
  rateLimited: boolean;
  retryAt?: number;
  reason?: string;
}

export interface ChatGptSubmissionOutcome {
  outcome: "SENT" | "HELD";
  reason?: string;
  retryAt?: number;
}

interface PerPairGateState {
  lastSentAt: number;
  backoffLevel: number;
  rateLimitedUntil: number;
}

/**
 * Enforces a conservative minimum spacing between ChatGPT submissions per pair
 * and applies bounded exponential backoff after temporary rate-limit responses.
 *
 * The gate is a second line of defense on top of event-driven observation: it
 * never sends "something every 30s"; it only spaces out genuinely necessary
 * submissions and, when a submission is attempted too soon (or the pair is in
 * rate-limit backoff), it holds the pending message rather than dropping it.
 *
 * All timing is injectable so tests use a fake clock/sleep and never wait for
 * real wall-clock delays.
 */
export class ChatGptSubmissionGate {
  private readonly minIntervalMs: number;
  private readonly backoffInitialMs: number;
  private readonly backoffMaxMs: number;
  private readonly backoffBase: number;
  private readonly now: () => number;
  private readonly sleep?: (milliseconds: number) => Promise<void>;
  private readonly isRateLimited: (error: unknown) => boolean;
  private readonly state = new Map<string, PerPairGateState>();

  constructor(options: ChatGptSubmissionGateOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_CHATGPT_MIN_SUBMIT_INTERVAL_MS;
    this.backoffInitialMs = options.backoffInitialMs ?? DEFAULT_CHATGPT_BACKOFF_INITIAL_MS;
    this.backoffMaxMs = options.backoffMaxMs ?? DEFAULT_CHATGPT_BACKOFF_MAX_MS;
    this.backoffBase = options.backoffBase ?? DEFAULT_CHATGPT_BACKOFF_BASE;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep;
    this.isRateLimited = options.isRateLimitedError ?? defaultIsRateLimited;
  }

  /**
   * Returns whether a submission may be attempted right now. When false, the
   * caller should hold the pending worker report (do not drop it) and retry on
   * a later cycle after `retryAt`.
   */
  decide(pairId: string): ChatGptSubmissionDecision {
    const pair = this.state.get(pairId);
    const nowMs = this.now();
    if (!pair) {
      return { allowed: true, rateLimited: false };
    }

    if (pair.rateLimitedUntil > 0 && nowMs < pair.rateLimitedUntil) {
      return {
        allowed: false,
        rateLimited: true,
        retryAt: pair.rateLimitedUntil,
        reason: `ChatGPT is temporarily rate-limited; holding the report until ${new Date(pair.rateLimitedUntil).toISOString()}.`
      };
    }

    const nextAllowedAt = pair.lastSentAt + this.minIntervalMs;
    if (nowMs < nextAllowedAt) {
      return {
        allowed: false,
        rateLimited: false,
        retryAt: nextAllowedAt,
        reason: `Minimum ${Math.round(this.minIntervalMs / 1000)}s spacing between ChatGPT submissions not yet reached; holding the report.`
      };
    }

    return { allowed: true, rateLimited: false };
  }

  /**
   * Waits (using the injectable sleep) until a submission may be attempted,
   * preserving any held message. Returns "SENT" when ready to send.
   */
  async waitForDecision(pairId: string, signal?: AbortSignal): Promise<ChatGptSubmissionOutcome> {
    const decision = this.decide(pairId);
    if (decision.allowed) {
      return { outcome: "SENT" };
    }
    if (this.sleep && decision.retryAt) {
      const waitMs = Math.max(0, decision.retryAt - this.now());
      if (waitMs > 0) {
        await interruptible(delay(waitMs, this.sleep), signal);
      }
      return this.decide(pairId).allowed
        ? { outcome: "SENT" }
        : { outcome: "HELD", reason: decision.reason, retryAt: decision.retryAt };
    }
    return { outcome: "HELD", reason: decision.reason, retryAt: decision.retryAt };
  }

  /** Record a successful submission; clears backoff for the pair. */
  recordSuccess(pairId: string): void {
    const pair = this.state.get(pairId) ?? emptyState();
    pair.lastSentAt = this.now();
    pair.backoffLevel = 0;
    pair.rateLimitedUntil = 0;
    this.state.set(pairId, pair);
  }

  /** Record a temporary rate-limit response and enter/exist exponential backoff. */
  recordRateLimited(pairId: string): void {
    const pair = this.state.get(pairId) ?? emptyState();
    const delayMs = Math.min(
      this.backoffMaxMs,
      this.backoffInitialMs * Math.pow(this.backoffBase, pair.backoffLevel)
    );
    pair.backoffLevel += 1;
    pair.rateLimitedUntil = this.now() + delayMs;
    this.state.set(pairId, pair);
  }

  isRateLimitedError(error: unknown): boolean {
    return this.isRateLimited(error);
  }

  debugState(pairId: string): {
    lastSentAt: number;
    backoffLevel: number;
    rateLimitedUntil: number;
  } {
    const pair = this.state.get(pairId) ?? emptyState();
    return { ...pair };
  }
}

export function defaultIsRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate.?limit|too quickly|temporarily limited|slow down|try again in/i.test(message);
}

function emptyState(): PerPairGateState {
  return { lastSentAt: 0, backoffLevel: 0, rateLimitedUntil: 0 };
}

export function delay(ms: number, sleep: (m: number) => Promise<void>): Promise<void> {
  return sleep(ms);
}

export async function interruptible(task: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return task;
  }
  if (signal.aborted) {
    return;
  }
  await Promise.race([
    task,
    new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    })
  ]);
}
/** Terminal replies from the existing planner protocol are never worker tasks. */
export function plannerControlMessage(text: string): "complete" | "blocked" | undefined {
  const marker = text.trim().match(/^(?:\*\*)?(RELAY_COMPLETE|RELAY_BLOCKED)(?:\*\*)?(?:\s|$)/)?.[1]
    ?? text.trim().match(/(?:^|\n)(?:\*\*)?(RELAY_COMPLETE|RELAY_BLOCKED)(?:\*\*)?$/)?.[1];
  return marker === "RELAY_COMPLETE" ? "complete" : marker === "RELAY_BLOCKED" ? "blocked" : undefined;
}
