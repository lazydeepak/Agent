/**
 * Agent-relay codebase — module explanation / info.
 * File: src/adapters/opencode/index.ts
 * Purpose: OpenCode adapter exports (session management, readiness, event source).
 */
import { resolve } from "node:path";
import { hashText } from "../../util/canonical.js";
import type {
  OpenCodeServerConfig,
  ReadinessCheck,
  RelayReceipt,
  RelayableMessage,
  WorkerIdentity,
  WorkerObservation,
  WorkerPromptState,
  OpenCodeModelRef,
  OpenCodeModelInfo
} from "../../types.js";
import { fail, pass } from "../../util/readiness.js";
import {
  OpenCodeHttpClient,
  OpenCodeHttpError,
  type OpenCodeClientOptions,
  type OpenCodeDurableEvent,
  type OpenCodeHistoryResult,
  type OpenCodeMessageInfo,
  type OpenCodePromptAdmission,
  type OpenCodeSessionInfo
} from "./http.js";

export {
  HttpOpenCodeEventSource,
  type OpenCodeEventSource,
  type OpenCodeEventSourceOptions,
  type OpenCodeSessionEvent
} from "./event-source.js";

export interface OpenCodeAdapter {
  checkReadiness(worker: WorkerIdentity): Promise<ReadinessCheck[]>;
}

export interface OpenCodeSessionSummary {
  sessionId: string;
  title?: string;
  repoPath?: string;
  updatedAt?: number;
  model?: OpenCodeModelRef;
}

export interface OpenCodeSessionManager extends OpenCodeAdapter {
  setAbortSignal?(signal: AbortSignal | undefined): void;
  checkServer(): Promise<unknown>;
  listSessions(options?: { repoPath?: string; limit?: number }): Promise<OpenCodeSessionSummary[]>;
  listActiveSessions(): Promise<Record<string, unknown>>;
  getSession(sessionId: string): Promise<OpenCodeSessionSummary | undefined>;
  listModels(): Promise<OpenCodeModelInfo[]>;
  switchSessionModel(worker: WorkerIdentity, model: OpenCodeModelRef): Promise<void>;
  getLatestAssistantMessage(worker: WorkerIdentity): Promise<RelayableMessage | undefined>;
  getAssistantResponseForDispatch?(
    worker: WorkerIdentity,
    dispatchMessageId: string,
    dispatchedAt?: string
  ): Promise<RelayableMessage | undefined>;
  getDispatchFailure?(worker: WorkerIdentity, dispatchMessageId: string, dispatchedAt?: string): Promise<string | undefined>;
  sendPlannerMessage(worker: WorkerIdentity, message: RelayableMessage): Promise<RelayReceipt>;
  selectSession?(sessionId: string): Promise<void>;
  createSession(input: { repoPath: string; title?: string; sessionId?: string }): Promise<OpenCodeSessionSummary>;
  bindSession(worker: WorkerIdentity, sessionId: string): WorkerIdentity;
  observeWorkerSession?(worker: WorkerIdentity): Promise<WorkerObservation>;
}

export class FakeOpenCodeAdapter implements OpenCodeAdapter {
  async checkReadiness(worker: WorkerIdentity): Promise<ReadinessCheck[]> {
    const overrides = worker.readiness ?? {};

    return [
      fakeCheck("worker.serverReachable", overrides, "OpenCode server was reachable."),
      fakeCheck("worker.sessionExists", overrides, "OpenCode session exists."),
      fakeCheck("worker.repoMatches", overrides, `OpenCode session is attached to ${worker.repoPath}.`),
      fakeCheck("worker.acceptsInput", overrides, "OpenCode session accepts input.")
    ];
  }
}

export class LiveOpenCodeAdapter implements OpenCodeAdapter, OpenCodeSessionManager {
  private readonly client: OpenCodeHttpClient;
  private readonly promotionTimeoutMs: number;
  private readonly promotionPollMs: number;

  constructor(server: OpenCodeClientOptions = {}, options: { promotionTimeoutMs?: number; promotionPollMs?: number } = {}) {
    this.client = new OpenCodeHttpClient(server);
    this.promotionTimeoutMs = options.promotionTimeoutMs ?? 15_000;
    this.promotionPollMs = options.promotionPollMs ?? 500;
  }

  setAbortSignal(signal: AbortSignal | undefined): void {
    this.client.setAbortSignal(signal);
  }

