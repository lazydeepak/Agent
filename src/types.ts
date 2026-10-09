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
  error?: string;
  classification?: WorkerMessageClassification;
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
