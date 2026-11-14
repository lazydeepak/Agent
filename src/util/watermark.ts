/**
 * Agent codebase — module explanation / info.
 * File: src/util/watermark.ts
 * Purpose: Embeds a compact, human-visible watermark on every relay message so
 * each message carries a globally unique Relay ID and its UTC emission timestamp.
 * Required by global relay automation rules.
 */

import { randomUUID } from "node:crypto";

export interface RelayWatermark {
  relayId: string;
  emittedAt: string;
}

export function makeWatermark(): RelayWatermark {
  return { relayId: randomUUID(), emittedAt: new Date().toISOString() };
}

export function renderWatermark(watermark: RelayWatermark): string {
  const compact = watermark.emittedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `⟦relay:${watermark.relayId} ${compact}⟧`;
}

/** Remove a trailing relay watermark, if present. Used by delivery verification to match the source hash. */
export function stripWatermark(text: string): string {
  return text.replace(/\n\n⟦relay:[^⟧]+⟧\s*$/, "");
}

export function withWatermark(text: string): string {
  const watermark = makeWatermark();
  const suffix = renderWatermark(watermark);
  return `${text}

${suffix}`;
}