  async checkServer(): Promise<unknown> {
    try {
      return await this.client.health();
    } catch (error) {
      if (error instanceof OpenCodeHttpError && error.status === 401) {
        throw new Error(
          `OpenCode server at ${this.client.url} requires authentication (username/password). ` +
          `Set AGENT_RELAY_OPENCODE_USERNAME and AGENT_RELAY_OPENCODE_PASSWORD, or configure ` +
          `opencode.username and opencode.password in the desktop service options.`
        );
      }
      throw new Error(`OpenCode server unreachable: ${readableOpenCodeError(error)}`);
    }
  }

  async healthWithTimeout(timeoutMs: number = 5000): Promise<unknown> {
    const signal = AbortSignal.timeout(timeoutMs);
    this.setAbortSignal(signal);
    try {
      return await this.client.health();
    } catch (error) {
      throw new Error(`OpenCode server unreachable within ${timeoutMs}ms: ${readableOpenCodeError(error)}`);
    } finally {
      this.setAbortSignal(undefined);
    }
  }

  async listSessions(options: { repoPath?: string; limit?: number } = {}): Promise<OpenCodeSessionSummary[]> {
    const sessions = await this.client.listSessions(options);
    return sessions.data.map(toSessionSummary);
  }

  async listActiveSessions(): Promise<Record<string, unknown>> {
    return this.client.listActiveSessions();
  }

