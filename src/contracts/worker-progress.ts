/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/worker-progress.ts
 * Purpose: Worker progress tracking service.
 */
export type WorkerProgressState =
  | "working"
  | "idle"
  | "completed"
  | "failed"
  | "disconnected"
  | "reconnecting"
  | "waiting";

export interface WorkerProgressTodo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  createdAt?: string;
  updatedAt?: string;
}

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface WorkerProgressFileChange {
  path: string;
  status: FileChangeStatus;
  oldPath?: string;
  additions?: number;
  deletions?: number;
}

export interface WorkerProgressChangeSummary {
  files: WorkerProgressFileChange[];
  totalAdditions: number;
  totalDeletions: number;
  sessionStartedAt?: string;
}

export interface WorkerProgressToolCall {
  id: string;
  name: string;
  arguments?: string;
  result?: string;
  startedAt?: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  error?: string;
}

export interface WorkerProgressTimelineEntry {
  id: string;
  type:
    | "prompt_dispatched"
    | "user_message"
    | "assistant_response"
    | "tool_call"
    | "tool_result"
    | "provider_error"
    | "recovery_attempt"
    | "worker_completed"
    | "delivery_completed"
    | "delivery_failed"
    | "delivery_blocked"
    | "input_required"
    | "status_update";
  timestamp: string;
  summary: string;
  detail?: string;
  toolName?: string;
  isError?: boolean;
  isTruncated?: boolean;
  relatedMessageId?: string;
}

export interface WorkerProgressLive {
  state: WorkerProgressState;
  currentTask?: string;
  currentTool?: string;
  currentFile?: string;
  startedAt?: string;
  elapsedMs?: number;
  latestResponse?: string;
  latestResponseTruncated?: boolean;
  inputRequired?: string;
  providerError?: string;
  connectionStatus: "connected" | "degraded" | "disconnected";
  sseConnected: boolean;
  lastEventAt?: string;
  stale?: boolean;
}

export interface WorkerProgressDto {
  pairId: string;
  sessionId: string;
  sessionTitle?: string;
  repoPath?: string;
  fetchedAt: string;
  stale: boolean;
  live: WorkerProgressLive;
  plan: WorkerProgressTodo[];
  changes: WorkerProgressChangeSummary;
  history: WorkerProgressTimelineEntry[];
  currentCycleId?: number;
}

export interface WorkerProgressSummary {
  pairId: string;
  state: WorkerProgressState;
  currentTask?: string;
  currentTool?: string;
  elapsedMs?: number;
  stale: boolean;
}
