import { LiveOpenCodeAdapter, type OpenCodeSessionSummary } from "../adapters/opencode/index.js";
import { scanOpenCodeDesktopActiveSession, OpenCodeDesktopStateError } from "../adapters/opencode/desktop-state.js";
import { resolve } from "node:path";
import { createPairAdapters } from "../runtime/index.js";
import type { LockRegistry, RuntimeAdapterOptions } from "../runtime/index.js";
import type { OpenCodeModelRef } from "../adapters/opencode/http.js";
import type {
  EndpointTestResult,
  OpenCodeEndpointInput,
  OpenCodeEndpointTestInput,
  CreateOpenCodeSessionInput,
  StartOpenCodeServerInput,
  OpenCodeSessionInfo,
  WorkerModelInfo,
  WorkerSessionDesktopAlignment,
  PairDetail
} from "../contracts/desktop.js";
import type { ToolActionResult, ToolLaunchResult } from "./desktop-tool-manager.js";
import type { DesktopToolLauncher } from "./desktop-tool-manager.js";
import { DesktopToolError } from "./desktop-tool-manager.js";
import { DesktopApplicationError } from "./desktop-service.js";
import type { RelayableMessage, SessionPair } from "../types.js";

/**
 * Everything the worker-session service needs from the owning application service. Declared as an
 * interface so the session operations no longer live inside the (large) desktop facade.
 */
export interface WorkerSessionContext {
  options: {
    opencode?: { baseUrl?: string; username?: string; password?: string; passwordEnv?: string };
    chatgpt?: { cdpUrl?: string };
    liveOpenCode?: boolean;
    liveChatGPT?: boolean;
    opencodeFetch?: typeof fetch;
    chatgptCdpUrl?: string;
    openCodeDesktopScan?: () => Promise<OpenCodeSessionInfo>;
  };
  tools: DesktopToolLauncher;
  getPairDetail(pairId: string): SessionPair | undefined;
  getPairs(): SessionPair[];
  adapterOptions(): RuntimeAdapterOptions;
  assertKnownPair(pairId: string): void;
  assertPairStopped(pairId: string): void;
  ensureBrowserLocks(): LockRegistry;
  recordEvent(type: string, pairId: string | undefined, extras?: { reason?: string; details?: Record<string, unknown> }): void;
  rebindWorker(pairId: string, sessionId: string): Promise<PairDetail>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toSessionInfo(session: OpenCodeSessionSummary): OpenCodeSessionInfo {
  return {
    sessionId: session.sessionId,
    title: session.title,
    repoPath: session.repoPath,
    updatedAt: session.updatedAt
  };
}

export class WorkerSessionService {
  constructor(private readonly ctx: WorkerSessionContext) {}

    async listWorkerModels(pairId: string): Promise<WorkerModelInfo[]> {
    this.ctx.assertKnownPair(pairId);
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    const worker = this.adapterFor(pair);
    const [models, session] = await Promise.all([worker.listModels(), worker.getSession(pair.worker.sessionId)]);
    return models
      .filter((model) => model.enabled !== false)
      .map((model) => ({
        ...model,
        current: session?.model?.providerID === model.providerID && session.model.id === model.id
      }));
  }

    async switchWorkerModel(pairId: string, model: OpenCodeModelRef, notifyPlanner = false): Promise<void> {
      this.ctx.assertKnownPair(pairId);
      this.ctx.assertPairStopped(pairId);
      const pair = this.ctx.getPairDetail(pairId);
      if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
      const worker = this.adapterFor(pair);
      const available = await worker.listModels();
      const selected = available.find(
        (candidate) => candidate.enabled !== false && candidate.providerID === model.providerID && candidate.id === model.id
      );
      if (!selected) {
        throw new DesktopApplicationError("UNKNOWN_WORKER_MODEL", "The selected worker model is not available from the configured OpenCode server.");
      }
      await worker.switchSessionModel(pair.worker, model);
      this.ctx.recordEvent("WORKER_MODEL_SWITCHED", pairId, {
        reason: `Worker session model switched to ${model.providerID}/${model.id}.`,
        details: { sessionId: pair.worker.sessionId, providerId: model.providerID, modelId: model.id }
      });
      if (notifyPlanner) {
        const message: RelayableMessage = {
          id: `worker-model-${pair.pairId}-${Date.now()}`,
          source: "worker",
          role: "user",
          text: `Worker model switched to ${model.providerID}/${model.id}. Use this model for subsequent worker turns.`,
          createdAt: Date.now()
        };
        try {
          this.ctx.ensureBrowserLocks();
          await createPairAdapters(pair, this.ctx.adapterOptions()).planner.sendWorkerMessage(pair.planner, message);
        } catch (error) {
          throw new DesktopApplicationError(
            "WORKER_MODEL_NOTIFY_FAILED",
            `Worker model changed, but the ChatGPT planner notification was not delivered: ${messageOf(error)}`,
            { providerId: model.providerID, modelId: model.id, sessionId: pair.worker.sessionId }
          );
        }
        this.ctx.recordEvent("WORKER_MODEL_PLANNER_NOTIFIED", pairId, {
          reason: `ChatGPT planner notified that the worker model changed to ${model.providerID}/${model.id}.`
        });
      }
  }