  async getSession(sessionId: string): Promise<OpenCodeSessionSummary | undefined> {
    try {
      const session = await this.client.getSession(sessionId);
      return toSessionSummary(session);
    } catch (error) {
      if (error instanceof OpenCodeHttpError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  async listModels(): Promise<OpenCodeModelInfo[]> {
    return this.client.listModels();
  }

  async switchSessionModel(worker: WorkerIdentity, model: OpenCodeModelRef): Promise<void> {
    await this.client.switchSessionModel(worker.sessionId, model);
  }

  async selectSession(sessionId: string): Promise<void> {
    await this.client.selectSession(sessionId);
  }

  async getLatestAssistantMessage(worker: WorkerIdentity): Promise<RelayableMessage | undefined> {
    const messages = chronological(await this.client.listSessionMessages(worker.sessionId));
    const assistantMessages = messages.map(toRelayableAssistantMessage).filter(isDefined);
    return assistantMessages.at(-1);
  }

  async getAssistantResponseForDispatch(
    worker: WorkerIdentity,
    dispatchMessageId: string,
    dispatchedAt?: string
  ): Promise<RelayableMessage | undefined> {
    const messages = chronological(await this.client.listSessionMessages(worker.sessionId));
    const dispatchIndex = messages.findIndex((message) => messageId(message) === dispatchMessageId);
    const dispatchedAtMs = dispatchedAt ? Date.parse(dispatchedAt) : undefined;
    const candidates = messages.filter((message, index) => {
      if (roleOfMessage(message) !== "assistant" || !messageCompleted(message)) {
        return false;
      }
      const parentId = messageParentId(message);
      if (parentId) {
        return parentId === dispatchMessageId;
      }
      if (dispatchIndex >= 0) {
        if (index <= dispatchIndex) {
          return false;
        }
        const nextUser = messages.slice(dispatchIndex + 1, index).some((candidate) => roleOfMessage(candidate) === "user");
        return !nextUser;
      }
      const createdAt = messageCreatedAt(message);
      return dispatchedAtMs !== undefined && createdAt !== undefined && createdAt >= dispatchedAtMs;
    });
    return candidates.map(toRelayableAssistantMessage).filter(isDefined).at(-1);
  }

  async getDispatchFailure(
    worker: WorkerIdentity,
    dispatchMessageId: string,
    dispatchedAt?: string
  ): Promise<string | undefined> {
    const messages = chronological(await this.client.listSessionMessages(worker.sessionId));
    const failed = dispatchMessages(messages, dispatchMessageId, dispatchedAt).find((message) =>
      roleOfMessage(message) === "assistant" && (message.info?.finish ?? message.finish) === "error"
    );
    if (!failed) return undefined;
    const error = failed.error;
    return typeof error === "string" ? error : error?.message ?? "OpenCode worker step failed.";
  }

  async sendPlannerMessage(worker: WorkerIdentity, message: RelayableMessage) {
    const msgId = plannerMessageId(message);
    const admission = await this.client.submitPrompt(worker.sessionId, {
      id: msgId,
      text: message.text,
      delivery: "queue",
      resume: true
    });

    const workerDispatchMessageId = admission.id && admission.id !== "" ? admission.id : msgId;
    const deliveredAt = new Date().toISOString();

    const promotion = await this.waitForPromotion(worker.sessionId, workerDispatchMessageId);

    return {
      pairId: "",
      sourceMessageId: message.id,
      targetId: workerDispatchMessageId,
      workerDispatchMessageId,
      workerPromptState: promotion.state,
      workerStartBlocked: promotion.startBlocked,
      workerStartBlockedReason: promotion.reason,
      delivered: promotion.state !== "PERSISTED",
      deliveredAt,
      transport: "opencode-http"
    };
  }

  private async waitForPromotion(
    sessionId: string,
    dispatchMessageId: string
  ): Promise<{ state: WorkerPromptState; startBlocked: boolean; reason?: string }> {
    const deadline = Date.now() + this.promotionTimeoutMs;
    const isV2 = await this.client.supportsPromptEndpoint();
    const history: { events: OpenCodeDurableEvent[]; after?: number } = { events: [] };

    do {
      const promoted = await this.isMessagePromoted(sessionId, dispatchMessageId, history);
      if (promoted) {
        return { state: "PROMOTED", startBlocked: false };
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.promotionPollMs));
    } while (Date.now() < deadline);

    if (isV2) {
      return {
        state: "ADMITTED",
        startBlocked: true,
        reason:
          `Prompt ${dispatchMessageId} was durably admitted to session ${sessionId} but did not start within ` +
          `${this.promotionTimeoutMs}ms. The worker may be blocked on scheduling or permission confirmation.`
      };
    }

    return { state: "PERSISTED", startBlocked: false };
  }

  private async isMessagePromoted(sessionId: string, dispatchMessageId: string,
    history: { events: OpenCodeDurableEvent[]; after?: number }): Promise<boolean> {
    if (!(await this.client.isV2Api())) {
      try {
        return sessionActiveIn(await this.client.listActiveSessions(), sessionId);
      } catch {
        return false;
      }
    }

    try {
      for (let page = 0; page < 100; page++) {
        const result = await this.client.history(sessionId, history.after);
        history.events.push(...(result.data ?? []));
        if (durableHistoryShowsPromotion({ data: history.events }, dispatchMessageId)) return true;
        const last = result.data?.at(-1);
        const next = last?.durable?.seq ?? (typeof last?.id === "number" ? last.id : undefined);
        if (next === undefined || (history.after !== undefined && next <= history.after)) return false;
        history.after = next;
        if (!result.hasMore) return false;
      }
      return false;
    } catch {
      return false;
    }
  }

  async createSession(input: {
    repoPath: string;
    title?: string;
    sessionId?: string;
  }): Promise<OpenCodeSessionSummary> {
    return toSessionSummary(await this.client.createSession(input));
  }

  bindSession(worker: WorkerIdentity, sessionId: string): WorkerIdentity {
    return {
      ...worker,
      sessionId
    };
  }

  async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    const detail: string[] = [];

    try {
      await this.client.health();
    } catch (error) {
      detail.push(`health: ${readableOpenCodeError(error)}`);
      return {
        reachable: false,
        sessionExists: false,
        sessionActive: false,
        gathering: false,
        detail
      };
    }

    let sessionExists = true;
    try {
      await this.client.getSession(worker.sessionId);
    } catch (error) {
      if (!(error instanceof OpenCodeHttpError && error.status === 404)) {
        throw error;
      }
      sessionExists = false;
      detail.push(`session: ${readableOpenCodeError(error)}`);
    }

    if (!sessionExists) {
      return { reachable: true, sessionExists: false, sessionActive: false, gathering: false, detail };
    }

    let sessionActive = false;
    let running = false;
    try {
      sessionActive = sessionActiveIn(await this.client.listActiveSessions(), worker.sessionId);
      running = sessionActive;
    } catch (error) {
      throw new Error(`active: ${readableOpenCodeError(error)}`, { cause: error });
    }

    let messages: OpenCodeMessageInfo[] = [];
    try {
      messages = chronological(await this.client.listSessionMessages(worker.sessionId));
    } catch (error) {
      throw new Error(`messages: ${readableOpenCodeError(error)}`, { cause: error });
    }

    const latest = messages.at(-1);
    const latestRole = roleOfMessage(latest);
    const assistant = lastAssistantMessage(messages);
    const assistantText = assistant ? toRelayableAssistantMessage(assistant)?.text : undefined;
    const parts = assistant?.content ?? assistant?.parts;
    const waitingForInput = Array.isArray(parts) && parts.some((part) => {
      if (!part || typeof part !== "object") return false;
      const tool = part as { type?: string; name?: string; tool?: string; state?: { status?: string } };
      return tool.type === "tool" && (tool.name ?? tool.tool) === "question" &&
        (tool.state?.status === "running" || tool.state?.status === "pending");
    });

    return {
      reachable: true,
      sessionExists,
      sessionActive,
      running,
      gathering: running,
      waitingForInput,
      latestMessageId: messageId(latest),
      latestMessageRole: latestRole,
      latestMessageCreatedAt: messageCreatedAt(latest),
      lastAssistantMessageId: assistant ? messageId(assistant) : undefined,
      lastAssistantMessageCreatedAt: assistant ? messageCreatedAt(assistant) : undefined,
      lastAssistantMessageHash: assistantText ? hashText(assistantText) : undefined,
      detail
    };
  }

  async checkReadiness(worker: WorkerIdentity): Promise<ReadinessCheck[]> {
    const checks: ReadinessCheck[] = [];
    const sessionId = worker.sessionId;
    let session: OpenCodeSessionInfo | undefined;

    try {
      await this.client.health();
      checks.push(pass("worker.serverReachable", `OpenCode server ${this.client.url} was reachable.`));
    } catch (error) {
      return [
        fail("worker.serverReachable", `OpenCode server was not reachable: ${readableOpenCodeError(error)}`),
        fail("worker.sessionExists", "OpenCode session could not be checked because the server was unreachable."),
        fail("worker.repoMatches", "OpenCode session repo could not be checked because the server was unreachable."),
        fail("worker.acceptsInput", "OpenCode input readiness could not be checked because the server was unreachable.")
      ];
    }

    try {
      session = await this.client.getSession(sessionId);
      checks.push(pass("worker.sessionExists", `OpenCode session ${sessionId} exists.`));
    } catch (error) {
      checks.push(fail("worker.sessionExists", `OpenCode session ${sessionId} was not found: ${readableOpenCodeError(error)}`));
    }

    if (session) {
      const actualRepoPath = repoPathForSession(session);
      if (actualRepoPath && samePath(actualRepoPath, worker.repoPath)) {
        checks.push(pass("worker.repoMatches", `OpenCode session is attached to ${resolve(worker.repoPath)}.`));
      } else {
        checks.push(
          fail(
            "worker.repoMatches",
            actualRepoPath
              ? `OpenCode session is attached to ${actualRepoPath}, not ${resolve(worker.repoPath)}.`
              : "OpenCode session did not expose an attached repo path."
          )
        );
      }
    } else {
      checks.push(fail("worker.repoMatches", "OpenCode session repo could not be checked because the session was missing."));
    }

    try {
      await this.client.listActiveSessions();
      checks.push(pass("worker.acceptsInput", "OpenCode session status endpoint was reachable; no prompt was sent."));
    } catch (error) {
      checks.push(
        fail("worker.acceptsInput", `OpenCode session status endpoint was not reachable: ${readableOpenCodeError(error)}`)
      );
    }

    return checks;
  }
}

export class StaticOpenCodeAdapter extends FakeOpenCodeAdapter implements OpenCodeSessionManager {
  readonly sentPlannerMessages: Array<{ worker: WorkerIdentity; message: RelayableMessage }> = [];

