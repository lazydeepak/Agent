import { spawn } from "node:child_process";
import { app, dialog } from "electron";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listLogs, readLogTail } from "./log-reader.js";
import { promptAndStoreOpenCodeCredentials } from "./opencode-credentials.js";
import { discoverOpenCodeServerUrl } from "../../src/adapters/opencode/desktop-state.js";
import { saveOpenCodeEndpoint } from "./endpoint-settings.js";
import { DesktopApplicationError, type DesktopApplicationService } from "../../src/application/desktop-service.js";
import type { ProjectPairService } from "../../src/application/project-pair-service.js";
import type { WorkerProgressService } from "../../src/application/worker-progress.js";
import type { DesktopErrorDto } from "../../src/contracts/desktop.js";
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
  handle(IPC_CHANNELS.pausePair, guarded(async (_e, pairId: unknown) => ctx.requireService().pausePair(asPairId(pairId))));
  handle(IPC_CHANNELS.resumePair, guarded(async (_e, pairId: unknown) => ctx.requireService().resumePair(asPairId(pairId))));
  handle(IPC_CHANNELS.startPair, guarded(async (_e, pairId: unknown, priming: unknown) => ctx.requireService().startPair(asPairId(pairId), castStartPriming(priming))));
  handle(IPC_CHANNELS.stopPair, guarded(async (_e, pairId: unknown) => ctx.requireService().stopPair(asPairId(pairId))));
  handle(IPC_CHANNELS.startAll, guarded(async () => ctx.requireService().startAll()));
  handle(IPC_CHANNELS.stopAll, guarded(async () => ctx.requireService().stopAll()));
  handle(IPC_CHANNELS.getAutoResumeState, guarded(async () => ctx.requireService().getAutoResumeState()));
  handle(IPC_CHANNELS.setAutoResumeAfterRestart, guarded(async (_e, pairId: unknown, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("autoResumeAfterRestart must be a boolean.");
    return ctx.requireService().setAutoResumeAfterRestart(asPairId(pairId), enabled);
  }));
  handle(IPC_CHANNELS.getSettings, guarded(async () => ctx.requireService().getSettings()));
  handle(IPC_CHANNELS.releaseRecoverySuspension, guarded(async (_e, pairId: unknown) =>
    ctx.requireService().releaseRecoverySuspension(asPairId(pairId))));
  handle(IPC_CHANNELS.databaseInfo, guarded(async () => ctx.requireService().getDatabaseInfo()));
  handle(IPC_CHANNELS.backupDatabase, guarded(async () => ctx.requireService().backupDatabase()));
  handle(IPC_CHANNELS.listDatabaseBackups, guarded(async () => ctx.requireService().listDatabaseBackups()));
  handle(IPC_CHANNELS.revealDatabase, guarded(async () => {
    try {
      const { shell } = await import("electron");
      const dbPath = ctx.requireService().getDatabaseInfo().databasePath;
      shell.showItemInFolder(dbPath);
    } catch {
      // best effort; not fatal
    }
  }));
  handle(IPC_CHANNELS.restoreDatabase, guarded(async (_e, input: unknown) => {
    const fileName = (input as { fileName?: unknown } | undefined)?.fileName;
    if (typeof fileName !== "string" || fileName.length === 0) {
      throw new Error("fileName must be a non-empty string.");
    }
    const result = ctx.requireService().restoreDatabase(fileName);
    // Hard restart: the old store object and orchestrator are now detached from the restored file.
    app.relaunch();
    app.exit(0);
    return result;
  }));
  handle(IPC_CHANNELS.diagnosticsSnapshot, guarded(async () => {
    const snapshot = ctx.requireService().getDiagnosticsSnapshot();
    let projectPairsCount: number | null = null;
    try {
      projectPairsCount = (await ctx.requireProjectPairService().listProjectPairs()).length;
    } catch {
      projectPairsCount = null;
    }
    return { ...snapshot, config: { ...snapshot.config, projectPairsCount } };
  }));
  handle(IPC_CHANNELS.selectStartingSide, guarded(async (_e, pairId: unknown, side: unknown) => {
    if (side !== "planner" && side !== "worker") throw new Error("side must be 'planner' or 'worker'.");
    return ctx.requireService().selectStartingSide(asPairId(pairId), side);
  }));
  handle(IPC_CHANNELS.cancelIncident, guarded(async (_e, pairId: unknown) =>
    ctx.requireService().cancelIncident(asPairId(pairId))));
  handle(IPC_CHANNELS.updateSettings, guarded(async (_e, input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Settings payload must be an object.");
    const days = (input as { historyRetentionDays?: unknown }).historyRetentionDays;
    if (days !== undefined && (typeof days !== "number" || !Number.isFinite(days) || days < 0)) {
      throw new Error("historyRetentionDays must be a finite number >= 0.");
    }
    return ctx.requireService().updateSettings(days === undefined ? {} : { historyRetentionDays: days });
  }));
  handle(IPC_CHANNELS.validatePair, guarded(async (_e, pairId: unknown) => ctx.requireService().validatePair(asPairId(pairId))));
  handle(IPC_CHANNELS.initializePair, guarded(async (_e, pairId: unknown) => ctx.requireService().initializePair(asPairId(pairId))));
  handle(IPC_CHANNELS.getValidation, guarded(async (_e, pairId: unknown) => ctx.requireService().getLastValidation(asPairId(pairId))));
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
  handle(IPC_CHANNELS.syncDevProjects, guarded(async (_e, root: unknown) =>
    ctx.requireService().syncDevProjects(typeof root === "string" ? root : undefined)
  ));
  handle(IPC_CHANNELS.listSyncedProjects, guarded(async () => ctx.requireService().listSyncedProjects()));
  handle(
    IPC_CHANNELS.openPlannerTab,
    guarded(async (_e, pairId: unknown) => {
      const svc = ctx.requireService();
      const pair = svc.getPairDetail(asPairId(pairId));
      if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${String(pairId)}".`);
      const url = new URL(pair.planner.conversationUrl);
      if (url.protocol !== "https:" || !["chatgpt.com", "www.chatgpt.com"].includes(url.hostname)) {
        throw new DesktopApplicationError("INVALID_INPUT", "Planner tab URL must be an HTTPS ChatGPT URL.");
      }
      await ctx.openExternalUrl(url.toString());
    })
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
    IPC_CHANNELS.clearTimeline,
    guarded(async () => {
      ctx.requireService().clearTimeline();
      return { ok: true };
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
          const username = serverConfig.username || process.env.AGENT_OPENCODE_USERNAME || "opencode";
          const secret =
            serverConfig.password ||
            (serverConfig.passwordEnv ? process.env[serverConfig.passwordEnv] : undefined) ||
            process.env.AGENT_OPENCODE_PASSWORD ||
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
  handle(IPC_CHANNELS.duplicateReport, guarded(async () => {
    try {
      const raw = readFileSync(resolve("docs", "duplication-report.json"), "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data.status === "failed") {
        return { status: "failed" as const, error: String(data.error ?? "duplication analysis failed"), generatedAt: (data.generatedAt as string | undefined) ?? null };
      }
      if (data.status !== "ok") {
        return { status: "not-scanned" as const };
      }
      return { status: "ok" as const, report: data };
    } catch {
      return { status: "not-scanned" as const };
    }
  }));
  handle(IPC_CHANNELS.scanDuplicates, guarded(async (_e, minLines: unknown) => {
    const lines = typeof minLines === "number" && Number.isFinite(minLines) && minLines >= 1 ? Math.floor(minLines) : 10;
    try {
      const child = spawn(
        process.execPath,
        [resolve("scripts", "analyze-duplicates.mjs"), "--min-lines", String(lines)],
        { detached: true, stdio: "ignore", cwd: resolve(".") }
      );
      child.unref();
      return { started: true, minLines: lines, pid: child.pid };
    } catch (error) {
      return { started: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  handle(IPC_CHANNELS.codeIndex, guarded(async () => {
    try {
      const data = readFileSync(resolve("docs/code-index.json"), "utf8");
      return JSON.parse(data) as unknown;
    } catch {
      throw new DesktopApplicationError("CODE_INDEX_UNAVAILABLE", "The code index is not available. Run `npm run index:code` to generate it.");
    }
  }));
  handle(IPC_CHANNELS.pickFolder, guarded(async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose project folder",
      defaultPath: join(app.getPath("home"), "dev"),
      properties: ["openDirectory"]
    });
    return { folderPath: result.canceled ? undefined : result.filePaths[0] };
  }));
  handle(IPC_CHANNELS.listLogs, guarded(async () => listLogs()));
  handle(IPC_CHANNELS.readLogFile, guarded(async (_e, id: unknown) => readLogTail(asNonEmptyString(id, "logId"))));
  handle(IPC_CHANNELS.adapterSettings, guarded(async (_e, settings: unknown) => {
    const svc = ctx.requireService();
    const result = svc.applyAdapterSettings(settings);
    if (settings && typeof settings === "object" && "opencodeServer" in settings) {
      saveOpenCodeEndpoint(svc.getOpenCodeEndpoint());
    }
    return result;
  }));
  handle(IPC_CHANNELS.listPermissionGrants, guarded(async (_e, input: unknown) => {
    const pairId = (input as { pairId?: unknown } | undefined)?.pairId;
    return ctx.requireService().listPermissionGrants(typeof pairId === "string" ? pairId : undefined);
  }));
  handle(IPC_CHANNELS.grantPermission, guarded(async (_e, input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const scopeType =
      raw.scopeType === "project" || raw.scopeType === "pair" || raw.scopeType === "global" ? raw.scopeType : undefined;
    const rawScopeRef = typeof raw.scopeRef === "string" ? raw.scopeRef.trim() : "";
    const action =
      raw.action === "model-switch-outside-approved" || raw.action === "shared-service-restart" ? raw.action : undefined;
    const mode = raw.mode === "one-time" || raw.mode === "permanent" ? raw.mode : undefined;
    const note = typeof raw.note === "string" && raw.note.trim().length > 0 ? raw.note.trim().slice(0, 500) : undefined;
    if (!scopeType || !action || !mode) {
      throw new Error("permission grant requires scopeType (project|pair|global), action and mode.");
    }
    const scopeRef = scopeType === "global" ? "shared-opencode" : rawScopeRef;
    if (!scopeRef) {
      throw new Error("permission grant requires a non-empty scopeRef.");
    }
    return ctx.requireService().grantPermission({ scopeType, scopeRef, action, mode, note });
  }));
  handle(IPC_CHANNELS.revokePermission, guarded(async (_e, input: unknown) => {
    const grantId = Number((input as { grantId?: unknown } | undefined)?.grantId);
    if (!Number.isInteger(grantId) || grantId <= 0) {
      throw new Error("grantId must be a positive integer.");
    }
    return ctx.requireService().revokePermission(grantId);
  }));
  handle(
    IPC_CHANNELS.configureOpenCodeCredentials,
    guarded(async () => {
      const endpoint =
        process.env.AGENT_OPENCODE_BASE_URL ??
        (await discoverOpenCodeServerUrl()) ??
        ctx.requireService().getOpenCodeEndpoint();
      const result = await promptAndStoreOpenCodeCredentials(endpoint);
      return result;
    })
  );
  handle(
    IPC_CHANNELS.deleteArchive,
    guarded(async (_e, ref: unknown) => ctx.requireService().deleteArchivedPair(asArchiveRef(ref)))
  );
}
