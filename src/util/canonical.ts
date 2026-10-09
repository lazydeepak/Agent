/**
 * Agent-relay codebase — module explanation / info.
 * File: src/util/canonical.ts
 * Purpose: Canonicalization helpers (URL, identity, hash).
 */
import { createHash } from "node:crypto";

/**
 * Text canonicalization and hashing. Lives in `src/util` so adapters can hash message text without
 * importing from `src/persistence`.
 */
export function canonicalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function hashText(text: string): string {
  return createHash("sha256").update(canonicalizeText(text), "utf8").digest("hex");
}