  constructor(private readonly messages: RelayableMessage[] = []) {
    super();
  }

  async checkServer(): Promise<unknown> {
    return { fake: true };
  }

  async listSessions(): Promise<OpenCodeSessionSummary[]> {
    return [];
  }

  async listActiveSessions(): Promise<Record<string, unknown>> {
    return {};
  }

  async listModels(): Promise<OpenCodeModelInfo[]> {
    return [];
  }

  async switchSessionModel(_worker: WorkerIdentity, _model: OpenCodeModelRef): Promise<void> {
    throw new Error("Static OpenCode adapter cannot switch session models.");
  }

  async getSession(sessionId: string): Promise<OpenCodeSessionSummary | undefined> {
    return { sessionId };
  }

  async selectSession(): Promise<void> {
    return;
  }

  async getLatestAssistantMessage(_worker: WorkerIdentity): Promise<RelayableMessage | undefined> {
    return this.messages.at(-1);
  }

  async getAssistantResponseForDispatch(
    _worker: WorkerIdentity,
    dispatchMessageId: string,
    dispatchedAt?: string
  ): Promise<RelayableMessage | undefined> {
    const dispatchIndex = this.messages.findIndex((message) => message.id === dispatchMessageId);
    return this.messages.find((message, index) =>
      message.role === "assistant" &&
      (dispatchIndex >= 0 ? index > dispatchIndex : dispatchedAt !== undefined && (message.createdAt ?? 0) >= Date.parse(dispatchedAt))
    );
  }

