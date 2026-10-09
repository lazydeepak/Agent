/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/attention-parser.ts
 * Purpose: Source module for attention-parser.ts.
 */
/** Explicit bounded worker-attention envelope parser.
 *
 * Workers must emit attention through a bounded machine-readable marker.
 * Normal unmarked messages continue to work and must NOT be interpreted
 * heuristically. A malformed envelope fails safely (falls back to report).
 */

import type {
  WorkerAttentionEnvelope,
  WorkerAttentionKind,
  AttentionStatus,
} from "../contracts/attention.js";

const ENVELOPE_START = "<agent-relay>";
const ENVELOPE_END = "</agent-relay>";

export function parseWorkerAttentionEnvelope(text: string): WorkerAttentionEnvelope | undefined {
  const trimmed = (text ?? "").trim();
  const startIndex = trimmed.indexOf(ENVELOPE_START);
  if (startIndex === -1) {
    return undefined;
  }
  const endIndex = trimmed.indexOf(ENVELOPE_END, startIndex);
  if (endIndex === -1) {
    return undefined; // malformed: missing closing tag
  }
  const inner = trimmed.slice(startIndex + ENVELOPE_START.length, endIndex).trim();
  try {
    const parsed = JSON.parse(inner) as Record<string, unknown>;
    const kind = parseKind(parsed.kind);
    if (!kind) {
      return undefined; // malformed: unknown or missing kind
    }
    const blocking = parsed.blocking === true;
    return { kind, blocking };
  } catch {
    return undefined; // malformed: not valid JSON
  }
}

function parseKind(value: unknown): WorkerAttentionKind | undefined {
  if (value === "report" || value === "question" || value === "blocked" || value === "completed") {
    return value;
  }
  return undefined;
}
