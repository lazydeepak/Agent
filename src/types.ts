/**
 * Agent-relay codebase — module explanation / info.
 * File: src/types.ts
 * Purpose: Source module for types.ts.
 */
export type WorkerAdapterType = "opencode";
export type PlannerAdapterType = "chatgpt-browser";

export type CheckStatus = "PASS" | "FAIL";
export type ReadinessStatus = "READY" | "NOT_READY";

export interface ReadinessCheck {
  name: string;
  status: CheckStatus;
  reason: string;
  mandatory: boolean;
}

export type ReadinessOverrides = Record<string, boolean | string>;

export interface OpenCodeServerConfig {
  baseUrl?: string;
  /** Pin a session's protocol; dual-stack servers can have divergent message histories. */
  apiProtocol?: "legacy" | "v2";
  username?: string;
  password?: string;
  passwordEnv?: string;
}

export interface ChatGPTBrowserConfig {
  cdpUrl?: string;
  executablePath?: string;
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
}

export interface WorkerIdentity {
  type: WorkerAdapterType;
  sessionId: string;
  repoPath: string;
  server?: OpenCodeServerConfig;
  readiness?: ReadinessOverrides;
}

export interface PlannerIdentity {
  type: PlannerAdapterType;
  conversationId: string;
  conversationUrl: string;
  browser?: ChatGPTBrowserConfig;
  readiness?: ReadinessOverrides;
  automation?: {
    promptVersion: string;
    seededAt: string;
  };
}

export interface OpenCodeModelRef {
  providerID: string;
  id: string;
}

export interface OpenCodeModelInfo extends OpenCodeModelRef {
  name?: string;
  enabled?: boolean;
}

export interface SessionPair {
  pairId: string;
  enabled: boolean;
  worker: WorkerIdentity;
  planner: PlannerIdentity;
  localAgentMode?: boolean;
  /** Optional reference to a project pair identity managed independently from the session pair config. */
  projectPairId?: string;
  /** Worker model to fall back to when resuming a pair after a model failure. */
  fallbackModel?: { providerID: string; id: string };
  /**
   * Dedicated OpenCode session that receives verbatim Planner replies which do
   * not contain a Worker prompt after one regeneration request. Recovery Agent
   * has exclusive authority to stop automation; TerminalBot itself must not
   * pause, hold, or terminate automation based on Planner prose.
   */
  masterWorkerSessionId?: string;
}

export interface PairsConfig {
  pairs: SessionPair[];
}

/**
 * A project-level pairing of one worker repository to one planner project. Keys are
 * worker/planner-neutral; `opencode`/`chatgpt` remain accepted (and are normalized) when reading
 * older `config/projects.local.json` files.
 */