  async sendPlannerMessage(worker: WorkerIdentity, message: RelayableMessage) {
    this.sentPlannerMessages.push({ worker, message });

    return {
      pairId: "",
      sourceMessageId: message.id,
      targetId: worker.sessionId,
      delivered: true,
      deliveredAt: new Date().toISOString(),
      transport: "static-opencode"
    };
  }

  async createSession(): Promise<OpenCodeSessionSummary> {
    throw new Error("Static OpenCode adapter cannot create sessions.");
  }

  bindSession(worker: WorkerIdentity, sessionId: string): WorkerIdentity {
    return { ...worker, sessionId };
  }

  async observeWorkerSession(_worker: WorkerIdentity): Promise<WorkerObservation> {
    const latest = this.messages.at(-1);
    const assistant = lastRelayableAssistantMessage(this.messages);

    return {
      reachable: true,
      sessionExists: true,
      sessionActive: true,
      running: true,
      gathering: latest?.role === "user",
      latestMessageId: latest?.id,
      latestMessageRole: latest?.role === "user" || latest?.role === "assistant" ? latest.role : undefined,
      latestMessageCreatedAt: latest?.createdAt,
      lastAssistantMessageId: assistant?.id,
      lastAssistantMessageCreatedAt: assistant?.createdAt,
      lastAssistantMessageHash: assistant ? hashText(assistant.text) : undefined,
      detail: []
    };
  }
}

function fakeCheck(
  name: string,
  overrides: Record<string, boolean | string>,
  successReason: string
): ReadinessCheck {
  const override = overrides[name];

  if (override === undefined || override === true) {
    return pass(name, successReason);
  }

  return fail(name, typeof override === "string" ? override : `${name} failed in fake adapter.`);
}

function toSessionSummary(session: OpenCodeSessionInfo): OpenCodeSessionSummary {
  return {
    sessionId: session.id ?? (session as any).sessionId,
    title: session.title,
    repoPath: repoPathForSession(session),
    updatedAt: session.time?.updated ?? (session as any).updatedAt ?? (session as any).updated,
    model: session.model
  };
}

function repoPathForSession(session: OpenCodeSessionInfo): string | undefined {
  return (
    session.location?.project?.canonical ??
    session.location?.project?.directory ??
    session.location?.directory ??
    session.directory ??
    (session as any).repoPath
  );
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function readableOpenCodeError(error: unknown): string {
  if (error instanceof OpenCodeHttpError && error.status === 401) {
    return "server requires authentication";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toRelayableAssistantMessage(message: OpenCodeMessageInfo): RelayableMessage | undefined {
  const role = message.info?.role ?? message.role ?? message.type;
  if (role !== "assistant") {
    return undefined;
  }

  const text = textFromMessage(message);
  if (!text) {
    return undefined;
  }

  return {
    id:
      message.info?.id ??
      message.id ??
      `assistant-${message.metadata?.time?.created ?? message.info?.time?.created ?? message.time?.created ?? "unknown"}`,
    source: "worker",
    role: "assistant",
    text,
    createdAt: message.metadata?.time?.created ?? message.info?.time?.created ?? message.time?.created
  };
}

function textFromMessage(message: OpenCodeMessageInfo): string | undefined {
  if (typeof message.text === "string") {
    return cleanText(message.text);
  }

  for (const value of [message.content, message.parts, message.message]) {
    const text = textFromUnknown(value);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    return cleanText(value.map(textFromUnknown).filter(isDefined).join("\n"));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Only visible assistant prose is relayable; reasoning/tool payloads are not reports.
    if (record.type !== undefined && record.type !== "text") return undefined;
    if (typeof record.text === "string") {
      return cleanText(record.text);
    }
    if (typeof record.content === "string") {
      return cleanText(record.content);
    }
    if (record.type === "text" && typeof record.value === "string") {
      return cleanText(record.value);
    }
  }

  return undefined;
}

function cleanText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function lastRelayableAssistantMessage(messages: RelayableMessage[]): RelayableMessage | undefined {
  return [...messages].reverse().find((message) => message.role === "assistant");
}

function sessionActiveIn(active: Record<string, unknown>, sessionId: string): boolean {
  const isIdle = (value: unknown): boolean => Boolean(value && typeof value === "object" &&
    (value as Record<string, unknown>).type === "idle");
  for (const value of Object.values(active)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.sessionID === sessionId || record.sessionId === sessionId || record.id === sessionId) {
      return !isIdle(record);
    }
  }
  return active[sessionId] !== undefined && !isIdle(active[sessionId]);
}

function roleOfMessage(message: OpenCodeMessageInfo | undefined): "user" | "assistant" | undefined {
  const role = message?.info?.role ?? message?.role ?? message?.type;
  return role === "user" || role === "assistant" ? role : undefined;
}

function lastAssistantMessage(messages: OpenCodeMessageInfo[]): OpenCodeMessageInfo | undefined {
  return [...messages].reverse().find((message) => roleOfMessage(message) === "assistant");
}

function messageId(message: OpenCodeMessageInfo | undefined): string | undefined {
  if (!message) {
    return undefined;
  }
  return (
    message.info?.id ??
    message.id ??
    `assistant-${message.metadata?.time?.created ?? message.info?.time?.created ?? message.time?.created ?? "unknown"}`
  );
}

function messageCreatedAt(message: OpenCodeMessageInfo | undefined): number | undefined {
  if (!message) {
    return undefined;
  }
  return message.metadata?.time?.created ?? message.info?.time?.created ?? message.time?.created;
}

function messageParentId(message: OpenCodeMessageInfo): string | undefined {
  return message.info?.parentID ?? message.info?.parentId ?? message.parentID ?? message.parentId;
}

function messageCompleted(message: OpenCodeMessageInfo): boolean {
  const finish = message.info?.finish ?? message.finish;
  const completedAt = message.info?.time?.completed ?? message.time?.completed;
  return completedAt !== undefined && finish !== undefined && finish !== "tool-calls";
}

function chronological(messages: OpenCodeMessageInfo[]): OpenCodeMessageInfo[] {
  return [...messages].sort((left, right) => (messageCreatedAt(left) ?? 0) - (messageCreatedAt(right) ?? 0));
}

function dispatchMessages(
  messages: OpenCodeMessageInfo[],
  dispatchMessageId: string,
  dispatchedAt?: string
): OpenCodeMessageInfo[] {
  const dispatchIndex = messages.findIndex((message) => messageId(message) === dispatchMessageId);
  if (dispatchIndex >= 0) {
    const nextUserOffset = messages.slice(dispatchIndex + 1).findIndex((message) => roleOfMessage(message) === "user");
    const end = nextUserOffset < 0 ? messages.length : dispatchIndex + 1 + nextUserOffset;
    return messages.slice(dispatchIndex + 1, end);
  }
  const dispatchedAtMs = dispatchedAt ? Date.parse(dispatchedAt) : Number.POSITIVE_INFINITY;
  return messages.filter((message) => (messageCreatedAt(message) ?? 0) >= dispatchedAtMs);
}

function plannerMessageId(message: RelayableMessage): string {
  const base = message.id || "planner";
  const hash = hashText(base).slice(0, 16);
  return `msg_${hash}`;
}

function durableHistoryShowsPromotion(history: OpenCodeHistoryResult, dispatchMessageId: string): boolean {
  const events = history.data ?? [];
  const promptIndex = events.findIndex((event) => {
    const eventData = event.data ?? {};
    const id = eventData.id ?? eventData.messageID ?? eventData.messageId;
    return id === dispatchMessageId && String(event.type ?? "").toLowerCase().includes("prompted");
  });
  if (promptIndex < 0) {
    return false;
  }
  return events.slice(promptIndex + 1).some((event) =>
    String(event.type ?? "").toLowerCase().includes("step.started")
  );
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
