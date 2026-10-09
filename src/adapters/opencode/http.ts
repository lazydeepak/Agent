import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";
import type { OpenCodeServerConfig, OpenCodeModelRef, OpenCodeModelInfo } from "../../types.js";
import { credentialsAllowed } from "../../util/net.js";
import type { WorkerQuestion as OpenCodeQuestion } from "../../contracts/worker-question.js";

export interface OpenCodeLocationRef {
  directory: string;
  workspaceID?: string;
}

export interface OpenCodeSessionInfo {
  id: string;
  model?: OpenCodeModelRef;
  slug?: string;
  directory?: string;
  projectID?: string;
  version?: string;
  title?: string;
  location?: {
    directory?: string;
    workspaceID?: string;
    project?: {
      id?: string;
      directory?: string;
      canonical?: string;
    };
  };
  subpath?: string;
  time?: {
    created?: number;
    updated?: number;
    idle?: number;
    viewed?: number;
    archived?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface OpenCodeSessionList {
  data: OpenCodeSessionInfo[];
  cursor?: {
    next?: string | null;
    previous?: string | null;
  };
}

export interface OpenCodeMessageInfo {
  id?: string;
  info?: {
    id?: string;
    role?: string;
    parentID?: string;
    parentId?: string;
    finish?: string;
    time?: {
      created?: number;
      completed?: number;
    };
  };
  parentID?: string;
  parentId?: string;
  finish?: string;
  error?: { message?: string; type?: string } | string;
  role?: string;
  type?: string;
  text?: string;
  content?: unknown;
  parts?: unknown;
  message?: unknown;
  time?: {
    created?: number;
    completed?: number;
  };
  metadata?: {
    time?: {
      created?: number;
    };
  };
}

export interface OpenCodePromptAdmission {
  id: string;
  sessionID: string;
  timeCreated: number;
  type: "user";
  payload: {
    text: string;
    files?: unknown[];
    agents?: unknown[];
    skills?: unknown[];
    metadata?: unknown;
  };
  delivery?: "queue" | "steer";
}

export interface OpenCodePromptResult {
  data?: OpenCodePromptAdmission;
}

export interface OpenCodePromptInput {
  id?: string;
  text: string;
  delivery?: "queue" | "steer";
  resume?: boolean;
  metadata?: unknown;
  agents?: unknown[];
  skills?: unknown[];
}

export interface OpenCodeDurableEvent {
  id: number | string;
  durable?: { seq: number };
  type: string;
  time?: number;
  data?: Record<string, unknown>;
}

export interface OpenCodeHistoryResult {
  data?: OpenCodeDurableEvent[];
  hasMore?: boolean;
}

export interface CreateOpenCodeSessionInput {
  repoPath: string;
  title?: string;
  sessionId?: string;
}

export interface OpenCodeClientOptions extends OpenCodeServerConfig {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /**
   * Permit Basic credentials over plain HTTP to a non-loopback host. Off by default so an
   * untrusted endpoint can never harvest the configured OpenCode password; callers that build the
   * client from persisted (operator-authored) configuration opt in explicitly.
   */
  allowInsecureAuth?: boolean;
}

export class OpenCodeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: string
  ) {
    super(`OpenCode HTTP ${status} ${statusText}${body ? `: ${body}` : ""}`);
    this.name = "OpenCodeHttpError";
  }
}

export class OpenCodeUnexpectedResponseError extends Error {
  constructor(
    readonly path: string,
    readonly contentType: string,
    readonly body: string
  ) {
    super(`OpenCode returned ${contentType || "unknown content"} for ${path}, not JSON.`);
    this.name = "OpenCodeUnexpectedResponseError";
  }
}

/**
 * Detects a non-JSON HTML response structurally so it also holds when the error crosses a
 * bundled/duplicated class boundary and `instanceof` cannot be trusted.
 */
function isUnexpectedHtmlResponse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; contentType?: unknown };
  if (candidate.name !== "OpenCodeUnexpectedResponseError") return false;
  return typeof candidate.contentType === "string" && candidate.contentType.includes("text/html");
}

