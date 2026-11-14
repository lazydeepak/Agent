/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/events.ts
 * Purpose: Shared event contract across core, supervisor, recovery and the desktop shell.
 * Contains only type definitions/DTOs — no implementations.
 */
import type { SupervisorState } from "../types.js";

/** Event contract shared by core and the desktop shell. */
export interface EventRecord {
  time: string;
  type: string;
  pairId?: string;
  projectPairId?: string;
  state?: string;
  previousState?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface EventFilter {
  pairId?: string;
  limit?: number;
}

export type RuntimeEventType =
  | "RUNTIME_STARTED"
  | "RUNTIME_STOPPED"
  | "PAIR_RUNTIME_STARTED"
  | "PAIR_RUNTIME_STOPPED"
  | "PAIR_RUNTIME_FAILED"
  | "PAIR_RUNTIME_RECOVERED"
  | "EVENT_SOURCE_DEGRADED"
  | "SCHEDULER_MODE_CHANGED"
  | "SHARED_ENDPOINT_DETECTED";

export type SupervisorEventType =
  | "WATCH_STARTED"
  | "WATCH_STOPPED"
  | "STATE_CHANGED"
  | "STUCK_DETECTED"
  | "WORKER_MESSAGE_RELAYED"
  | "PLANNER_MESSAGE_RELAYED"
  | "DUPLICATE_SKIPPED"
  | "AMBIGUOUS_DELIVERY"
  | "AMBIGUOUS_DELIVERY_BLOCKED"
  | "AMBIGUOUS_DELIVERY_RECONCILED"
  | "RELAY_FAILED"
  | "RELAY_BLOCKED"
  | "CHATGPT_RATE_LIMITED"
  | "CHATGPT_SUBMISSION_HELD"
  | "OBSERVATION_ERROR"
  | "PAUSED"
  | "PEER_DISCONNECTED"
  | "RECOVERY_STARTED"
  | "RECOVERY_RETRY"
  | "RECOVERY_SUCCEEDED"
  | "RECOVERY_FAILED"
  | "RECOVERY_EXHAUSTED"
  | "BROWSER_RELAUNCHED"
  | "SESSION_RECONNECTED"
  /** Recovery Agent accepted an investigation request (Rules 4, 5, 10). */
  | "ESCALATED_TO_AGENT"
  /** v1.1 §11 — automated recovery suspended after repeated failures; operator release only. */
  | "RECOVERY_SUSPENDED"
  /** v1.1 §11 — operator released a suspended pair for automated recovery. */
  | "RECOVERY_SUSPENSION_RELEASED"
  | "INTERVENTION_REQUIRED"
  | "WORKER_MESSAGE_OBSERVED"
  | "WORKER_ATTENTION_OPENED"
  | "WORKER_ATTENTION_ACKNOWLEDGED"
  | "WORKER_ATTENTION_RESOLVED"
  | "PLANNER_MESSAGE_OBSERVED"
  | "WORKER_SESSION_CONNECTED"
  | "WORKER_SESSION_DISCONNECTED"
  | "PLANNER_SESSION_CONNECTED"
  | "PLANNER_SESSION_DISCONNECTED"
  | "PLANNER_GENERATING"
  | "PLANNER_IDLE"
  | RuntimeEventType;

export interface SupervisorEvent {
  time: string;
  pairId: string;
  type: SupervisorEventType;
  state?: SupervisorState;
  previousState?: SupervisorState;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface RuntimeEvent {
  time: string;
  type: RuntimeEventType;
  pairId?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface SupervisorLogger {
  write(event: SupervisorEvent | RuntimeEvent): void;
  close(): void;
}