    async listOpenCodeSessions(pairId: string): Promise<OpenCodeSessionInfo[]> {
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    const options = this.ctx.adapterOptions();
    if (!options.liveOpenCode && !options.opencode?.baseUrl && !pair.worker.server?.baseUrl) {
      throw new DesktopApplicationError(
        "OPENCODE_UNAVAILABLE",
        "OpenCode session listing requires a configured live OpenCode endpoint for this pair."
      );
    }
    const worker = new LiveOpenCodeAdapter({ ...pair.worker.server, ...options.opencode });
    try {
      const sessions = await worker.listSessions({ repoPath: pair.worker.repoPath });
      return sessions.map((session: OpenCodeSessionSummary) => ({
        sessionId: session.sessionId,
        title: session.title,
        repoPath: session.repoPath,
        updatedAt: session.updatedAt
      }));
    } catch (error) {
      throw new DesktopApplicationError(
        "OPENCODE_UNAVAILABLE",
        `Could not list OpenCode sessions: ${messageOf(error)}`
      );
    }
  }

    getOpenCodeEndpoint(): string {
    const configured = this.ctx.options.opencode?.baseUrl ?? process.env.AGENT_RELAY_OPENCODE_BASE_URL;
    if (configured) return configured;

    const first = this.firstWorkerServer()?.baseUrl;
    if (first) return first;

    return "http://127.0.0.1:4096";
  }

    getChatGptEndpoint(): string {
    return (
      this.ctx.options.chatgpt?.cdpUrl ??
      this.firstPlannerBrowser()?.cdpUrl ??
      "http://127.0.0.1:9222"
    );
  }

    async discoverOpenCodeSessions(options: OpenCodeEndpointInput = {}): Promise<OpenCodeSessionInfo[]> {
    const worker = new LiveOpenCodeAdapter(
      this.openCodeClientOptions(options.baseUrl ?? this.getOpenCodeEndpoint())
    );
    try {
      const sessions = await worker.listSessions();
      return sessions.map((session: OpenCodeSessionSummary) => ({
        sessionId: session.sessionId,
        title: session.title,
        repoPath: session.repoPath,
        updatedAt: session.updatedAt
      }));
    } catch (error) {
      throw new DesktopApplicationError(
        "OPENCODE_UNAVAILABLE",
        `Could not list OpenCode sessions: ${messageOf(error)}`
      );
    }
  }

    async scanOpenCodeDesktopSession(): Promise<OpenCodeSessionInfo> {
    try {
      return await (this.ctx.options.openCodeDesktopScan ?? scanOpenCodeDesktopActiveSession)();
    } catch (error) {
      if (error instanceof OpenCodeDesktopStateError) {
        throw new DesktopApplicationError(error.code, error.message);
      }
      throw new DesktopApplicationError(
        "OPENCODE_DESKTOP_SESSION_NOT_FOUND",
        `Could not detect the active OpenCode Desktop session: ${messageOf(error)}`
      );
    }
  }

