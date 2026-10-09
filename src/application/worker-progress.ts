/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/worker-progress.ts
 * Purpose: Worker progress tracking service.
 */
import type { RelayStore } from "../persistence/index.js";
import { LiveOpenCodeAdapter } from "../adapters/opencode/index.js";
import type { OpenCodeSessionSummary } from "../adapters/opencode/index.js";
import { OpenCodeHttpClient, OpenCodeHttpError, type OpenCodeClientOptions, type OpenCodeMessageInfo } from "../adapters/opencode/http.js";
import type {
  WorkerProgressDto,
  WorkerProgressLive,
  WorkerProgressState,
  WorkerProgressTodo,
  WorkerProgressChangeSummary,
  WorkerProgressFileChange,
  WorkerProgressTimelineEntry,
  WorkerProgressToolCall,
  WorkerProgressSummary
} from "../contracts/worker-progress.js";

export interface WorkerProgressServiceOptions {
  clock?: () => Date;
  coalesceMs?: number;
  maxCoalesceMs?: number;
  maxTimelineEntries?: number;
  maxResponseLength?: number;
  maxToolResultLength?: number;
  onProgressUpdate?: (pairId: string, sessionId: string) => void;
}

interface CacheKey {
  pairId: string;
  sessionId: string;
  endpoint: string;
}

interface PairProgressCache {
  key: CacheKey;
  lastFetchAt: string;
  progress: WorkerProgressDto;
  stale: boolean;
}

function keyString(key: CacheKey): string {
  return JSON.stringify([key.pairId, key.sessionId, key.endpoint]);
}

function keyBelongsTo(key: string, pairId: string, sessionId?: string): boolean {
  const [cachedPairId, cachedSessionId] = JSON.parse(key) as [string, string, string];
  return cachedPairId === pairId && (sessionId === undefined || cachedSessionId === sessionId);
}

function sameKey(left: CacheKey, right: CacheKey): boolean {
  return left.pairId === right.pairId && left.sessionId === right.sessionId && left.endpoint === right.endpoint;
}

function endpointIdentity(baseUrl: string | undefined): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
}

export class WorkerProgressService {
  private readonly clock: () => Date;
  private readonly coalesceMs: number;
  private readonly maxCoalesceMs: number;
  private readonly maxTimelineEntries: number;
  private readonly maxResponseLength: number;
  private readonly maxToolResultLength: number;
  private readonly onProgressUpdate?: (pairId: string, sessionId: string) => void;
  private readonly caches = new Map<string, PairProgressCache>();
  private readonly requestGenerations = new Map<string, number>();
  private readonly pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingCreatedAt = new Map<string, number>();
  private disposed = false;

  constructor(
    private readonly store: RelayStore,
    private readonly defaultOpenCodeOptions: OpenCodeClientOptions = {},
    options: WorkerProgressServiceOptions = {}
  ) {
    if (!store || typeof (store as RelayStore).listCycles !== "function") {
      throw new TypeError("WorkerProgressService requires a valid RelayStore with listCycles.");
    }
    this.clock = options.clock ?? (() => new Date());
    this.coalesceMs = options.coalesceMs ?? 500;
    this.maxCoalesceMs = options.maxCoalesceMs ?? 5_000;
    this.maxTimelineEntries = options.maxTimelineEntries ?? 100;
    this.maxResponseLength = options.maxResponseLength ?? 4000;
    this.maxToolResultLength = options.maxToolResultLength ?? 2000;
    this.onProgressUpdate = options.onProgressUpdate;
  }

