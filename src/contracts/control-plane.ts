/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/control-plane.ts
 * Purpose: Control-plane adapter for worker/planner pairs.
 */
/** Transport-neutral control-plane operation contract.
 *
 * The core application exposes typed operations independent of transport.
 * HTTP/SSE, future Tauri, PWA clients, CLI, and future AI tooling must
 * adapt to this contract rather than bypass application services.
 */

export type ControlPlaneOperationType =
  | "getStatus"
  | "getTimeline"
  | "startProject"
  | "pauseProject"
  | "listAttention"
  | "acknowledgeAttention"
  | "resolveAttention"
  | "createAttentionProposal"
  | "approveAttentionProposal"
  | "rejectAttentionProposal"
  | "listAttentionProposals"
  | "getAttentionProposal"
  | "listProjectPairs"
  | "createProjectPair"
  | "removeProjectPair"
  | "discoverOpenCodeProjects"
  | "discoverChatGptProjects"
  | "listPairs"
  | "createPair"
  | "updatePair"
  | "removePair"
  | "validatePair"
  | "getPair"
  | "discoverWorkerSessions"
  | "bindWorkerSession"
  | "updateProjectPair"
  | "archiveProjectPair"
  | "listWorkerModels"
  | "setWorkerModel"
  | "archivePair";

export interface ControlPlaneOperation {
  type: ControlPlaneOperationType;
  payload?: unknown;
}

export interface GetStatusPayload {
  pairId?: string;
}

export interface GetTimelinePayload {
  pairId?: string;
  limit?: number;
}

export interface StartProjectPayload {
  projectPairId: string;
}

export interface PauseProjectPayload {
  projectPairId: string;
}

export interface ListAttentionPayload {
  pairId?: string;
  status?: "open" | "acknowledged" | "resolved";
}

export interface AcknowledgeAttentionPayload {
  id: number;
}

export interface ResolveAttentionPayload {
  id: number;
  plannerSourceMessageId?: string;
}

export interface RejectAttentionProposalPayload {
  proposalId: string;
}

export interface CreateAttentionProposalPayload {
  attentionId: number;
  pairId?: string;
  provider?: string;
  model?: string;
}

export interface ApproveAttentionProposalPayload {
  proposalId: string;
}

export interface RejectAttentionProposalPayload {
  proposalId: string;
}

export interface ListProposalsPayload {
  pairId?: string;
  status?: "PENDING" | "APPROVED" | "REJECTED" | "DELIVERED" | "FAILED";
}

export interface GetProposalPayload {
  proposalId: string;
}

export interface CreateProjectPairPayload {
  projectPairId?: string;
  worker: { repoPath: string; projectId?: string };
  planner: { projectSlug: string; projectName?: string };
}

export interface RemoveProjectPairPayload {
  projectPairId: string;
}

export interface ListProjectPairsPayload {
  /* no filter fields for now */
}

export interface CreatePairPayload {
  pairId: string;
  enabled?: boolean;
  worker: { sessionId: string; repoPath: string; server?: { baseUrl?: string } };
  planner: { conversationId: string; conversationUrl: string; browser?: { cdpUrl?: string } };
  projectPairId?: string;
}

export interface UpdatePairPayload {
  pairId: string;
  enabled?: boolean;
  localAgentMode?: boolean;
  worker?: { sessionId?: string; repoPath?: string; server?: { baseUrl?: string } };
  planner?: { conversationId?: string; conversationUrl?: string; browser?: { cdpUrl?: string } };
  projectPairId?: string;
}

export interface RemovePairPayload {
  pairId: string;
}

export interface ValidatePairPayload {
  pairId: string;
}

export interface GetPairPayload {
  pairId: string;
}

export interface DiscoverWorkerSessionsPayload {
  pairId: string;
  baseUrl?: string;
}

export interface BindWorkerSessionPayload {
  pairId: string;
  sessionId: string;
}

export interface UpdateProjectPairPayload {
  projectPairId: string;
  worker?: { repoPath?: string; projectId?: string };
  planner?: { projectSlug?: string; projectName?: string };
}

export interface ArchiveProjectPairPayload {
  projectPairId: string;
}

export interface ListWorkerModelsPayload {
  pairId: string;
}

export interface SetWorkerModelPayload {
  pairId: string;
  providerId: string;
  modelId: string;
  notifyPlanner?: boolean;
}
