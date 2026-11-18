/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/desktop.ts
 * Purpose: Source module for desktop.ts.
 */
import type { OpenCodeModelInfo } from "../types.js";

/**
 * Desktop-facing DTOs shared between the desktop shell and core.
 *
 * These live in `src/contracts` so the desktop shell and the extracted application services can
 * reference them without importing the (large) service facade that used to own them.
 */

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
  /** Latest relay record evidence for DELIVERY tiles. Absent until the pair has records. */
  latestDeliveryStatus?: "DISCOVERED" | "DELIVERING" | "DELIVERED" | "FAILED";
  latestDeliveryVerifyAttempts?: number;
  /** v1.1 §7.3 — operator-selected starting side for this turn while both peers are busy. */
  startingSide?: "planner" | "worker" | null;
  /** v1.1 §7.3–7.4 — both peers busy with pending work and no starting side selected yet. */
  awaitingStartingSideSelection?: boolean;
  supervisorState?: string;
  worker: string;
  planner: string;
  workerActivity?: "idle" | "working";
  plannerActivity?: "idle" | "working";
  workerFailureReason?: "transport" | "session";
  plannerFailureReason?: "transport" | "session";
  /** v1.1 §12 — when the supervisor state last changed (real time-in-state evidence). */
  stateChangedAt?: string;
  /** When the pair's runtime last started (real relay uptime evidence). */
  lastRuntimeStartAt?: string;
  /** Latest relay cycle evidence for the turn progression stepper. */
  latestCycleStatus?: "DISCOVERED" | "DISPATCHED" | "WORKER_RESPONDED" | "DELIVERED" | "FAILED" | string;
  latestCycleDispatchedAt?: string;
  latestCycleWorkerCompletedAt?: string;
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
  /** OpenCode session that will receive verbatim Planner replies lacking a Worker prompt after one regeneration request. */
  masterWorkerSessionId?: string;
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

export type PairStartPriming = "from-worker" | "from-planner" | "from-trigger" | "resume";

export interface AutomationInfoDto {
  mode: "observe" | "relay";
  universalPrompt: string;
  universalPromptVersion: string;
}

export interface PlannerSeedResultDto {
  pairId: string;
  promptVersion: string;
  sentAt: string;
  /** v1.1 §7.5 — resume path only: whether direct continuation was used. */
  consistency?: "proven" | "unproven";
  /** v1.1 §7.5 — resume path only: reasons direct continuation was refused. */
  uncertainties?: string[];
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
  /** OpenCode session that receives verbatim Planner replies lacking a Worker prompt after one regeneration request. */
  masterWorkerSessionId?: string;
  projectPairId?: string;
}

/** Rule 24 — operator-configurable history retention. */
export interface SettingsDto {
  /** Days of history to keep in SQLite (relay cycles, resolved attention items, non-pending proposals). 0 or absent = keep forever. Never applies to the relay ledger. */
  historyRetentionDays?: number;
}

export interface AutoResumeStateDto {
  pairId: string;
  autoResumeAfterRestart: boolean;
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
  masterWorkerSessionId?: string;
}

export interface ProjectPairDto {
  projectPairId: string;
  projectName?: string;
  worker: {
    repoPath: string;
    projectId?: string;
  };
  planner: {
    projectSlug: string;
    projectName?: string;
    projectUrl?: string;
  };
}