  async getProgress(pairId: string, sessionId: string, forceRefresh = false, openCodeOptions?: OpenCodeClientOptions): Promise<WorkerProgressDto> {
    const key = this.cacheKey(pairId, sessionId, openCodeOptions);
    const cacheKey = keyString(key);
    const cached = this.caches.get(cacheKey);

    if (cached && !forceRefresh && !cached.stale) {
      return cached.progress;
    }

    if (cached && !sameKey(cached.key, key)) {
      this.caches.delete(cacheKey);
    }

    const generation = this.nextGeneration(cacheKey);
    try {
      const progress = await this.fetchProgress(pairId, sessionId, openCodeOptions);
      if (this.isCurrentGeneration(cacheKey, generation)) {
        this.caches.set(cacheKey, {
          key,
          lastFetchAt: this.clock().toISOString(),
          progress,
          stale: false
        });
      }
      return progress;
    } catch (error) {
      if (!this.isCurrentGeneration(cacheKey, generation)) {
        return this.caches.get(cacheKey)?.progress ?? this.emptyProgress(pairId, sessionId, error);
      }
      const existing = this.caches.get(cacheKey);
      if (existing) {
        existing.stale = true;
        existing.progress.live.connectionStatus = "disconnected";
        existing.progress.live.stale = true;
        existing.progress.stale = true;
        if (error instanceof OpenCodeHttpError) {
          existing.progress.live.providerError = `HTTP ${error.status}: ${error.statusText}`;
        } else if (error instanceof Error) {
          existing.progress.live.providerError = error.message;
        }
        return existing.progress;
      }
      return this.emptyProgress(pairId, sessionId, error);
    }
  }

  getSummary(pairId: string, sessionId: string): WorkerProgressSummary | undefined {
    const cacheKey = keyString(this.cacheKey(pairId, sessionId));
    const cached = this.caches.get(cacheKey);
    if (!cached) {
      return undefined;
    }
    return {
      pairId,
      state: cached.progress.live.state,
      currentTask: cached.progress.live.currentTask,
      currentTool: cached.progress.live.currentTool,
      elapsedMs: cached.progress.live.elapsedMs,
      stale: cached.stale
    };
  }

  scheduleRefresh(pairId: string, sessionId: string, openCodeOptions?: OpenCodeClientOptions): void {
    if (this.disposed) return;

    const cacheKey = keyString(this.cacheKey(pairId, sessionId, openCodeOptions));
    if (this.pendingUpdates.has(cacheKey)) {
      clearTimeout(this.pendingUpdates.get(cacheKey)!);
    }

    const now = Date.now();
    const createdAt = this.pendingCreatedAt.get(cacheKey) ?? now;
    const elapsed = now - createdAt;
    const delay = Math.min(this.coalesceMs, Math.max(0, this.maxCoalesceMs - elapsed));

    this.pendingCreatedAt.set(cacheKey, createdAt);

    const timer = setTimeout(() => {
      this.pendingUpdates.delete(cacheKey);
      this.pendingCreatedAt.delete(cacheKey);
      void this.getProgress(pairId, sessionId, true, openCodeOptions).then(() => {
        if (!this.disposed && this.onProgressUpdate) {
          this.onProgressUpdate(pairId, sessionId);
        }
      });
    }, delay);

    this.pendingUpdates.set(cacheKey, timer);
  }