    async alignWorkerSessionWithOpenCodeDesktop(pairId: string): Promise<WorkerSessionDesktopAlignment> {
    this.ctx.assertKnownPair(pairId);
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    const desktop = await this.scanOpenCodeDesktopSession();
    const boundSessionId = pair.worker.sessionId;
    const worker = this.adapterFor(pair);
    let sessionOnServer;
    try {
      sessionOnServer = await worker.getSession(boundSessionId);
    } catch (error) {
      throw new DesktopApplicationError(
        "OPENCODE_UNAVAILABLE",
        `Could not verify the bound worker session on the OpenCode server: ${messageOf(error)}`
      );
    }
    if (!sessionOnServer) {
      throw new DesktopApplicationError(
        "WORKER_SESSION_NOT_FOUND",
        `Bound session ${boundSessionId} was not found on the configured OpenCode server. Rebind or create a session first.`
      );
    }

    const configuredRepo = resolve(pair.worker.repoPath);
    const desktopRepo = desktop.repoPath ? resolve(desktop.repoPath) : undefined;
    if (desktopRepo && desktopRepo !== configuredRepo) {
      throw new DesktopApplicationError(
        "WORKER_SESSION_REPO_MISMATCH",
        `OpenCode Desktop is on ${desktop.repoPath}, but this pair is configured for ${pair.worker.repoPath}.`
      );
    }

    if (desktop.sessionId === boundSessionId) {
      return {
        ok: true,
        boundSessionId,
        desktopSessionId: desktop.sessionId,
        rebound: false,
        message: `Pair ${pairId} is already bound to the active OpenCode Desktop session (${boundSessionId}). Refresh OpenCode Desktop to confirm relay traffic appears there.`
      };
    }

    this.ctx.assertPairStopped(pairId);
    let desktopSession;
    try {
      desktopSession = await worker.getSession(desktop.sessionId);
    } catch (error) {
      throw new DesktopApplicationError(
        "OPENCODE_UNAVAILABLE",
        `Could not load OpenCode Desktop session ${desktop.sessionId}: ${messageOf(error)}`
      );
    }
    if (!desktopSession) {
      throw new DesktopApplicationError(
        "WORKER_SESSION_NOT_FOUND",
        `OpenCode Desktop session ${desktop.sessionId} was not found on the configured server.`
      );
    }
    const sessionRepo = desktopSession.repoPath ? resolve(desktopSession.repoPath) : desktopRepo;
    if (sessionRepo && sessionRepo !== configuredRepo) {
      throw new DesktopApplicationError(
        "WORKER_SESSION_REPO_MISMATCH",
        `OpenCode Desktop session ${desktop.sessionId} belongs to ${desktopSession.repoPath ?? desktop.repoPath}, not ${pair.worker.repoPath}.`
      );
    }

    await this.ctx.rebindWorker(pairId, desktop.sessionId);
    this.ctx.recordEvent("WORKER_SESSION_DESKTOP_ALIGNED", pairId, {
      reason: `Rebound pair to active OpenCode Desktop session ${desktop.sessionId}.`,
      details: { previousSessionId: boundSessionId, sessionId: desktop.sessionId }
    });
    return {
      ok: true,
      boundSessionId: desktop.sessionId,
      desktopSessionId: desktop.sessionId,
      rebound: true,
      message: `Rebound ${pairId} from ${boundSessionId} to the active OpenCode Desktop session ${desktop.sessionId}.`
    };
  }

    async createOpenCodeSession(input: CreateOpenCodeSessionInput): Promise<OpenCodeSessionInfo> {
    const worker = new LiveOpenCodeAdapter(
      this.openCodeClientOptions(input.baseUrl ?? this.getOpenCodeEndpoint())
    );
    try {
      const session = await worker.createSession({ repoPath: input.repoPath, title: input.title });
      return {
        sessionId: session.sessionId,
        title: session.title,
        repoPath: session.repoPath,
        updatedAt: session.updatedAt
      };
    } catch (error) {
      throw new DesktopApplicationError(
        "OPENCODE_UNAVAILABLE",
        `Could not create an OpenCode session: ${messageOf(error)}`
      );
    }
  }

    async testOpenCodeEndpoint(options: OpenCodeEndpointTestInput = {}): Promise<EndpointTestResult> {
    const worker = new LiveOpenCodeAdapter(
      this.openCodeClientOptions(options.baseUrl ?? this.getOpenCodeEndpoint())
    );
    try {
      await worker.checkServer();
      const checks = [{ name: "worker.serverReachable", status: "PASS", reason: "OpenCode endpoint is reachable." }];
      const sessionId = options.sessionId?.trim();
      if (!sessionId) {
        return { ok: true, message: "OpenCode endpoint is reachable.", checks };
      }
      const repoPath = options.repoPath?.trim();
      const sessions = await worker.listSessions(repoPath ? { repoPath } : undefined);
      const selected = sessions.find((session) => session.sessionId === sessionId);
      if (!selected) {
        return {
          ok: false,
          message: `OpenCode is reachable, but selected session ${sessionId} is not available${repoPath ? ` for ${repoPath}` : ""}. Scan or discover sessions again.`,
          checks: [
            ...checks,
            { name: "worker.sessionAvailable", status: "FAIL", reason: `Session ${sessionId} was not returned by the endpoint.` }
          ]
        };
      }
      checks.push({
        name: "worker.sessionAvailable",
        status: "PASS",
        reason: `Session ${sessionId} is available${selected.repoPath ? ` for ${selected.repoPath}` : ""}.`
      });
      return { ok: true, message: "OpenCode endpoint, selected session, and repository match.", checks };
    } catch (error) {
      return { ok: false, message: `OpenCode endpoint is not reachable: ${messageOf(error)}` };
    }
  }

