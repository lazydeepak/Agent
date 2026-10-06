import type { OpenCodeModelInfo } from "../adapters/opencode/http.js";

/**
 * Desktop-facing DTOs shared between the desktop shell and core.
 *
 * These live in `src/contracts` so the desktop shell and the extracted application services can
 * reference them without importing the (large) service facade that used to own them.
 */

export type PairStartPriming = "from-worker" | "from-planner" | "from-trigger";

export interface WorkerModelInfo extends OpenCodeModelInfo {
  current: boolean;
}

export interface ValidatedPair {
  pairId: string;
  status: "READY" | "NOT_READY";
  checks: Array<{ name: string; status: string; reason: string }>;
  validatedAt: string;
}

export interface PairDetail {
  pairId: string;
  enabled: boolean;
  localAgentMode?: boolean;
  projectPairId?: string;
  worker: {
    type: string;
    sessionId: string;
    repoPath: string;
    server?: { baseUrl?: string; apiProtocol?: "legacy" | "v2" };
  };
  planner: {
    type: string;
    conversationId: string;
    conversationUrl: string;
    browser?: { cdpUrl?: string };
    automation?: { promptVersion: string; seededAt: string };
  };
}

export interface OpenCodeSessionInfo {
  sessionId: string;
  title?: string;
  repoPath?: string;
  updatedAt?: number;
}

export interface OpenCodeEndpointInput {
  baseUrl?: string;
}

export interface OpenCodeEndpointTestInput extends OpenCodeEndpointInput {
  sessionId?: string;
  repoPath?: string;
}

export interface CreateOpenCodeSessionInput extends OpenCodeEndpointInput {
  repoPath: string;
  title?: string;
}

export interface ChatGptUrlInput {
  url: string;
}

export interface ParsedChatGptUrl {
  conversationId: string;
  conversationUrl: string;
  project?: string;
}

export interface PlannerEndpointInput {
  cdpUrl?: string;
  conversationUrl?: string;
}

export interface StartOpenCodeServerInput extends OpenCodeEndpointInput {
  repoPath: string;
  /** Presence of a session id opts into the post-start session check; omitting it just brings the server up. */
  sessionId?: string;
}

export interface EndpointTestResult {
  ok: boolean;
  message: string;
  checks?: Array<{ name: string; status: string; reason: string }>;
}

/** Result of comparing a pair's bound worker session to OpenCode Desktop's active tab. */
export interface WorkerSessionDesktopAlignment {
  ok: boolean;
  boundSessionId: string;
  desktopSessionId: string;
  rebound: boolean;
  message: string;
}

export interface AutomationInfo {
  mode: "observe" | "relay";
  universalPrompt: string;
  universalPromptVersion: string;
}

export interface PlannerSeedResult {
  pairId: string;
  promptVersion: string;
  sentAt: string;
}

export interface LocalAgentFeedResult {
  pairId: string;
  promptVersion: string;
  sentAt: string;
  localAgentMode: boolean;
}

export interface CandidatePairInput {
  pairId: string;
  worker: {
    sessionId: string;
    repoPath: string;
    server?: { baseUrl?: string; apiProtocol?: "legacy" | "v2" };
  };
  planner: {
    conversationId: string;
    conversationUrl: string;
    browser?: { cdpUrl?: string };
  };
  projectPairId?: string;
}

export interface UpdatePairInput {
  enabled?: boolean;
  localAgentMode?: boolean;
  worker?: { sessionId?: string; repoPath?: string; server?: { baseUrl?: string; apiProtocol?: "legacy" | "v2" } };
  planner?: {
    conversationId?: string;
    conversationUrl?: string;
    browser?: { cdpUrl?: string };
  };
}
