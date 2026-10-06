import { clipboard } from "electron";
import { DesktopApplicationError, type DesktopApplicationService } from "../../src/application/desktop-service.js";
import type { ProjectPairService } from "../../src/application/project-pair-service.js";
import type { WorkerProgressService } from "../../src/application/worker-progress.js";
import type { DesktopErrorDto } from "../shared/dto.js";
import { IPC_CHANNELS, WORKER_PROGRESS_CHANNEL } from "../shared/ipc-channels.js";
import {
  asHttpUrl,
  asArchiveRef,
  asNonEmptyString,
  asPairId,
  asProjectPairId,
  castCdpUrl,
  castCandidatePair,
  castCreateProjectPair,
  castCreateWorkerSession,
  castOpenCodeEndpoint,
  castOpenCodeEndpointTest,
  castPlannerEndpoint,
  castRecentEventsFilter,
  castStartPriming,
  castStartWorkerServer,
  castUpdatePair,
  castUrlInput,
  castWorkerModel,
  castWorkerSessionTitle
} from "./ipc-input.js";

function requireWorkerSessionIdInline(service: DesktopApplicationService, pairId: string): string {
  const pair = service.getPairDetail(pairId);
  if (!pair) {
    throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
  }
  return pair.worker.sessionId;
}

function resolvePairOpenCodeOptions(pair: { worker?: { server?: { baseUrl?: string } } }): { baseUrl?: string } | undefined {
  const serverUrl = pair.worker?.server?.baseUrl;
  if (!serverUrl) return undefined;
  return { baseUrl: serverUrl };
}

/** Channels registered by `registerIpcHandlers`, used by the owning process to unregister. */
export const registeredIpcChannels: string[] = [];

export interface IpcContext {
  handle(channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void;
  requireService(): DesktopApplicationService;
  requireWorkerProgress(): WorkerProgressService;
  requireProjectPairService(): ProjectPairService;
  broadcastToRenderer(channel: string, payload: unknown): void;
  /** Opens an authenticated browser window for a worker session; resolves true when foregrounded. */
  openWorkerAuthWindow(input: { url: string; title: string; origin: string; username?: string; secret?: string }): Promise<boolean>;
  openExternalUrl(url: string): Promise<void>;
}
export function serializeError(error: unknown): DesktopErrorDto {
  if (error instanceof DesktopApplicationError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error) {
    return { code: "APPLICATION_ERROR", message: error.message };
  }
  return { code: "APPLICATION_ERROR", message: String(error) };
}

function guarded(
  fn: (event: unknown, ...args: unknown[]) => unknown
): (event: unknown, ...args: unknown[]) => Promise<{ ok: true; data: unknown } | { ok: false; error: DesktopErrorDto }> {
  return async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  };
}