    async startOpenCodeServer(input: StartOpenCodeServerInput): Promise<ToolLaunchResult> {
    let result: ToolLaunchResult | undefined;
    try {
      result = await this.ctx.tools.startOpenCode({
        repoPath: input.repoPath,
        baseUrl: input.baseUrl ?? this.getOpenCodeEndpoint()
      });
      if (input.sessionId) {
        const worker = new LiveOpenCodeAdapter(this.openCodeClientOptions(result.endpoint));
        const sessions = await worker.listSessions({ repoPath: input.repoPath });
        if (!sessions.some((session) => session.sessionId === input.sessionId)) {
          throw new Error("The selected session was not returned by the server.");
        }
      }
      return result;
    } catch (error) {
      if (result && !result.alreadyRunning) await this.ctx.tools.stopOpenCode();
      if (result) {
        throw new DesktopApplicationError(
          "OPENCODE_SERVER_SESSION_UNAVAILABLE",
          `OpenCode started, but it could not load session ${input.sessionId}: ${messageOf(error)}`,
          { fallbackCommand: "opencode upgrade" }
        );
      }
      throw this.toToolError(error);
    }
  }

    async updateOpenCodeCommand(): Promise<ToolActionResult> {
    try {
      return await this.ctx.tools.updateOpenCode();
    } catch (error) {
      throw this.toToolError(error);
    }
  }

    async suggestWorkerSessionTitle(pairId: string): Promise<string> {
    this.ctx.assertKnownPair(pairId);
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    return this.nextWorkerSessionTitle(pair, new LiveOpenCodeAdapter({
      ...pair.worker.server,
      ...this.ctx.options.opencode,
      fetch: this.ctx.options.opencodeFetch
    }));
  }

    async nextWorkerSessionTitle(pair: SessionPair, worker: LiveOpenCodeAdapter): Promise<string> {
    const escapedPairId = pair.pairId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escapedPairId}-(\\d+)$`);
    const sessions = await worker.listSessions({ repoPath: pair.worker.repoPath });
    const highest = sessions.reduce((max, session) => {
      const match = pattern.exec(session.title ?? "");
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${pair.pairId}-${highest + 1}`;
  }

    async openWorkerSession(pairId: string): Promise<{ sessionId: string; selected: boolean; fallback: boolean }> {
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    const sessionId = pair.worker.sessionId;
    const options = this.ctx.adapterOptions();
    const worker = new LiveOpenCodeAdapter({
      ...pair.worker.server,
      ...options.opencode,
      fetch: this.ctx.options.opencodeFetch
    });
    try {
      await worker.selectSession(sessionId);
      this.ctx.recordEvent("WORKER_SESSION_FALLBACK", pairId, {
        reason: `Requested bound worker session ${sessionId} from the OpenCode server. OpenCode Desktop does not expose session deep links; select the copied session ID in the opened project.`,
        details: { sessionId, selectionRequested: true }
      });
      return { sessionId, selected: false, fallback: true };
    } catch (error) {
      this.ctx.recordEvent("WORKER_SESSION_FALLBACK", pairId, {
        reason: `Direct session selection unavailable; open the session dialog and choose ${sessionId}.`,
        details: { sessionId, error: messageOf(error) }
      });
      return { sessionId, selected: false, fallback: true };
    }
  }

    adapterFor(pair: SessionPair): LiveOpenCodeAdapter {
    return new LiveOpenCodeAdapter({
      ...pair.worker.server,
      ...this.ctx.options.opencode,
      fetch: this.ctx.options.opencodeFetch
    });
  }

    openCodeClientOptions(baseUrl: string) {
    return {
      baseUrl,
      ...this.ctx.options.opencode,
      fetch: this.ctx.options.opencodeFetch,
      // Endpoints here come from persisted pair configuration or operator-supplied CLI flags, so
      // Basic credentials over plain HTTP to a known remote host remain the operator's choice.
      allowInsecureAuth: true
    };
  }

    private firstWorkerServer() {
    return this.ctx.getPairs().find((pair) => pair.worker.server?.baseUrl)?.worker.server;
  }

    private firstPlannerBrowser() {
    return this.ctx.getPairs().find((pair) => pair.planner.browser?.cdpUrl)?.planner.browser;
  }

    toToolError(error: unknown): DesktopApplicationError {
    if (error instanceof DesktopToolError) {
      return new DesktopApplicationError(error.code, error.message, error.details);
    }
    return new DesktopApplicationError("TOOL_START_FAILED", messageOf(error));
  }
}