/**
 * Liveness routes tried in order. `/api/health` covers earlier v2 builds, `/global/health` the 1.x
 * shape, and `/api/session` is the one route a current OpenCode server always answers with JSON, so
 * it is the reliable final candidate.
 */
const HEALTH_PATHS = ["/api/health", "/global/health", "/api/server", "/api/session"] as const;

/** Informational routes tried in order; same cross-version caveat as {@link HEALTH_PATHS}. */
const SERVER_INFO_PATHS = ["/api/server", "/api/health", "/api/config"] as const;

export class OpenCodeHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authHeader?: string;
  private readonly usesInjectedFetch: boolean;
  private signal?: AbortSignal;
  private mode?: "v2" | "legacy";
  private messageMode?: "v2" | "legacy";
  private readMessageMode?: "v2" | "legacy";
  private activeMode?: "v2" | "legacy";
  private submitMode?: "v2" | "legacy";
  private docPaths?: Record<string, unknown>;

  constructor(options: OpenCodeClientOptions = {}) {
    // Pin reads, writes and activity together; endpoint families may not share history.
    if (options.apiProtocol) {
      this.pinApiProtocol(options.apiProtocol);
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.AGENT_RELAY_OPENCODE_BASE_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.usesInjectedFetch = Boolean(options.fetch);
    this.signal = options.signal;

    const username = options.username ?? process.env.AGENT_RELAY_OPENCODE_USERNAME;
    const password =
      options.password ??
      (options.passwordEnv ? process.env[options.passwordEnv] : undefined) ??
      process.env.AGENT_RELAY_OPENCODE_PASSWORD ??
      process.env.OPENCODE_SERVER_PASSWORD;

    if ((Boolean(username) || Boolean(password)) && credentialsAllowed(this.baseUrl, options.allowInsecureAuth)) {
      this.authHeader = `Basic ${Buffer.from(`${username ?? "opencode"}:${password ?? ""}`).toString(
        "base64"
      )}`;
    }
  }

  get url(): string {
    return this.baseUrl;
  }

  setAbortSignal(signal: AbortSignal | undefined): void {
    this.signal = signal;
  }

  async health(): Promise<unknown> {
    if ((await this.apiMode()) === "legacy") {
      try {
        return {
          legacy: true,
          doc: await this.requestJson("/doc")
        };
      } catch (error) {
        // If /doc returns HTML but we thought it was legacy, it might be a V2 server
        // with Swagger UI at /doc. Try the V2 health endpoint and re-pin if successful.
        if (isUnexpectedHtmlResponse(error)) {
          const result = await this.requestJson("/api/health");
          this.pinApiProtocol("v2");
          return result;
        }
        throw error;
      }
    }

    try {
      return await this.firstReachableJson(HEALTH_PATHS);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Probes candidate liveness routes in order and returns the first JSON answer.
   *
   * OpenCode does not expose a stable health route across versions: `/api/health` is absent on
   * 2.0.x (404) and `/global/health` is served by the SPA catch-all there, so a single hard-coded
   * path reports a healthy server as unreachable. A 404 or a non-JSON answer means "this version
   * does not have that route" and the probe moves on. A 401/403 is propagated instead, because it
   * means the server is up and the real problem is authentication.
   */
  private async firstReachableJson(paths: readonly string[]): Promise<unknown> {
    let lastError: unknown;
    for (const path of paths) {
      try {
        return await this.requestJson(path);
      } catch (error) {
        if (error instanceof OpenCodeHttpError && (error.status === 401 || error.status === 403)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError ?? new Error(`No health route answered for OpenCode at ${this.baseUrl}.`);
  }

  async serverInfo(): Promise<unknown> {
    if ((await this.apiMode()) === "legacy") {
      try {
        return await this.requestJson("/doc");
      } catch (error) {
        // If /doc returns HTML but we thought it was legacy, it might be a V2 server
        // with Swagger UI at /doc. Try the V2 server info endpoint and re-pin if successful.
        if (isUnexpectedHtmlResponse(error)) {
          const result = await this.firstReachableJson(SERVER_INFO_PATHS);
          this.pinApiProtocol("v2");
          return result;
        }
        throw error;
      }
    }

    return this.firstReachableJson(SERVER_INFO_PATHS);
  }

  async getVersion(): Promise<string | undefined> {
    try {
      const info = (await this.serverInfo()) as { version?: string; data?: { version?: string } };
      if (info && typeof info === "object") {
        if (typeof info.version === "string") return info.version;
        if (info.data && typeof info.data === "object" && typeof info.data.version === "string") {
          return info.data.version;
        }
      }
      const health = (await this.health()) as { version?: string; data?: { version?: string } };
      if (health && typeof health === "object") {
        if (typeof health.version === "string") return health.version;
        if (health.data && typeof health.data === "object" && typeof health.data.version === "string") {
          return health.data.version;
        }
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  async listSessions(options: { repoPath?: string; limit?: number } = {}): Promise<OpenCodeSessionList> {
    if ((await this.apiMode()) === "v2") {
      const params = new URLSearchParams();
      params.set("order", "desc");
      params.set("limit", String(options.limit ?? 50));
      if (options.repoPath) {
        params.set("directory", resolve(options.repoPath));
      }
      const raw = await this.requestJson(`/api/session?${params.toString()}`);
      if (Array.isArray(raw)) {
        return { data: raw };
      }
      const list = raw as OpenCodeSessionList;
      return {
        data: list?.data ?? [],
        cursor: list?.cursor
      };
    }

    const legacyParams = new URLSearchParams();
    if (options.repoPath) {
      legacyParams.set("directory", resolve(options.repoPath));
    }
    const suffix = legacyParams.size > 0 ? `?${legacyParams.toString()}` : "";
    let legacySessions: OpenCodeSessionInfo[];
    try {
      legacySessions = (await this.requestJson(`/session${suffix}`)) as OpenCodeSessionInfo[];
    } catch (error) {
      // An SPA catch-all answers the legacy path with HTML. That means we are pinned to the wrong
      // protocol, so re-pin to v2 and retry there instead of surfacing "returned text/html, not JSON".
      if (isUnexpectedHtmlResponse(error)) {
        this.pinApiProtocol("v2");
        return this.listSessions(options);
      }
      throw error;
    }
    return {
      data: Array.isArray(legacySessions) ? legacySessions.slice(0, options.limit ?? legacySessions.length) : []
    };
  }

  async getSession(sessionId: string): Promise<OpenCodeSessionInfo> {
    if ((await this.apiMode()) === "v2") {
      const response = await this.requestJson(`/api/session/${encodeURIComponent(sessionId)}`);
      const session = (response as { data?: OpenCodeSessionInfo })?.data ?? (response as OpenCodeSessionInfo);
      if (!session || (!session.id && !(session as any).sessionId)) {
        throw new Error(`OpenCode session ${sessionId} response did not include data.`);
      }
      return session;
    }

    return (await this.requestJson(`/session/${encodeURIComponent(sessionId)}`)) as OpenCodeSessionInfo;
  }

  async listModels(): Promise<OpenCodeModelInfo[]> {
    if ((await this.apiMode()) !== "v2") return [];
    try {
      const response = (await this.requestJson("/api/model")) as { data?: OpenCodeModelInfo[] } | OpenCodeModelInfo[];
      if (Array.isArray(response)) return response;
      return (response as { data?: OpenCodeModelInfo[] })?.data ?? [];
    } catch {
      return [];
    }
  }

  async listQuestions(sessionId: string): Promise<OpenCodeQuestion[]> {
    if ((await this.apiMode()) === "legacy") {
      const result = await this.requestJson("/question") as OpenCodeQuestion[];
      return result.filter(question => question.sessionID === sessionId);
    }
    const result = await this.requestJson(`/api/session/${encodeURIComponent(sessionId)}/question`) as { data: OpenCodeQuestion[] } | OpenCodeQuestion[];
    const list = Array.isArray(result) ? result : (result as { data: OpenCodeQuestion[] }).data ?? [];
    return list.filter((question) => question.sessionID === sessionId);
  }

  async answerQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<void> {
    if ((await this.apiMode()) === "legacy") {
      const pending = await this.listQuestions(sessionId);
      if (!pending.some(question => question.id === requestId)) throw new Error("Question not pending for this session.");
      await this.requestJson(`/question/${encodeURIComponent(requestId)}/reply`, {
        method: "POST", body: JSON.stringify({ answers })
      }, { readOkBody: false });
      return;
    }
    await this.requestJson(`/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(requestId)}/reply`, {
      method: "POST", body: JSON.stringify({ answers })
    }, { readOkBody: false });
  }

  async switchSessionModel(sessionId: string, model: OpenCodeModelRef): Promise<void> {
    if ((await this.apiMode()) !== "v2") {
      throw new Error("The configured OpenCode server does not support session model switching.");
    }
    await this.requestJson(`/api/session/${encodeURIComponent(sessionId)}/model`, {
      method: "POST",
      body: JSON.stringify({ model })
    }, { readOkBody: false });
  }

  async listActiveSessions(): Promise<Record<string, unknown>> {
    if ((await this.activeApiMode()) === "v2") {
      const response = (await this.requestJson("/api/session/active")) as { data?: Record<string, unknown> } | Record<string, unknown>;
      if (response && typeof response === "object" && "data" in response) {
        return (response as { data?: Record<string, unknown> }).data ?? {};
      }
      return (response as Record<string, unknown>) ?? {};
    }

    return (await this.requestJson("/session/status")) as Record<string, unknown>;
  }

  async listSessionMessages(sessionId: string): Promise<OpenCodeMessageInfo[]> {
    if ((await this.readMessageApiMode()) === "v2") {
      const response = await this.requestJson(
        `/api/session/${encodeURIComponent(sessionId)}/message?order=desc&limit=100`
      );
      if (Array.isArray(response)) return response;
      return (response as { data?: OpenCodeMessageInfo[] })?.data ?? [];
    }

    const legacy = await this.requestJson(
      `/session/${encodeURIComponent(sessionId)}/message?limit=100`
    );
    return Array.isArray(legacy) ? legacy : (legacy as { data?: OpenCodeMessageInfo[] })?.data ?? [];
  }

  async sendSessionMessage(sessionId: string, text: string): Promise<void> {
    const body = JSON.stringify({
      parts: [
        {
          type: "text",
          text
        }
      ]
    });

    const mode = await this.messageApiMode();
    const v2Path = `/api/session/${encodeURIComponent(sessionId)}/message`;
    const legacyPath = `/session/${encodeURIComponent(sessionId)}/message`;
    const path = mode === "v2" ? v2Path : legacyPath;

    try {
      if (this.usesInjectedFetch) {
        await this.requestJson(path, { method: "POST", body }, { readOkBody: false });
        return;
      }
      await this.postAndIgnoreSuccessBody(path, body);
    } catch (error) {
      if (mode !== "v2" || !legacyWriteFallback(error)) {
        throw error;
      }
      // Some servers expose v2 reads and legacy writes only; fall back and stay on legacy I/O.
      this.pinApiProtocol("legacy");
      if (this.usesInjectedFetch) {
        await this.requestJson(legacyPath, { method: "POST", body }, { readOkBody: false });
        return;
      }
      await this.postAndIgnoreSuccessBody(legacyPath, body);
    }
  }

  async submitPrompt(sessionId: string, input: OpenCodePromptInput): Promise<OpenCodePromptAdmission> {
    const body = JSON.stringify({
      id: input.id ?? null,
      prompt: {
        text: input.text,
        ...(input.agents ? { agents: input.agents } : {})
      },
      ...(input.delivery ? { delivery: input.delivery } : {}),
      ...(input.resume === undefined ? {} : { resume: input.resume }),
    });

    if ((await this.submitApiMode()) === "legacy") {
      await this.sendSessionMessage(sessionId, input.text);
      return {
        id: "",
        sessionID: sessionId,
        timeCreated: Date.now() / 1000,
        type: "user",
        payload: { text: input.text },
        delivery: input.delivery
      };
    }

    const path = `/api/session/${encodeURIComponent(sessionId)}/prompt`;
    try {
      const result = (await this.requestJson(path, {
        method: "POST",
        body
      })) as OpenCodePromptResult | { id?: string; sessionID?: string };

      if ((result as OpenCodePromptResult)?.data?.id) {
        return (result as OpenCodePromptResult).data!;
      }
      if ((result as any)?.id) {
        return result as unknown as OpenCodePromptAdmission;
      }
      throw new OpenCodeUnexpectedResponseError(path, "application/json", JSON.stringify(result).slice(0, 200));
    } catch (error) {
      if (error instanceof OpenCodeHttpError && (error.status === 404 || error.status === 405)) {
        await this.sendSessionMessage(sessionId, input.text);
        return {
          id: input.id ?? "",
          sessionID: sessionId,
          timeCreated: Date.now() / 1000,
          type: "user",
          payload: { text: input.text },
          delivery: input.delivery
        };
      }
      throw error;
    }
  }

  async history(sessionId: string, after?: number): Promise<OpenCodeHistoryResult> {
    if ((await this.apiMode()) === "legacy") {
      return { data: [], hasMore: false };
    }
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (after !== undefined) {
      params.set("after", String(after));
    }
    return (await this.requestJson(
      `/api/session/${encodeURIComponent(sessionId)}/history?${params.toString()}`
    )) as OpenCodeHistoryResult;
  }

  async supportsPromptEndpoint(): Promise<boolean> {
    return (await this.submitApiMode()) === "v2";
  }

  async isV2Api(): Promise<boolean> {
    return (await this.apiMode()) === "v2";
  }

  async selectSession(sessionId: string): Promise<void> {
    const body = JSON.stringify({ sessionID: sessionId });
    await this.requestJson("/tui/select-session", {
      method: "POST",
      body
    });
  }

  async createSession(input: CreateOpenCodeSessionInput): Promise<OpenCodeSessionInfo> {
    if ((await this.apiMode()) === "v2") {
      const resolvedDir = resolve(input.repoPath);
      const response = (await this.requestJson("/api/session", {
        method: "POST",
        body: JSON.stringify({
          id: input.sessionId ?? null,
          title: input.title ?? null,
          directory: resolvedDir,
          location: {
            directory: resolvedDir
          },
          metadata: {
            createdBy: "agent-relay"
          }
        })
      })) as { data?: OpenCodeSessionInfo } | OpenCodeSessionInfo;

      const session = (response as { data?: OpenCodeSessionInfo })?.data ?? (response as OpenCodeSessionInfo);
      if (!session || (!session.id && !(session as any).sessionId)) {
        throw new Error("OpenCode create session response did not include data.");
      }

      return session;
    }

    return (await this.requestJson("/session", {
      method: "POST",
      body: JSON.stringify({
        id: input.sessionId,
        title: input.title,
        directory: resolve(input.repoPath)
      })
    })) as OpenCodeSessionInfo;
  }

  private async apiMode(): Promise<"v2" | "legacy"> {
    await this.ensureCoherentProtocol();
    return this.mode ?? "legacy";
  }

  private async messageApiMode(): Promise<"v2" | "legacy"> {
    await this.ensureCoherentProtocol();
    return this.messageMode ?? this.mode ?? "legacy";
  }

  private async readMessageApiMode(): Promise<"v2" | "legacy"> {
    await this.ensureCoherentProtocol();
    return this.readMessageMode ?? this.mode ?? "legacy";
  }

  private async activeApiMode(): Promise<"v2" | "legacy"> {
    await this.ensureCoherentProtocol();
    return this.activeMode ?? this.mode ?? "legacy";
  }

  private async submitApiMode(): Promise<"v2" | "legacy"> {
    await this.ensureCoherentProtocol();
    return this.submitMode ?? this.mode ?? "legacy";
  }

  private pinApiProtocol(protocol: "v2" | "legacy"): void {
    this.mode = protocol;
    this.readMessageMode = protocol;
    this.messageMode = protocol;
    this.activeMode = protocol;
    this.submitMode = protocol;
  }

  /** OpenCode Desktop and the v2 prompt API share one history; mixed per-route modes diverge. */
  private async ensureCoherentProtocol(): Promise<void> {
    const paths = await this.openApiPaths();
    if (this.mode && this.readMessageMode && this.messageMode && this.activeMode && this.submitMode) {
      return;
    }

    const pathKeys = Object.keys(paths);
    const hasV2Core = pathKeys.some((path) => path.startsWith("/api/session") || path === "/api/health");
    if (!hasV2Core) {
      // If discovery didn't find V2, try a direct probe for V2 health before defaulting to legacy.
      // This handles cases where the spec paths (/doc, /openapi.json) are missing or return HTML.
      let reachedV2Health = false;
      let v2AuthRequired = false;
      try {
        const v2Health = (await this.requestJson("/api/health", { signal: AbortSignal.timeout(2000) })) as {
          status?: string;
        };
        if (v2Health && (v2Health.status === "ok" || Object.keys(v2Health).length > 0)) {
          this.pinApiProtocol("v2");
          return;
        }
        reachedV2Health = true;
      } catch (error) {
        if (error instanceof OpenCodeHttpError) {
          reachedV2Health = true;
          // A 401/403 means the route exists and is credential-gated, which is positive evidence
          // that this is a v2 server. Only a definitive 404 proves the route is absent. OpenCode's
          // SPA answers unknown paths with HTML, so "route missing" cannot be read from the body.
          if (error.status === 401 || error.status === 403) {
            v2AuthRequired = true;
          }
        } else if (error instanceof OpenCodeUnexpectedResponseError) {
          reachedV2Health = true;
        }
      }

      // Auth-gated v2 route: pin v2 so the caller gets an accurate "authentication required"
      // error naming /api/*, rather than being sent to a legacy path that returns HTML.
      if (v2AuthRequired) {
        this.pinApiProtocol("v2");
        return;
      }

      // Only pin to legacy if we actually reached the server (got paths or a definitive health response).
      // If the server was unreachable, we don't pin so we can try again on the next request.
      if (pathKeys.length > 0 || reachedV2Health) {
        this.pinApiProtocol("legacy");
      }
      return;
    }

    // OpenCode's own UI probes /global/health first. In OpenCode 1.x, healthy indicates legacy.
    // In OpenCode 2.0.x (e.g. 2.0.22), it is a V2 server; globalHealthIsLegacy checks for version < 2.
    if (Object.prototype.hasOwnProperty.call(paths, "/global/health") && (await this.globalHealthIsLegacy())) {
      this.pinApiProtocol("legacy");
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(paths, "/api/session/{sessionID}/prompt") ||
      Object.prototype.hasOwnProperty.call(paths, "/api/session/{sessionId}/prompt") ||
      Object.prototype.hasOwnProperty.call(paths, "/api/session/{id}/prompt") ||
      Object.prototype.hasOwnProperty.call(paths, "/api/session/{sessionID}/message") ||
      Object.prototype.hasOwnProperty.call(paths, "/api/session/{sessionId}/message") ||
      Object.prototype.hasOwnProperty.call(paths, "/api/session/{id}/message") ||
      Object.prototype.hasOwnProperty.call(paths, "/api/session")
    ) {
      this.pinApiProtocol("v2");
      return;
    }

    this.pinApiProtocol("v2");
  }

  private async globalHealthIsLegacy(): Promise<boolean> {
    try {
      const result = (await this.requestJson("/global/health")) as { healthy?: boolean; version?: string };
      if (!result?.healthy) return false;
      // In OpenCode 2.0.x (e.g. 2.0.22), version >= 2 is V2 protocol, not legacy.
      if (typeof result.version === "string" && /^v?2\./.test(result.version.trim())) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async openApiPaths(): Promise<Record<string, unknown>> {
    if (this.docPaths) {
      return this.docPaths;
    }
    // OpenCode traditionally uses /doc for its JSON spec, but recent updates or proxies may
    // return HTML (Swagger UI) or move the spec. Try common paths before giving up.
    const discoveryPaths = ["/doc", "/openapi.json", "/api/doc", "/api/openapi.json"];
    let reached = false;
    for (const path of discoveryPaths) {
      try {
        const doc = (await this.requestJson(path)) as { paths?: Record<string, unknown> };
        reached = true;
        if (doc && typeof doc === "object" && doc.paths) {
          this.docPaths = doc.paths;
          return this.docPaths;
        }
      } catch (error) {
        if (error instanceof OpenCodeHttpError || error instanceof OpenCodeUnexpectedResponseError) {
          reached = true;
        }
      }
    }
    // Only cache the empty result if we actually reached the server.
    if (reached) {
      this.docPaths = {};
    }
    return this.docPaths ?? {};
  }

  private async requestJson(
    path: string,
    init: RequestInit = {},
    options: { readOkBody?: boolean } = {}
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (this.authHeader) {
      headers.set("authorization", this.authHeader);
    }

    const signal = init.signal ?? this.signal;
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      ...init,
      ...(signal ? { signal } : {}),
      headers
    });

    if (response.ok && options.readOkBody === false) {
      return {};
    }

    const text = await response.text();

    if (!response.ok) {
      throw new OpenCodeHttpError(response.status, response.statusText, text);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (text && !contentType.includes("application/json")) {
      throw new OpenCodeUnexpectedResponseError(path, contentType, text.slice(0, 200));
    }

    return text ? JSON.parse(text) : {};
  }

  private async postAndIgnoreSuccessBody(path: string, body: string): Promise<void> {
    const url = new URL(path, this.baseUrl);
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;

    await new Promise<void>((resolveRequest, rejectRequest) => {
      let settled = false;
      const request = requestImpl(
        url,
        {
          method: "POST",
          ...(this.signal ? { signal: this.signal } : {}),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            ...(this.authHeader ? { authorization: this.authHeader } : {})
          }
        },
        (response: any) => {
          if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
            let responseBody = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              responseBody += chunk;
            });
            response.on("end", () => {
              settle(resolveRequest);
            });
            return;
          }

          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            responseBody += chunk;
          });
          response.on("end", () => {
            settle(
              resolveRequest,
              new OpenCodeHttpError(response.statusCode ?? 0, response.statusMessage ?? "", responseBody)
            );
          });
        }
      );

      const acceptedTimer = setTimeout(() => {
        if (!settled) {
          settle(
            rejectRequest,
            new OpenCodeHttpError(0, "Request Timeout", "OpenCode did not complete the request response in time.")
          );
        }
      }, 30_000);

      request.on("error", (error: any) => {
        if (!settled) {
          settle(rejectRequest, error);
        }
      });
      request.end(body);

      function settle(callback: (value?: never) => void, error?: Error): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(acceptedTimer);
        if (error) {
          rejectRequest(error);
          return;
        }
        callback();
      }
    });
  }
}

function legacyWriteFallback(error: unknown): boolean {
  return error instanceof OpenCodeHttpError && (error.status === 404 || error.status === 405 || error.status === 501);
}

function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl) {
    throw new Error(
      "OpenCode server URL is required. Set worker.server.baseUrl, --opencode-url, or AGENT_RELAY_OPENCODE_BASE_URL."
    );
  }

  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