export interface ProjectPair {
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

export interface ProjectPairsConfig {
  projectPairs: ProjectPair[];
}

export interface PairReadinessReport {
  pairId: string;
  status: ReadinessStatus;
  checks: ReadinessCheck[];
  validatedAt: string;
}

export interface RelayableMessage {
  id: string;
  source: "worker" | "planner";
  role: "assistant" | "user";
  text: string;
  createdAt?: number;
  /**
   * Optional structured "writing_block" payloads extracted from a planner
   * (ChatGPT) assistant message, per the TerminalBot/RelayLoop proven behavior.
   * When present and non-empty, only these blocks are forwarded as worker prompts;
   * surrounding commentary is ignored. Consolidated from TerminalBot/RelayLoop.
   */
  writingBlocks?: string[];
}

export interface RelayReceipt {
  pairId: string;
  sourceMessageId: string;
  targetId: string;
  delivered: boolean;
  deliveredAt: string;
  transport: string;
  workerDispatchMessageId?: string;
  workerPromptState?: WorkerPromptState;
  workerStartBlocked?: boolean;
  workerStartBlockedReason?: string;
}

export type WorkerPromptState = "PERSISTED" | "ADMITTED" | "PROMOTED" | "COMPLETED";

export type RelayDirection = "worker-to-planner" | "planner-to-worker";

export type DeliveryStatus = "DISCOVERED" | "DELIVERING" | "DELIVERED" | "FAILED";

/** Deterministic classification of a worker assistant message, never model judgment. */
export type WorkerMessageClassification = "report" | "question";

/** Why a classified question should be routed to the planner. */
export type WorkerQuestionNature = "planner_input_required";

export interface CanonicalRelayIdentity {
  pairId: string;
  direction: RelayDirection;
  sourceMessageId: string;
  sourceHash: string;
}

export interface RelayRecord {
  id: number;
  pairId: string;
  direction: RelayDirection;
  sourceMessageId: string;
  sourceHash: string;
  sourceTimestamp?: number;
  targetId?: string;
  status: DeliveryStatus;
  firstSeenAt: string;
  deliveredAt?: string;
  lastAttemptAt?: string;
  attemptCount: number;
  /** Rule 12/13 — separate accounting for delivery *verification* attempts (distinct from delivery attempts). */
  verifyAttemptCount?: number;
  verifyLastAttemptAt?: string;
  error?: string;
  classification?: WorkerMessageClassification;
}

/** v1.1 §4 — narrow startup activation exception record. */
export type StartupOperationStatus = "pending" | "stabilized" | "hold" | "aborted";

export interface StartupOperation {
  id: string;
  pairId: string;
  mode: "fresh" | "resume";
  plannerSessionId: string;
  workerSessionId: string;
  status: StartupOperationStatus;
  attemptCount: number;
  maxAttempts: number;
  acceptedResponseId?: string;
  holdReason?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
}

export interface PairRelayState {
  pairId: string;
  projectPairId?: string;
  lastWorkerMessageId?: string;
  lastPlannerMessageId?: string;
  lastSuccessfulRelayAt?: string;
  lastDirection?: RelayDirection;
  lastError?: string;
}

export type SupervisorState =
  | "READY"
  | "WORKING"
  | "WAITING_PLANNER"
  | "WAITING_WORKER"
  | "IDLE"
  | "COMPLETED"
  | "WAITING_INPUT"
  | "STUCK"
  | "FAILED"
  | "DISCONNECTED"
  | "PAUSED";

export interface WorkerObservation {
  reachable: boolean;
  sessionExists: boolean;
  sessionActive: boolean;
  gathering: boolean;
  running?: boolean;
  waitingForInput?: boolean;
  latestMessageRole?: "user" | "assistant";
  latestMessageId?: string;
  latestMessageCreatedAt?: number;
  lastAssistantMessageId?: string;
  lastAssistantMessageCreatedAt?: number;
  lastAssistantMessageHash?: string;
  detail?: string[];
}

export interface PlannerObservation {
  latestPlannerControl?: "complete" | "blocked";
  rateLimitedUntil?: number;
  reachable: boolean;
  authenticated: boolean;
  conversationReachable: boolean;
  composerAvailable: boolean;
  generating: boolean;
  latestPlannerMessageId?: string;
  latestPlannerMessageCreatedAt?: number;
  detail?: string[];
}

export interface ObservationSnapshot {
  pairId: string;
  observedAt: string;
  worker: WorkerObservation;
  planner: PlannerObservation;
}

export interface SupervisorContinuity {
  pairId: string;
  lastSupervisorState?: SupervisorState;
  stateChangedAt?: string;
  lastObservedAt?: string;
  lastWorkerActivityAt?: string;
  lastPlannerActivityAt?: string;
  currentCycleWorkerMessageId?: string;
  currentCyclePlannerMessageId?: string;
  lastPlannerSideSyncedMessageId?: string;
  lastError?: string;
  paused: boolean;
  candidateWorkerMessageId?: string;
  candidateWorkerMessageHash?: string;
  candidateWorkerFirstSeenAt?: string;
  baselineWorkerMessageId?: string;
  baselineWorkerMessageCreatedAt?: number;
  projectPairId?: string;
  recoveryPolicy?: RecoveryPolicy;
  recoveryAttemptCount?: number;
  /** v1.1 §11 — set when repeated matching failures suspend automated recovery for this pair. Operator release only. */
  recoverySuspended?: boolean;
  /** v1.1 §11 — when the suspension was recorded. */
  recoverySuspendedAt?: string;
  lastRecoveryAttemptAt?: string;
  lastRecoverySuccessAt?: string;
  lastRecoveryErrorCode?: RecoveryErrorCode;
  lastRecoveryError?: string;
}

export type RecoveryPolicy = "none" | "safe";

export type RecoveryErrorCode =
  | "OPENCODE_UNREACHABLE"
  | "OPENCODE_SESSION_MISSING"
  | "OPENCODE_REPO_MISMATCH"
  | "OPENCODE_TIMEOUT"
  | "CHATGPT_CDP_UNREACHABLE"
  | "CHATGPT_PAGE_CLOSED"
  | "CHATGPT_AUTH_REQUIRED"
  | "CHATGPT_CONVERSATION_MISMATCH"
  | "RELAY_AMBIGUOUS"
  | "RELAY_DELIVERY_FAILED"
  | "RECOVERY_SUSPENDED"
  | "STUCK_UNRESOLVED"
  | "RECOVERY_RETRY_EXHAUSTED";

export type BrowserOwnership = "external" | "managed";

export interface RecoveryMetadata {
  policy: RecoveryPolicy;
  eligible: boolean;
  action: string;
  attemptCount: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: RecoveryErrorCode;
  lastError?: string;
}

export type PairRuntimeState = "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "STOPPING" | "ERROR";

export type PeerHealth = "connected" | "degraded" | "failed" | "unknown";

/** Whether a connected peer is currently generating/processing, orthogonal to connection health. */
export type PeerActivity = "idle" | "working";

/**
 * Distinguishes *why* a peer is failed: a transport-level problem (server/browser unreachable)
 * versus a session-level problem (server reachable but the exact bound session/conversation is
 * missing or unusable). These must never be conflated with each other.
 */
export type PeerFailureReason = "transport" | "session";

export interface RuntimePairStatus {
  pairId: string;
  runtimeState: PairRuntimeState;
  /** True when the durable relay ledger contains prior work for this pair. */
  hasRelayHistory?: boolean;
  supervisorState?: SupervisorState;
  worker: PeerHealth;
  planner: PeerHealth;
  /** Activity signal for the worker, meaningful only when `worker` is not "unknown". */
  workerActivity?: PeerActivity;
  /** Activity signal for the planner, meaningful only when `planner` is not "unknown". */
  plannerActivity?: PeerActivity;
  /** Set when `worker === "failed"`, indicating whether it is a transport or session-level failure. */
  workerFailureReason?: PeerFailureReason;
  /** Set when `planner === "failed"`, indicating whether it is a transport or session-level failure. */
  plannerFailureReason?: PeerFailureReason;
  /** True while a recovery attempt is actively underway (not yet succeeded, not yet exhausted). */
  recovering: boolean;
  workerObserved: boolean;
  plannerObserved: boolean;
  lastObservedAt?: string;
  paused: boolean;
  lastError?: string;
  enabled: boolean;
  schedulerMode?: SchedulerMode;
}

export type SchedulerMode = "ACTIVE" | "DORMANT_WATCH";

export interface RuntimeMetadata {
  pairId: string;
  runtimeEnabled: boolean;
  lastRuntimeStartAt?: string;
  lastRuntimeStopAt?: string;
  lastRuntimeError?: string;
  schedulerMode?: SchedulerMode;
  schedulerModeChangedAt?: string;
  dormantReason?: string;
  resumeAfterRestart?: boolean;
  /** Rule 15 — operator-configured per-pair auto-resume after restart (default: disabled). */
  autoResumeAfterRestart?: boolean;
}

export type RelayCycleStatus =
  | "DISPATCHED"
  | "WORKER_RESPONDED"
  | "DELIVERED"
  | "FAILED";

export interface RelayCycle {
  id: number;
  pairId: string;
  plannerSourceMessageId: string;
  workerDispatchMessageId: string;
  dispatchedAt?: string;
  workerResponseMessageId?: string;
  workerCompletedAt?: string;
  plannerDeliveryRecordId?: number;
  cycleStatus: RelayCycleStatus;
}
