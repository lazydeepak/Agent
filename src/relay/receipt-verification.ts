/**
 * Agent codebase — module explanation / info.
 * File: src/relay/receipt-verification.ts
 * Purpose: Deterministic receipt verification helpers (exact normalized + layout-insensitive fallback, baseline exclusion). Consolidated from TerminalBot/RelayLoop.
 */

/** Rule 13 — wait 2 minutes between verification retries of an unconfirmed message. */
export { RELAY_VERIFY_RETRY_MS } from "./verifier.js";

export function normalizeReceiptText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface ReceiptMatchResult {
  matched: boolean;
  strategy: "exact" | "layout-insensitive" | "none";
}

/**
 * Determine whether `expected` (the sent payload) is present among `candidates`
 * (newly observed destination messages), excluding any whose id is in `baselineIds`.
 *
 * @param candidates Observed destination messages after delivery (newest or any order).
 * @param expected   The payload that was sent.
 * @param baselineIds Message ids that existed before delivery; excluded from matching.
 */
export function matchPlannerReceipt(
  candidates: Array<{ id: string; text: string }>,
  expected: string,
  baselineIds: ReadonlySet<string> = new Set()
): ReceiptMatchResult {
  const fresh = candidates.filter((c) => !baselineIds.has(c.id));
  const normalizedExpected = normalizeReceiptText(expected);
  const collapsedExpected = collapseWhitespace(expected);

  for (const candidate of fresh) {
    if (normalizeReceiptText(candidate.text) === normalizedExpected) {
      return { matched: true, strategy: "exact" };
    }
  }
  for (const candidate of fresh) {
    if (collapseWhitespace(candidate.text) === collapsedExpected) {
      return { matched: true, strategy: "layout-insensitive" };
    }
  }
  return { matched: false, strategy: "none" };
}

/**
 * TerminalBot requires exactly one post-baseline user message for a clean receipt;
 * multiple matches are treated as ambiguous (no auto-resend).
 */
export function countFreshMatches(
  candidates: Array<{ id: string; text: string }>,
  expected: string,
  baselineIds: ReadonlySet<string> = new Set()
): number {
  const fresh = candidates.filter((c) => !baselineIds.has(c.id));
  const normalizedExpected = normalizeReceiptText(expected);
  return fresh.filter((c) => normalizeReceiptText(c.text) === normalizedExpected).length;
}