  invalidate(pairId: string, sessionId?: string): void {
    const identities = new Set([...this.caches.keys(), ...this.requestGenerations.keys()]);
    if (sessionId) {
      for (const key of identities) {
        if (keyBelongsTo(key, pairId, sessionId)) {
          this.invalidateKey(key);
        }
      }
    } else {
      for (const key of identities) {
        if (keyBelongsTo(key, pairId)) {
          this.invalidateKey(key);
        }
      }
    }

    for (const [key, timer] of this.pendingUpdates) {
      if (keyBelongsTo(key, pairId, sessionId)) {
        clearTimeout(timer);
        this.pendingUpdates.delete(key);
        this.pendingCreatedAt.delete(key);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.pendingUpdates.values()) {
      clearTimeout(timer);
    }
    this.pendingUpdates.clear();
    this.pendingCreatedAt.clear();
    this.caches.clear();
    this.requestGenerations.clear();
  }

  private cacheKey(pairId: string, sessionId: string, openCodeOptions?: OpenCodeClientOptions): CacheKey {
    const options = { ...this.defaultOpenCodeOptions, ...openCodeOptions };
    return { pairId, sessionId, endpoint: endpointIdentity(options.baseUrl) };
  }

  private nextGeneration(cacheKey: string): number {
    const generation = (this.requestGenerations.get(cacheKey) ?? 0) + 1;
    this.requestGenerations.set(cacheKey, generation);
    return generation;
  }

  private isCurrentGeneration(cacheKey: string, generation: number): boolean {
    return this.requestGenerations.get(cacheKey) === generation;
  }

  private invalidateKey(cacheKey: string): void {
    this.nextGeneration(cacheKey);
    this.caches.delete(cacheKey);
  }

  private emptyProgress(pairId: string, sessionId: string, error?: unknown): WorkerProgressDto {
    return {
      pairId,
      sessionId,
      fetchedAt: this.clock().toISOString(),
      stale: true,
      live: {
        state: "disconnected",
        connectionStatus: "disconnected",
        sseConnected: false,
        stale: true,
        providerError: error instanceof Error ? error.message : error ? String(error) : undefined
      },
      plan: [],
      changes: { files: [], totalAdditions: 0, totalDeletions: 0 },
      history: []
    };
  }

  private async fetchProgress(pairId: string, sessionId: string, openCodeOptions?: OpenCodeClientOptions): Promise<WorkerProgressDto> {
    const options = { ...this.defaultOpenCodeOptions, ...openCodeOptions };
    const client = new OpenCodeHttpClient(options);

    const sessionPromise = client.getSession(sessionId);
    const messagesPromise = client.listSessionMessages(sessionId);
    const historyPromise = client.history(sessionId);
    const activePromise = client.listActiveSessions();

    const [session, messages, history, activeSessions] = await Promise.all([
      sessionPromise,
      messagesPromise,
      historyPromise,
      activePromise
    ]);

    const cycles = this.store.listCycles(pairId);
    const sorted = chronological(messages);
    const isActive = sessionActiveIn(activeSessions, sessionId);

    const live = this.buildLiveState(sorted, isActive, session, cycles);
    const plan = this.buildPlan(history.data ?? []);
    const changes = this.buildChanges(session, sorted);
    const historyEntries = this.buildTimeline(sorted, cycles, history.data ?? []);

    const currentCycle = [...cycles].reverse().find(
      (c) => c.cycleStatus === "DISPATCHED" && !c.workerCompletedAt
    );

    return {
      pairId,
      sessionId,
      sessionTitle: session?.title,
      repoPath: session?.location?.project?.canonical ?? session?.location?.project?.directory,
      fetchedAt: this.clock().toISOString(),
      stale: live.stale === true,
      live,
      plan,
      changes,
      history: historyEntries.slice(-this.maxTimelineEntries),
      currentCycleId: currentCycle?.id
    };
  }

  private buildLiveState(
    messages: OpenCodeMessageInfo[],
    isActive: boolean,
    session: { time?: { created?: number; updated?: number; idle?: number } } | undefined,
    cycles: Array<{ cycleStatus: string; dispatchedAt?: string; workerCompletedAt?: string }>
  ): WorkerProgressLive {
    const now = this.clock();
    const latest = messages.at(-1);
    const latestRole = roleOf(latest);
    const latestFinish = latest?.info?.finish ?? latest?.finish;

    const currentCycle = [...cycles].reverse().find(
      (cycle) => cycle.cycleStatus === "DISPATCHED" && !cycle.workerCompletedAt
    );
    const isCyclePending = currentCycle !== undefined;
    const isCycleActive = Boolean(isCyclePending && isActive);
    const stalePendingCycle = Boolean(isCyclePending && !isActive);
    const hasError = latestFinish === "error" || latest?.error;

    const currentTool = detectCurrentTool(messages);
    const currentFile = detectCurrentFile(messages);
    const latestResponse = extractAssistantText(messages);

    let state: WorkerProgressState;
    if (hasError) {
      state = "failed";
    } else if (isCycleActive) {
      state = "working";
    } else if (stalePendingCycle) {
      state = "waiting";
    } else if (isActive) {
      state = "working";
    } else if (latestRole === "assistant" && latestFinish === "stop") {
      state = "completed";
    } else if (messages.length > 0) {
      state = "idle";
    } else {
      state = "idle";
    }

    const startedAt = isCycleActive && currentCycle?.dispatchedAt ? currentCycle.dispatchedAt : undefined;
    const elapsedMs = startedAt ? now.getTime() - Date.parse(startedAt) : undefined;

    const latestCreatedAt = messageCreatedAt(latest);

    const currentTask = extractCurrentTask(messages);

    return {
      state,
      currentTask,
      currentTool,
      currentFile,
      startedAt,
      elapsedMs: elapsedMs && elapsedMs > 0 ? elapsedMs : undefined,
      latestResponse: latestResponse ? truncate(latestResponse, this.maxResponseLength) : undefined,
      latestResponseTruncated: latestResponse ? latestResponse.length > this.maxResponseLength : undefined,
      inputRequired: stalePendingCycle
        ? "Worker is not active; verify the dispatched cycle."
        : latestRole === "user" && !isActive
          ? "Waiting for worker input"
          : undefined,
      providerError: hasError ? extractError(latest) : undefined,
      connectionStatus: "connected",
      sseConnected: false,
      lastEventAt: timestampToIso(latestCreatedAt),
      stale: stalePendingCycle
    };
  }

  private buildPlan(events: Array<{ type: string; data?: Record<string, unknown>; time?: number }>): WorkerProgressTodo[] {
    const todos: WorkerProgressTodo[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      if (event.type.includes("todo")) {
        const data = event.data ?? {};
        const id = String(data.id ?? `todo-${todos.length}`);
        if (seen.has(id)) continue;
        seen.add(id);
        todos.push({
          id,
          content: String(data.content ?? data.text ?? ""),
          status: mapTodoStatus(data.status),
          createdAt: timestampToIso(eventTimestamp(event)),
          updatedAt: timestampToIso(eventTimestamp(event))
        });
      }
    }
    return todos;
  }

  private buildChanges(
    session: { time?: { created?: number } } | undefined,
    messages: OpenCodeMessageInfo[]
  ): WorkerProgressChangeSummary {
    const files: WorkerProgressFileChange[] = [];
    const toolMessages = messages.filter((m) => {
      const role = roleOf(m);
      return role === "assistant" && (m.info?.finish ?? m.finish) === "tool-calls";
    });

    for (const msg of toolMessages) {
      const parts = extractToolParts(msg);
      for (const part of parts) {
        if (part.type === "file" || part.name === "write_file" || part.name === "create_file") {
          const candidate = part.path ?? part.arguments?.filePath ?? part.arguments?.file_path;
          const path = typeof candidate === "string" ? candidate : "";
          if (path && !files.some((f) => f.path === path)) {
            files.push({ path, status: "modified" });
          }
        }
      }
    }

    return {
      files,
      totalAdditions: files.filter((f) => f.status === "added").length,
      totalDeletions: files.filter((f) => f.status === "deleted").length,
      sessionStartedAt: timestampToIso(session?.time?.created)
    };
  }

  private buildTimeline(
    messages: OpenCodeMessageInfo[],
    cycles: Array<{
      id: number;
      plannerSourceMessageId: string;
      workerDispatchMessageId: string;
      dispatchedAt?: string;
      workerResponseMessageId?: string;
      workerCompletedAt?: string;
      cycleStatus: string;
    }>,
    durableEvents: Array<{ id: number | string; type: string; time?: number; data?: Record<string, unknown> }>
  ): WorkerProgressTimelineEntry[] {
    const entries: WorkerProgressTimelineEntry[] = [];

    for (const cycle of cycles) {
      if (cycle.dispatchedAt) {
        entries.push({
          id: `cycle-dispatch-${cycle.id}`,
          type: "prompt_dispatched",
          timestamp: cycle.dispatchedAt,
          summary: `Planner prompt dispatched to worker`,
          relatedMessageId: cycle.workerDispatchMessageId
        });
      }
      if (cycle.workerCompletedAt) {
        entries.push({
          id: `cycle-complete-${cycle.id}`,
          type: "worker_completed",
          timestamp: cycle.workerCompletedAt,
          summary: `Worker completed processing`,
          relatedMessageId: cycle.workerResponseMessageId
        });
      }
    }

    for (const msg of messages) {
      const role = roleOf(msg);
      const msgId = msg.info?.id ?? msg.id;
      const createdAt = messageCreatedAt(msg);

      const timestamp = timestampToIso(createdAt);
      if (!msgId || !timestamp) continue;

      if (role === "assistant") {
        const text = textFromMessage(msg);
        const toolCalls = extractToolParts(msg);
        const hasToolCalls = toolCalls.length > 0;
        const finish = msg.info?.finish ?? msg.finish;

        entries.push({
          id: `msg-${msgId}`,
          type: "assistant_response",
          timestamp,
          summary: text ? truncate(text, 200) : (hasToolCalls ? "Processing tool calls" : "Response received"),
          detail: text ? truncate(text, 500) : undefined,
          isTruncated: text ? text.length > 200 : false,
          relatedMessageId: msgId
        });

        if (hasToolCalls) {
          for (const part of toolCalls) {
            entries.push({
              id: `tool-${msgId}-${part.name}`,
              type: "tool_call",
              timestamp,
              summary: `Tool: ${part.name}`,
              detail: part.arguments ? truncate(JSON.stringify(part.arguments), this.maxToolResultLength) : undefined,
              toolName: part.name,
              isTruncated: part.arguments ? JSON.stringify(part.arguments).length > this.maxToolResultLength : false,
              relatedMessageId: msgId
            });
          }
        }

        if (finish === "error") {
          entries.push({
            id: `error-${msgId}`,
            type: "provider_error",
            timestamp,
            summary: extractError(msg) ?? "Provider error",
            isError: true,
            relatedMessageId: msgId
          });
        }
      }

      if (role === "user") {
        entries.push({
          id: `user-${msgId}`,
          type: "user_message",
          timestamp,
          summary: "User message",
          relatedMessageId: msgId
        });
      }
    }

    for (const event of durableEvents) {
      const eventType = String(event.type ?? "").toLowerCase();
      if (eventType.includes("step.started")) {
        const timestamp = timestampToIso(eventTimestamp(event));
        if (!timestamp) continue;
        entries.push({
          id: `durable-${event.id}`,
          type: "status_update",
          timestamp,
          summary: "Worker step started"
        });
      }
    }

    entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    return entries.slice(0, this.maxTimelineEntries);
  }
}

function roleOf(message: OpenCodeMessageInfo | undefined): "user" | "assistant" | undefined {
  const role = message?.info?.role ?? message?.role ?? message?.type;
  return role === "user" || role === "assistant" ? role : undefined;
}

function messageCreatedAt(message: OpenCodeMessageInfo | undefined): number | undefined {
  if (!message) return undefined;
  return message.metadata?.time?.created ?? message.info?.time?.created ?? message.time?.created;
}

function eventTimestamp(event: { time?: number; data?: Record<string, unknown> }): unknown {
  return event.time ?? event.data?.timestamp;
}

/** OpenCode has emitted Unix timestamps in both seconds and milliseconds. */
function timestampToIso(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) return timestampToIso(numeric);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function textFromMessage(message: OpenCodeMessageInfo): string | undefined {
  if (typeof message.text === "string") return message.text.trim() || undefined;
  for (const value of [message.content, message.parts, message.message]) {
    const text = textFromUnknown(value);
    if (text) return text;
  }
  return undefined;
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("\n").trim() || undefined;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text.trim() || undefined;
    if (typeof record.content === "string") return record.content.trim() || undefined;
    if (record.type === "text" && typeof record.value === "string") return record.value.trim() || undefined;
  }
  return undefined;
}

