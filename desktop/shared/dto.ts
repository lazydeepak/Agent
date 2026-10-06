export type CheckStatusDto = "PASS" | "FAIL";

export interface ReadinessCheckDto {
  name: string;
  status: CheckStatusDto;
  reason: string;
}

export interface ValidationResultDto {
  pairId: string;
  status: "READY" | "NOT_READY";
  checks: ReadinessCheckDto[];
  validatedAt: string;
}

export interface EventRecordDto {
  time: string;
  type: string;
  pairId?: string;
  projectPairId?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface RecentEventsFilterDto {
  pairId?: string;
  limit?: number;
}

export interface DesktopErrorDto {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PeerHealthDto {
  pairId: string;
  runtimeState: string;
  hasRelayHistory?: boolean;
  supervisorState?: string;
  worker: string;
  planner: string;
  workerActivity?: "idle" | "working";
  plannerActivity?: "idle" | "working";
  workerFailureReason?: "transport" | "session";
  plannerFailureReason?: "transport" | "session";
  recovering: boolean;
  workerObserved: boolean;
  plannerObserved: boolean;
  lastObservedAt?: string;
  paused: boolean;
  lastError?: string;
  enabled: boolean;
  schedulerMode?: "ACTIVE" | "DORMANT_WATCH";
}

export interface StatusSummaryDto {
  enabled: number;
  running: number;
  healthy: number;
  degraded: number;
  failed: number;
  pairs: PeerHealthDto[];
}

export interface PairIdentityDto {
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

export interface OpenCodeSessionInfoDto {
  sessionId: string;
  title?: string;
  repoPath?: string;
  updatedAt?: number;
}

export interface OpenCodeEndpointDto {
  baseUrl?: string;
}

export interface OpenCodeEndpointTestDto extends OpenCodeEndpointDto {
  sessionId?: string;
  repoPath?: string;
}

export interface CreateOpenCodeSessionDto extends OpenCodeEndpointDto {
  repoPath: string;
  title?: string;
}

export interface StartOpenCodeServerDto extends OpenCodeEndpointDto {
  repoPath: string;
  sessionId?: string;
}

export interface ToolLaunchResultDto {
  ok: true;
  message: string;
  endpoint: string;
  alreadyRunning: boolean;
}

export interface ToolActionResultDto {
  ok: true;
  message: string;
}

export interface WorkerSessionOpenResultDto {
  sessionId: string;
  selected: boolean;
  foregrounded: boolean;
  fallback: boolean;
}

export interface WorkerModelDto {
  providerId: string;
  modelId: string;
  name: string;
  current: boolean;
}

export interface SwitchWorkerModelDto {
  providerId: string;
  modelId: string;
  notifyPlanner?: boolean;
}

export interface WorkerModelSwitchResultDto extends WorkerModelDto {
  pairId: string;
  sessionId: string;
  switchedAt: string;
}

export interface ParsedChatGptUrlDto {
  conversationId: string;
  conversationUrl: string;
  project?: string;
}

export interface PlannerEndpointDto {
  cdpUrl?: string;
  conversationUrl?: string;
}

export interface EndpointTestResultDto {
  ok: boolean;
  message: string;
  checks?: Array<{ name: string; status: string; reason: string }>;
}

export type PairStartPriming = "from-worker" | "from-planner" | "from-trigger";

export interface AutomationInfoDto {
  mode: "observe" | "relay";
  universalPrompt: string;
  universalPromptVersion: string;
}

export interface PlannerSeedResultDto {
  pairId: string;
  promptVersion: string;
  sentAt: string;
}

export interface LocalAgentFeedResultDto {
  pairId: string;
  promptVersion: string;
  sentAt: string;
  localAgentMode: boolean;
}

export interface CandidatePairDto {
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

export interface UpdatePairDto {
  enabled?: boolean;
  localAgentMode?: boolean;
  worker?: { sessionId?: string; repoPath?: string; server?: { baseUrl?: string; apiProtocol?: "legacy" | "v2" } };
  planner?: {
    conversationId?: string;
    conversationUrl?: string;
    browser?: { cdpUrl?: string };
  };
  projectPairId?: string;
}

export interface ProjectPairDto {
  projectPairId: string;
  worker: {
    repoPath: string;
    projectId?: string;
  };
  planner: {
    projectSlug: string;
    projectName?: string;
  };
}

export interface CreateProjectPairDto {
  projectPairId?: string;
  worker: {
    repoPath: string;
    projectId?: string;
  };
  planner: {
    projectSlug: string;
    projectName?: string;
  };
}

export interface OpenCodeProjectDto {
  repoPath: string;
  name: string;
  sessionCount: number;
}

export interface ChatGptProjectDto {
  projectSlug: string;
  projectName?: string;
  conversationIds: string[];
  conversationTitles: Record<string, string>;
  openTabCount: number;
}

export interface ChatGptProjectsDiscoveryInput {
  cdpUrl?: string;
}

export interface ArchivedPairSummaryDto {
  ref: string;
  pairId: string;
  archivedAt: string;
  recordCount: number;
  cycleCount: number;
  hasState: boolean;
}
