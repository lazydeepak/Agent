/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/bounded-context-assembler.ts
 * Purpose: Source module for bounded-context-assembler.ts.
 */
import type { DesktopApplicationService } from "./desktop-service.js";
import type { BoundedContext } from "../contracts/ai-proposal.js";

export function buildBoundedContext(
  service: DesktopApplicationService,
  pairId: string,
  attentionKind: "question" | "blocked",
  attentionId?: string,
  boundedWorkerReportId?: string,
  boundedWorkerMessage?: string,
  timelineLimit = 20
): BoundedContext {
  const timeline = service.getTimeline(pairId, timelineLimit);
  const status = service.getStatus();
  const pairStatus = status?.pairs?.find((p: any) => p.pairId === pairId);

  // Strict pair isolation: only this pair's timeline entries
  const boundedTimeline = timeline.map((entry: any) => ({
    time: entry.time,
    type: entry.type,
    pairId: entry.pairId,
    data: entry.details ? sanitizeContextDetails(entry.details) : {},
  }));

  return {
    pairId,
    attentionKind,
    boundedTimeline,
    boundedWorkerReportId,
    boundedWorkerMessage: boundedWorkerMessage ? boundedWorkerMessage.slice(0, 500) : undefined,
    boundedAttentionId: attentionId,
  };
}

function sanitizeContextDetails(details: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const lowerKey = String(key).toLowerCase();
    if (lowerKey.includes("password") || lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("cookie") || lowerKey.includes("credential")) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