export interface CreateProjectPairDto {
  projectPairId?: string;
  projectName?: string;
  worker: {
    repoPath: string;
    projectId?: string;
  };
  planner: {
    projectSlug: string;
    projectName?: string;
    projectUrl?: string;
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

export interface WorkerModelInfo extends OpenCodeModelInfo {
  current: boolean;
}

export interface WorkerSessionDesktopAlignmentDto {
  ok: boolean;
  boundSessionId: string;
  desktopSessionId: string;
  rebound: boolean;
  message: string;
}

export interface ChatGptUrlInputDto {
  url: string;
}

// Aliases for backward compatibility in backend code that didn't use the Dto suffix
export type PairDetail = PairIdentityDto;
export type OpenCodeSessionInfo = OpenCodeSessionInfoDto;
export type OpenCodeEndpointInput = OpenCodeEndpointDto;
export type OpenCodeEndpointTestInput = OpenCodeEndpointTestDto;
export type CreateOpenCodeSessionInput = CreateOpenCodeSessionDto;
export type ChatGptUrlInput = ChatGptUrlInputDto;
export type ParsedChatGptUrl = ParsedChatGptUrlDto;
export type PlannerEndpointInput = PlannerEndpointDto;
export type StartOpenCodeServerInput = StartOpenCodeServerDto;
export type EndpointTestResult = EndpointTestResultDto;
export type WorkerSessionDesktopAlignment = WorkerSessionDesktopAlignmentDto;
export type AutomationInfo = AutomationInfoDto;
export type PlannerSeedResult = PlannerSeedResultDto;
export type LocalAgentFeedResult = LocalAgentFeedResultDto;
export type CandidatePairInput = CandidatePairDto;
export type UpdatePairInput = UpdatePairDto;
export type ValidatedPair = ValidationResultDto;

/** v1.1-style read-only ground-truth diagnostics for the Source view. All fields are evidence, never predictions. */
export interface DiagnosticsSnapshotDto {
  generatedAt: string;
  /** true when the relay store was unavailable — every store-derived field is null. */
  available: boolean;
  reason?: string;
  /** true ONLY from the browser preview bridge (mock data); never set by the real desktop service. */
  simulated?: boolean;
  environment: { node: string; platform: string; arch: string };
  database: { path: string; schemaVersion: number | null; expectedSchemaVersion: number; journalMode: string; dbSizeBytes?: number; walSizeBytes?: number } | null;
  config: { configPath: string | null; pairsCount: number | null; projectPairsCount: number | null };
  relayLedger: { total: number; delivered: number; delivering: number; failed: number; ambiguousDelivering: Array<{ pairId: string; direction: string; sourceMessageId: string; firstSeenAt: string; verifyAttemptCount: number }> } | null;
  relayCycles: { total: number; byStatus: Record<string, number> } | null;
  startupOperations: { pending: number; hold: number; stabilized: number } | null;
  supervisorState: { paused: number; suspended: number; suspendedPairs: Array<{ pairId: string; suspendedAt?: string; attemptCount: number }> } | null;
  openAttentions: number | null;
  openProposals: number | null;
  settings: { historyRetentionDays: number };
}

export interface DatabaseSettingsInfoDto {
  generatedAt: string;
  databasePath: string;
  databaseExists: boolean;
  dbSizeBytes?: number;
  walSizeBytes?: number;
  journalMode: string;
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  tableCounts: Record<string, number> | null;
}

export interface DatabaseBackupEntryDto {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
}

export interface DatabaseRestoreResultDto {
  restoredFrom: string;
  preRestoreBackup: string;
}

export type PermissionGrantAction = "model-switch-outside-approved" | "shared-service-restart";
export type PermissionGrantMode = "one-time" | "permanent";
/** v1.1 §11.5 — 'global' authorizes machine-wide operations (shared-service restart). */
export type PermissionGrantScopeType = "project" | "pair" | "global";

export interface PermissionGrantDto {
  id: number;
  scopeType: PermissionGrantScopeType;
  scopeRef: string;
  action: PermissionGrantAction;
  mode: PermissionGrantMode;
  grantedBy: string;
  grantedAt: string;
  note?: string;
  revokedAt?: string;
  consumedAt?: string;
}

export interface PermissionGrantInputDto {
  scopeType: PermissionGrantScopeType;
  scopeRef: string;
  action: PermissionGrantAction;
  mode: PermissionGrantMode;
  note?: string;
}