function chronological(messages: OpenCodeMessageInfo[]): OpenCodeMessageInfo[] {
  return [...messages].sort((a, b) => (messageCreatedAt(a) ?? 0) - (messageCreatedAt(b) ?? 0));
}

function sessionActiveIn(active: Record<string, unknown>, sessionId: string): boolean {
  for (const value of Object.values(active)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (record.sessionID === sessionId || record.sessionId === sessionId || record.id === sessionId) return true;
  }
  return active[sessionId] !== undefined;
}

function extractAssistantText(messages: OpenCodeMessageInfo[]): string | undefined {
  const assistantMessages = messages.filter((m) => roleOf(m) === "assistant");
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const text = textFromMessage(assistantMessages[i]);
    if (text) return text;
  }
  return undefined;
}

function detectCurrentTool(messages: OpenCodeMessageInfo[]): string | undefined {
  const assistantMessages = messages.filter((m) => roleOf(m) === "assistant");
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const parts = extractToolParts(assistantMessages[i]);
    if (parts.length > 0) {
      return parts[parts.length - 1].name;
    }
  }
  return undefined;
}

function detectCurrentFile(messages: OpenCodeMessageInfo[]): string | undefined {
  const assistantMessages = messages.filter((m) => roleOf(m) === "assistant");
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const parts = extractToolParts(assistantMessages[i]);
    for (const part of parts) {
      const candidate = part.path ?? part.arguments?.filePath ?? part.arguments?.file_path;
      if (typeof candidate === "string") return candidate;
    }
  }
  return undefined;
}