export function registerIpcHandlers(ctx: IpcContext): void {
  // Call sites already pass an envelope-wrapped `guarded(...)` handler, so this
  // helper must register it as-is. Wrapping again here would double-envelope
  // responses and the preload would unwrap only one layer.
  const handle = (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void => {
    ctx.handle(channel, fn);
    registeredIpcChannels.push(channel);
  };
  handle(IPC_CHANNELS.listWorkerQuestions, guarded(async (_e, pairId) => ctx.requireService().listWorkerQuestions(asPairId(pairId))));
  handle(IPC_CHANNELS.getWorkerTranscript, guarded(async (_e, pairId) => ctx.requireService().getWorkerTranscript(asPairId(pairId))));
  handle(IPC_CHANNELS.answerWorkerQuestion, guarded(async (_e, pairId, input) => {
    if (!input || typeof input !== "object") throw new Error("Invalid question reply.");
    const reply = input as { requestId?: unknown; answers?: unknown };
    if (typeof reply.requestId !== "string" || !/^que_[A-Za-z0-9_-]+$/.test(reply.requestId) || !Array.isArray(reply.answers)) throw new Error("Invalid question reply.");
    return ctx.requireService().answerWorkerQuestion(asPairId(pairId), reply.requestId, reply.answers as string[][]);
  }));
  handle(IPC_CHANNELS.listPairs, guarded(async () => ctx.requireService().listPairs()));
  handle(IPC_CHANNELS.status, guarded(async () => ctx.requireService().getStatus()));
  handle(IPC_CHANNELS.pairStatus, guarded(async (_e, pairId: unknown) => ctx.requireService().getPairStatus(asPairId(pairId))));
  handle(IPC_CHANNELS.pairDetail, guarded(async (_e, pairId: unknown) => ctx.requireService().getPairDetail(asPairId(pairId))));
  handle(IPC_CHANNELS.pausePair, guarded(async (_e, pairId: unknown) => ctx.requireService().pausePair(asPairId(pairId))));
  handle(IPC_CHANNELS.resumePair, guarded(async (_e, pairId: unknown) => ctx.requireService().resumePair(asPairId(pairId))));
  handle(IPC_CHANNELS.startPair, guarded(async (_e, pairId: unknown, priming: unknown) => ctx.requireService().startPair(asPairId(pairId), castStartPriming(priming))));
  handle(IPC_CHANNELS.stopPair, guarded(async (_e, pairId: unknown) => ctx.requireService().stopPair(asPairId(pairId))));
  handle(IPC_CHANNELS.startAll, guarded(async () => ctx.requireService().startAll()));
  handle(IPC_CHANNELS.stopAll, guarded(async () => ctx.requireService().stopAll()));
  handle(IPC_CHANNELS.validatePair, guarded(async (_e, pairId: unknown) => ctx.requireService().validatePair(asPairId(pairId))));
  handle(IPC_CHANNELS.getValidation, guarded(async (_e, pairId: unknown) => ctx.requireService().getLastValidation(asPairId(pairId))));
  handle(IPC_CHANNELS.getRecentEvents, guarded(async (_e, filter: unknown) => ctx.requireService().getRecentEvents(castRecentEventsFilter(filter))));
  handle(IPC_CHANNELS.getAutomationInfo, guarded(async () => ctx.requireService().getAutomationInfo()));
  handle(IPC_CHANNELS.seedPlanner, guarded(async (_e, pairId: unknown) => ctx.requireService().seedPlanner(asPairId(pairId))));
  handle(
    IPC_CHANNELS.feedLocalAgent,
    guarded(async (_e, pairId: unknown) => ctx.requireService().feedLocalAgentPrompt(asPairId(pairId)))
  );
  handle(IPC_CHANNELS.listOpenCodeSessions, guarded(async (_e, pairId: unknown) => ctx.requireService().listOpenCodeSessions(asPairId(pairId))));
  handle(IPC_CHANNELS.getOpenCodeEndpoint, guarded(async () => ctx.requireService().getOpenCodeEndpoint()));
  handle(IPC_CHANNELS.getChatGptEndpoint, guarded(async () => ctx.requireService().getChatGptEndpoint()));
  handle(
    IPC_CHANNELS.discoverWorkerSessions,
    guarded(async (_e, input: unknown) => ctx.requireService().discoverOpenCodeSessions(castOpenCodeEndpoint(input)))
  );
  handle(
    IPC_CHANNELS.scanDesktopWorkerSession,
    guarded(async () => ctx.requireService().scanOpenCodeDesktopSession())
  );
  handle(
    IPC_CHANNELS.alignWorkerSessionWithOpenCodeDesktop,
    guarded(async (_e, pairId: unknown) =>
      ctx.requireService().alignWorkerSessionWithOpenCodeDesktop(asPairId(pairId))
    )
  );
  handle(
    IPC_CHANNELS.startWorkerServer,
    guarded(async (_e, input: unknown) => ctx.requireService().startOpenCodeServer(castStartWorkerServer(input)))
  );
  handle(IPC_CHANNELS.updateOpenCode, guarded(async () => ctx.requireService().updateOpenCodeCommand()));
  handle(
    IPC_CHANNELS.createWorkerSession,
    guarded(async (_e, input: unknown) => ctx.requireService().createOpenCodeSession(castCreateWorkerSession(input)))
  );
  handle(
    IPC_CHANNELS.testWorkerEndpoint,
    guarded(async (_e, input: unknown) => ctx.requireService().testOpenCodeEndpoint(castOpenCodeEndpointTest(input)))
  );
  handle(
    IPC_CHANNELS.parsePlannerUrl,
    guarded(async (_e, input: unknown) => ctx.requireService().parseChatGptUrl(castUrlInput(input)))
  );
  handle(
    IPC_CHANNELS.testPlannerEndpoint,
    guarded(async (_e, input: unknown) => ctx.requireService().testPlannerEndpoint(castPlannerEndpoint(input)))
  );
  handle(
    IPC_CHANNELS.startPlannerBrowser,
    guarded(async (_e, input: unknown) => ctx.requireService().startAutomationBrowser(castPlannerEndpoint(input)))
  );
  handle(
    IPC_CHANNELS.validateCandidate,
    guarded(async (_e, input: unknown) => ctx.requireService().validateCandidatePair(castCandidatePair(input)))
  );
  handle(
    IPC_CHANNELS.createPair,
    guarded(async (_e, input: unknown) => ctx.requireService().createPair(castCandidatePair(input)))
  );
  handle(
    IPC_CHANNELS.updatePair,
    guarded(async (_e, pairId: unknown, input: unknown) => {
      const svc = ctx.requireService();
      const id = asPairId(pairId);
      const previous = svc.getPairDetail(id);
      const result = await svc.updatePair(id, castUpdatePair(input));
      if (
        previous?.worker.sessionId !== result.worker.sessionId ||
        previous?.worker.server?.baseUrl !== result.worker.server?.baseUrl
      ) {
        ctx.requireWorkerProgress().invalidate(id);
        ctx.broadcastToRenderer(WORKER_PROGRESS_CHANNEL, { pairId: id });
      }
      return result;
    })
  );
  handle(IPC_CHANNELS.removePair, guarded(async (_e, pairId: unknown) => {
    const svc = ctx.requireService();
    const id = asPairId(pairId);
    const pair = svc.getPairDetail(id);
    const result = await svc.removePair(id);
    if (pair) {
      ctx.requireWorkerProgress().invalidate(id, pair.worker.sessionId);
    }
    return result;
  }));
  handle(
    IPC_CHANNELS.rebindWorker,
    guarded(async (_e, pairId: unknown, sessionId: unknown) => {
      const svc = ctx.requireService();
      const id = asPairId(pairId);
      const pair = svc.getPairDetail(id);
      const oldSessionId = pair?.worker.sessionId;
      const result = svc.rebindWorker(id, asNonEmptyString(sessionId, "sessionId"));
      if (oldSessionId) {
        ctx.requireWorkerProgress().invalidate(id, oldSessionId);
      }
      ctx.broadcastToRenderer(WORKER_PROGRESS_CHANNEL, { pairId: id });
      return result;
    })
  );
  handle(
    IPC_CHANNELS.createWorkerSessionForPair,
    guarded(async (_e, pairId: unknown, input: unknown) => {
      const id = asPairId(pairId);
      const result = await ctx.requireService().createWorkerSessionForPair(id, castWorkerSessionTitle(input));
      ctx.requireWorkerProgress().invalidate(id);
      ctx.broadcastToRenderer(WORKER_PROGRESS_CHANNEL, { pairId: id });
      return result;
    })
  );
  handle(
    IPC_CHANNELS.getTimeline,
    guarded(async (_e, filter: unknown) => {
      const svc = ctx.requireService();
      const pairId = (filter as { pairId?: string })?.pairId;
      const limit = (filter as { limit?: number })?.limit ?? 50;
      return svc.getTimeline(pairId, limit);
    })
  );
  handle(
    IPC_CHANNELS.startProject,
    guarded(async (_e, projectPairId: unknown) => {
      const svc = ctx.requireService();
      const result = await svc.startProject(String(projectPairId ?? ""));
      return result;
    })
  );
  handle(
    IPC_CHANNELS.pauseProject,
    guarded(async (_e, projectPairId: unknown) => {
      const svc = ctx.requireService();
      const result = await svc.pauseProject(String(projectPairId ?? ""));
      return result;
    })
  );
  handle(
    IPC_CHANNELS.resumeProject,
    guarded(async (_e, projectPairId: unknown) => {
      const svc = ctx.requireService();
      const result = await svc.resumeProject(String(projectPairId ?? ""));
      return result;
    })
  );
  handle(
    IPC_CHANNELS.suggestWorkerSessionTitle,
    guarded(async (_e, pairId: unknown) => ctx.requireService().suggestWorkerSessionTitle(asPairId(pairId)))
  );
  handle(
    IPC_CHANNELS.openWorkerSession,
    guarded(async (_e, pairId: unknown) => {
      const svc = ctx.requireService();
      const id = asPairId(pairId);
      const pair = svc.getPairDetail(id);
      if (!pair) {
        throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${id}".`);
      }
      const baseUrl = pair.worker.server?.baseUrl || "";
      const sessionId = pair.worker.sessionId || "";
      let foregrounded = false;
      try {
        // Open the server URL with the bound session in the browser
        // The OpenCode web UI uses the format: /server/<base64(baseUrl)>/session/<sessionId>
        if (baseUrl && sessionId) {
          const encodedServer = Buffer.from(baseUrl).toString("base64");
          const raw = new URL(`${baseUrl}/server/${encodedServer}/session/${encodeURIComponent(sessionId)}`);
          if (raw.protocol !== "http:" && raw.protocol !== "https:") {
            throw new DesktopApplicationError("INVALID_URL", "The worker server URL must use http or https.");
          }
          const url = raw;
          const serverConfig = (pair.worker.server || {}) as { username?: string; password?: string; passwordEnv?: string };
          const username = serverConfig.username || process.env.AGENT_RELAY_OPENCODE_USERNAME || "opencode";
          const secret =
            serverConfig.password ||
            (serverConfig.passwordEnv ? process.env[serverConfig.passwordEnv] : undefined) ||
            process.env.AGENT_RELAY_OPENCODE_PASSWORD ||
            process.env.OPENCODE_SERVER_PASSWORD;
          // Match the OpenCode client’s credential sources. If the managed server is protected
          // by an environment password, opening the system browser would otherwise discard it.
          const needsAuth = Boolean(serverConfig.username || secret);
          if (needsAuth) {
            foregrounded = await ctx.openWorkerAuthWindow({
              url: url.toString(),
              title: `OpenCode: ${pairId}`,
              origin: url.origin,
              username,
              secret: secret || ""
            });
          } else {
            await ctx.openExternalUrl(url.toString());
            foregrounded = true;
          }
} else if (baseUrl) {
          // Fall back to just the base URL if no sessionId is configured
          const url = asHttpUrl(baseUrl, "baseUrl");
          await ctx.openExternalUrl(url);
          foregrounded = true;
        }
      } catch {
        // Session selection below can still succeed when desktop activation is unavailable.
      }
      // Always attempt to select the session via the adapter
      const selectResult = await svc.openWorkerSession(id);
      return { ...selectResult, foregrounded };
    })
  );
  handle(
    IPC_CHANNELS.listWorkerModels,
    guarded(async (_e, pairId: unknown) => {
      const models = await ctx.requireService().listWorkerModels(asPairId(pairId));
      return models.map((model) => ({
        providerId: model.providerID,
        modelId: model.id,
        name: model.name ?? `${model.providerID}/${model.id}`,
        current: model.current
      }));
    })
  );
  handle(
    IPC_CHANNELS.switchWorkerModel,
    guarded(async (_e, pairId: unknown, input: unknown) => {
      const id = asPairId(pairId);
      const model = castWorkerModel(input);
      const service = ctx.requireService();
      await service.switchWorkerModel(id, { providerID: model.providerId, id: model.modelId }, model.notifyPlanner);
      ctx.requireWorkerProgress().invalidate(id);
      ctx.broadcastToRenderer(WORKER_PROGRESS_CHANNEL, { pairId: id });
      return {
        pairId: id,
        sessionId: requireWorkerSessionIdInline(service, id),
        ...model,
        switchedAt: new Date().toISOString()
      };
    })
  );
  handle(
    IPC_CHANNELS.resumeWithFallbackModel,
    guarded(async (_e, pairId: unknown, input: unknown) => {
      const id = asPairId(pairId);
      const model = castWorkerModel(input);
      try { return await ctx.requireService().resumeWithFallbackModel(id, { providerID: model.providerId, id: model.modelId }); }
      finally { ctx.requireWorkerProgress().invalidate(id); ctx.broadcastToRenderer(WORKER_PROGRESS_CHANNEL, { pairId: id }); }
    })
  );
  handle(
    IPC_CHANNELS.getWorkerProgress,
    guarded(async (_e, pairId: unknown, forceRefresh: unknown) => {
      const svc = ctx.requireService();
      const id = asPairId(pairId);
      const pair = svc.getPairDetail(id);
      if (!pair) {
        throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${id}".`);
      }
      return ctx.requireWorkerProgress().getProgress(id, pair.worker.sessionId, forceRefresh === true, resolvePairOpenCodeOptions(pair));
    })
  );
  handle(
    IPC_CHANNELS.listProjectPairs,
    guarded(async () => ctx.requireProjectPairService().listProjectPairs())
  );
  handle(
    IPC_CHANNELS.createProjectPair,
    guarded(async (_e, input: unknown) => ctx.requireProjectPairService().createProjectPair(castCreateProjectPair(input)))
  );
  handle(
    IPC_CHANNELS.removeProjectPair,
    guarded(async (_e, projectPairId: unknown) => ctx.requireProjectPairService().removeProjectPair(asProjectPairId(projectPairId)))
  );
  handle(
    IPC_CHANNELS.discoverOpenCodeProjects,
    guarded(async () => ctx.requireProjectPairService().discoverOpenCodeProjects())
  );
  handle(
    IPC_CHANNELS.discoverChatGptProjects,
    guarded(async (_e, input: unknown) => ctx.requireProjectPairService().discoverChatGptProjects(castCdpUrl(input)))
  );
  handle(IPC_CHANNELS.listArchive, guarded(async () => ctx.requireService().listArchivedPairs()));
  handle(IPC_CHANNELS.copyText, guarded(async (_e, text: unknown) => {
    const textValue = typeof text === "string" ? text : String(text ?? "");
    clipboard.writeText(textValue);
    return { copied: true };
  }));
  handle(
    IPC_CHANNELS.deleteArchive,
    guarded(async (_e, ref: unknown) => ctx.requireService().deleteArchivedPair(asArchiveRef(ref)))
  );
}
