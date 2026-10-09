/**
 * Agent-relay codebase — module explanation / info.
 * File: src/supervisor/events.ts
 * Purpose: Source module for events.ts.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SupervisorState } from "../types.js";

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

export class MemorySupervisorLogger implements SupervisorLogger {
  readonly events: (SupervisorEvent | RuntimeEvent)[] = [];

  write(event: SupervisorEvent | RuntimeEvent): void {
    this.events.push(event);
  }

  close(): void {
    // nothing to flush for an in-memory logger
  }
}

export const defaultSupervisorLogPath = () => resolve("logs", "supervisor.ndjson");

export class JsonLineSupervisorLogger implements SupervisorLogger {
  private readonly stream;
  private closed = false;

  constructor(private readonly logPath: string = defaultSupervisorLogPath()) {
    mkdirSync(dirname(logPath), { recursive: true });
    this.stream = createWriteStream(logPath, { flags: "a" });
  }

  write(event: SupervisorEvent | RuntimeEvent): void {
    if (this.closed) {
      return;
    }
    this.stream.write(`${JSON.stringify(event)}\n`);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stream.end();
  }
}