function extractToolParts(
  message: OpenCodeMessageInfo
): Array<{ name: string; arguments?: Record<string, unknown>; path?: string; type?: string }> {
  const content = message.content ?? message.parts ?? message.message;
  if (!Array.isArray(content)) return [];

  const parts: Array<{ name: string; arguments?: Record<string, unknown>; path?: string; type?: string }> = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const part = item as Record<string, unknown>;
    if (part.type === "tool_use" || part.type === "tool_call") {
      parts.push({
        name: String(part.name ?? part.tool ?? ""),
        arguments: typeof part.input === "object" && part.input !== null ? (part.input as Record<string, unknown>) : undefined,
        path: typeof part.path === "string" ? part.path : undefined,
        type: typeof part.type === "string" ? part.type : undefined
      });
    }
  }
  return parts;
}

function extractCurrentTask(messages: OpenCodeMessageInfo[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (roleOf(msg) === "assistant") {
      const text = textFromMessage(msg);
      if (text) {
        const firstLine = text.split("\n")[0];
        if (firstLine.length < 200) return firstLine;
        return firstLine.slice(0, 150) + "...";
      }
    }
  }
  return undefined;
}

function extractError(message: OpenCodeMessageInfo | undefined): string | undefined {
  if (!message) return undefined;
  const error = message.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") return error.message ?? "Unknown error";
  return undefined;
}

function mapTodoStatus(status: unknown): "pending" | "in_progress" | "completed" | "blocked" {
  const s = String(status ?? "").toLowerCase();
  if (s === "in_progress" || s === "in-progress" || s === "active") return "in_progress";
  if (s === "completed" || s === "done") return "completed";
  if (s === "blocked" || s === "waiting") return "blocked";
  return "pending";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
