/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/ai-proposal.ts
 * Purpose: Source module for ai-proposal.ts.
 */
/** AI advisor proposal contract — transport-neutral.
 *
 * The model produces a proposal; Agent remains the authority.
 * A proposal must never include arbitrary tool calls, shell commands,
 * filesystem mutations, paired identity changes, or runtime mutations.
 * Only bounded text answers intended for planner → worker relay.
 */

export type ProposalDisposition =
  | "propose_answer"
  | "needs_human"
  | "no_action";

export interface AttentionAdvisorInput {
  attentionId: string;
  pairId: string;
  kind: "question" | "blocked";
  question?: string;
  summary?: string;
  boundedContext: BoundedContext;
}

export interface BoundedContext {
  pairId: string;
  attentionKind: "question" | "blocked";
  boundedTimeline?: Array<{ time: string; type: string; pairId?: string; data?: Record<string, unknown> }>;
  boundedWorkerMessage?: string;
  boundedWorkerReportId?: string;
  boundedAttentionId?: string;
}

export interface AttentionAdvisorResult {
  disposition: ProposalDisposition;
  proposedAnswer?: string;
  rationaleSummary?: string;
  providerMetadata?: {
    provider: string;
    model?: string;
    durationMs?: number;
  };
}
