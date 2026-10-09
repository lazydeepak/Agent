/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/attention.ts
 * Purpose: Source module for attention.ts.
 */
/** Transport-neutral worker attention contract.
 *
 * A worker assistant message can explicitly declare its attention kind
 * through a bounded machine-readable envelope embedded in the message text.
 * Ordinary unmarked worker messages must continue to work as before and
 * must NOT be interpreted as blocking questions by default.
 */

export type WorkerAttentionKind = "report" | "question" | "blocked" | "completed";

export type AttentionStatus = "open" | "acknowledged" | "resolved";

export interface WorkerAttentionEnvelope {
  kind: WorkerAttentionKind;
  blocking: boolean;
}

export interface AttentionItem {
  id: string;
  pairId: string;
  kind: WorkerAttentionKind;
  createdAt: string;
  blocking: boolean;
  status: AttentionStatus;
  summary?: string;
  sourceMessageId?: string;
  question?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolvedByMessageId?: string;
}

export interface ListAttentionPayload {
  pairId?: string;
  status?: AttentionStatus;
}

export interface AcknowledgeAttentionPayload {
  id: string;
}

export interface ResolveAttentionPayload {
  id: string;
  plannerSourceMessageId?: string;
}
