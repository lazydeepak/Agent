import { dirname, join, resolve } from "node:path";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import type { EventRecord } from "../contracts/events.js";
import { EventLog } from "./event-log.js";
import { PlannerSeedingService } from "./planner-seeding-service.js";
import { WorkerSessionService } from "./worker-session-service.js";
import { WorkerQuestionService } from "./worker-question-service.js";
import { readWorkerTranscript } from "./worker-transcript-service.js";
import { LiveChatGPTBrowserAdapter, type ChatGPTReadinessProbe } from "../adapters/chatgpt/index.js";
import { LiveOpenCodeAdapter, type OpenCodeSessionManager, type OpenCodeSessionSummary } from "../adapters/opencode/index.js";
import { SqliteRelayStore, ensureDbParent, resolveDbPath, PairArchive, type ArchiveStore, type ArchivedPairPayload, type ArchivedPairSummary, type RelayStore } from "../persistence/index.js";
import { ExternalBrowserManager, type BrowserManager } from "../recovery/index.js";
import { LockRegistry, createPairAdapters, isFailedRuntime, type RuntimeAdapterOptions, type RuntimeStatusSummary } from "../runtime/index.js";
import type { OpenCodeModelInfo, OpenCodeModelRef } from "../adapters/opencode/http.js";
import { ConfigError } from "../sessions/pairs.js";
import { ChatGptUrlError, parseChatGptConversationUrl } from "../sessions/chatgpt-url.js";
import { validatePair } from "../validator/readiness.js";
import { PairConfigError, PairConfigRepository, type PairEdits } from "./pair-config-repository.js";
import {
  LocalDesktopToolLauncher,
  type DesktopToolLauncher,
  type ToolActionResult,
  type ToolLaunchResult
} from "./desktop-tool-manager.js";
import type { PairReadinessReport, PairsConfig, SessionPair, SupervisorContinuity } from "../types.js";
import type { RelayableMessage } from "../types.js";
import type { SupervisorRecoveryOptions, SupervisorReport } from "../supervisor/supervisor.js";
import { UNIVERSAL_PLANNER_PROMPT, UNIVERSAL_PLANNER_PROMPT_VERSION } from "./universal-planner-prompt.js";
import { RelayEngine } from "./relay-engine.js";

export interface DesktopServiceOptions {
  configPath: string;
  dbPath?: string;
  liveOpenCode?: boolean;
  liveChatGPT?: boolean;
  opencode?: {
    baseUrl?: string;
    username?: string;
    password?: string;
    passwordEnv?: string;
  };
  chatgpt?: {
    cdpUrl?: string;
    executablePath?: string;
    userDataDir?: string;
    headless?: boolean;
    timeoutMs?: number;
  };
  pollIntervalMs?: number;
  stuckAfterMs?: number;
  stabilityMs?: number;
  relay?: boolean;
  recoveryPolicy?: "safe" | "none";
  recoveryMaxAttempts?: number;
  maxEvents?: number;
  onLog?: (line: string) => void;
  opencodeFetch?: typeof fetch;
  chatgptProbe?: ChatGPTReadinessProbe;
  openCodeDesktopScan?: () => Promise<OpenCodeSessionInfo>;
  desktopToolLauncher?: DesktopToolLauncher;
  relayEngine: RelayEngine;
}

export type DesktopEventRecord = EventRecord;

export interface ProjectLifecycleSummary extends RuntimeStatusSummary {
  projectPairId: string;
  pairResults: Array<{ pairId: string; outcome: string; error?: string }>;
  aggregate: "success" | "partial" | "failed";
}

import type {
  PairStartPriming,
  WorkerModelInfo,
  ValidatedPair,
  PairDetail,
  OpenCodeSessionInfo,
  OpenCodeEndpointInput,
  OpenCodeEndpointTestInput,
  CreateOpenCodeSessionInput,
  ChatGptUrlInput,
  ParsedChatGptUrl,
  PlannerEndpointInput,
  StartOpenCodeServerInput,
  EndpointTestResult,
  WorkerSessionDesktopAlignment,
  AutomationInfo,
  PlannerSeedResult,
  LocalAgentFeedResult,
  CandidatePairInput,
  UpdatePairInput
} from "../contracts/desktop.js";

export type {
  PairStartPriming,
  WorkerModelInfo,
  ValidatedPair,
  PairDetail,
  OpenCodeSessionInfo,
  OpenCodeEndpointInput,
  OpenCodeEndpointTestInput,
  CreateOpenCodeSessionInput,
  ChatGptUrlInput,
  ParsedChatGptUrl,
  PlannerEndpointInput,
  StartOpenCodeServerInput,
  EndpointTestResult,
  WorkerSessionDesktopAlignment,
  AutomationInfo,
  PlannerSeedResult,
  LocalAgentFeedResult,
  CandidatePairInput,
  UpdatePairInput
} from "../contracts/desktop.js";

const DEFAULT_MAX_EVENTS = 500;

export class DesktopApplicationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DesktopApplicationError";
    this.code = code;
    this.details = details;
  }
}

export function toDesktopApplicationError(error: unknown): DesktopApplicationError {
  if (error instanceof DesktopApplicationError) {
    return error;
  }
  if (error instanceof PairConfigError) {
    return new DesktopApplicationError(error.code, error.message);
  }
  if (error instanceof ChatGptUrlError) {
    return new DesktopApplicationError("PLANNER_URL_ERROR", error.message, { reason: error.code });
  }
  if (error instanceof ConfigError) {
    return new DesktopApplicationError("CONFIG_ERROR", error.message);
  }
  if (error instanceof Error) {
    if (error.name === "RuntimeError") {
      return new DesktopApplicationError("RUNTIME_ERROR", error.message);
    }
    if (error.name === "RegistryError") {
      return new DesktopApplicationError("REGISTRY_ERROR", error.message);
    }
    return new DesktopApplicationError("APPLICATION_ERROR", error.message);
  }
  return new DesktopApplicationError("APPLICATION_ERROR", String(error));
}

export interface RecentEventsFilter {
  pairId?: string;
  limit?: number;
}

export class DesktopApplicationService {
  private readonly options: DesktopServiceOptions;
  private readonly maxEvents: number;
  private readonly configRepo: PairConfigRepository;
  private readonly desktopTools: DesktopToolLauncher;
  private store: RelayStore | undefined;
  private archive: ArchiveStore | undefined;
  private readonly relayEngine: RelayEngine;
  private browserLocks: LockRegistry | undefined;
  private pairs: SessionPair[] = [];
  private readonly eventLog: EventLog;
  private readonly workerSessions: WorkerSessionService;
  private readonly plannerSeeding: PlannerSeedingService;
  private lastValidation: Map<string, PairReadinessReport> = new Map();
  private disposed = false;
  // Serializes configuration mutations against orchestrator-owning start/stop
  // operations so a pair cannot start after the quiescence check but before a
  // mutation's refreshPairs() discards the orchestrator. FIFO promise chain.
  private lifecycleChain: Promise<void> = Promise.resolve();

  private withLifecycleMutex<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleChain;
    let release!: () => void;
    this.lifecycleChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(() => fn()).finally(release);
  }

  constructor(options: DesktopServiceOptions) {
    this.options = options;
    this.relayEngine = options.relayEngine;
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.configRepo = new PairConfigRepository(options.configPath);
    this.desktopTools = options.desktopToolLauncher ?? new LocalDesktopToolLauncher();
    this.eventLog = new EventLog({ maxEvents: this.maxEvents });
    this.workerSessions = new WorkerSessionService({
      options,
      tools: this.desktopTools,
      getPairDetail: (pairId) => this.getPairDetail(pairId),
      getPairs: () => this.pairs,
      adapterOptions: () => this.adapterOptions(),
      assertKnownPair: (pairId) => this.assertKnownPair(pairId),
      assertPairStopped: (pairId) => this.assertPairStopped(pairId),
      ensureBrowserLocks: () => (this.browserLocks ??= new LockRegistry()),
      recordEvent: (type, pairId, extras) => this.recordEvent(type, pairId, extras),
      rebindWorker: (pairId, sessionId) => this.rebindWorker(pairId, sessionId)
    });
    this.plannerSeeding = new PlannerSeedingService({
      relay: Boolean(options.relay),
      getPairDetail: (pairId) => this.getPairDetail(pairId),
      adapterOptions: () => this.adapterOptions(),
      assertPairStopped: (pairId) => this.assertPairStopped(pairId),
      ensureBrowserLocks: () => (this.browserLocks ??= new LockRegistry()),
      ensureStore: () => this.ensureStore(),
      recordEvent: (type, pairId, extras) => this.recordEvent(type, pairId, extras),
      updatePairConfig: async (pairId, edits) => {
        await this.configRepo.updatePair(pairId, edits as PairEdits);
        await this.refreshPairs();
      }
    });
    this.relayEngine.setPlannerSeeding(this.plannerSeeding);
    this.relayEngine.subscribeEvents?.((event: any) => {
      this.recordEvent(event.type, event.pairId, { details: event.details });
    });
  }

  get configPath(): string {
    return this.options.configPath;
  }

  getAutomationInfo(): AutomationInfo {
    return {
      mode: this.options.relay ? "relay" : "observe",
      universalPrompt: UNIVERSAL_PLANNER_PROMPT,
      universalPromptVersion: UNIVERSAL_PLANNER_PROMPT_VERSION
    };
  }

  async init(): Promise<void> {
    if (this.disposed) {
      throw new DesktopApplicationError("SERVICE_DISPOSED", "The desktop application service has been disposed.");
    }
    const dbPath = resolveDbPath(this.options.dbPath);
    try {
      await ensureDbParent(dbPath);
      const store = new SqliteRelayStore(dbPath);
      await store.init();
      this.store = store;
      const archive = new PairArchive(join(dirname(dbPath), "archive"));
      await archive.init();
      this.archive = archive;
    } catch (error) {
      throw toDesktopApplicationError(error);
    }
    try {
      const config = await this.loadConfig();
      try {
        this.relayEngine.reconfigurePairs(config.pairs);
        this.pairs = config.pairs;
      } catch (error) {
        this.pairs = [];
        this.recordEvent("CONFIG_LOAD_FAILED", undefined, { reason: messageOf(error) });
      }
    } catch (error) {
      // Config errors are surfaced through listPairs status; the service stays usable.
      this.pairs = [];
      this.recordEvent("CONFIG_LOAD_FAILED", undefined, { reason: messageOf(error) });
    }
  }

  private async loadConfig(): Promise<PairsConfig> {
    return this.configRepo.load();
  }

  private requirePairs(): SessionPair[] {
    return this.pairs;
  }

  private ensureStore(): RelayStore {
    if (!this.store) {
      throw new DesktopApplicationError("STORE_UNAVAILABLE", "Relay store is not available.");
    }
    return this.store;
  }

  private requireArchive(): ArchiveStore {
    if (!this.archive) {
      throw new DesktopApplicationError("ARCHIVE_UNAVAILABLE", "The pair archive is not available.");
    }
    return this.archive;
  }

  private adapterOptions(): RuntimeAdapterOptions {
    return {
      opencode: this.options.opencode,
      chatgpt: this.options.chatgpt,
      liveOpenCode: this.options.liveOpenCode,
      liveChatGPT: this.options.liveChatGPT,
      browserLocks: this.browserLocks
    };
  }

  listPairs(): PairDetail[] {
    return this.pairs.map((pair) => this.toPairDetail(pair));
  }

  getTimeline(pairId?: string, limit: number = 50): Array<{ time: string; pairId?: string; projectPairId?: string; type: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> }> {
    const events: Array<{ time: string; pairId?: string; projectPairId?: string; type: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> }> = [];
    try {
      const logPath = resolve("logs", "supervisor.ndjson");
      if (existsSync(logPath)) {
        // Bounded tail read: only the last (limit + in-memory capacity) lines are
        // parsed, so a long-running supervisor log never forces a full-file read.
        const lines = readLastLogLines(logPath, limit + this.maxEvents);
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as { time?: string; pairId?: string; type?: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> };
            this.pushTimelineEvent(events, event, pairId);
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // Log file unreadable; return empty or memory-only
    }
    // Also include in-memory events (survive only while process running; JSONL is durable)
    const memoryEvents = this.eventLog.all().filter((e) => pairId === undefined || e.pairId === pairId || e.projectPairId === pairId);
    for (const event of memoryEvents) {
      events.push({
        time: event.time,
        pairId: event.pairId,
        projectPairId: event.projectPairId,
        type: event.type,
        state: event.state,
        previousState: event.previousState,
        reason: event.reason ?? "",
        details: event.details
      });
    }
    const sorted = events.sort((a, b) => (a.time < b.time ? -1 : 1));
    const deduped = sorted.filter((e, i) => i === 0 || !(e.time === sorted[i - 1]?.time && e.type === sorted[i - 1]?.type && e.pairId === sorted[i - 1]?.pairId));
    const limited = deduped.slice(-limit);
    return limited;
  }

  /**
   * Normalizes a raw log-line/in-memory event into the timeline shape.
   * Session-pair ids stay in `pairId`; project-scoped events (whose id matches a
   * configured projectPairId) are surfaced through `projectPairId` instead.
   */
  private pushTimelineEvent(
    events: Array<{ time: string; pairId?: string; projectPairId?: string; type: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> }>,
    raw: { time?: string; pairId?: string; type?: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> },
    filterPairId?: string
  ): void {
    const rawPairId = raw.pairId;
    const isProjectEvent = rawPairId !== undefined && !this.pairs.some((pair) => pair.pairId === rawPairId);
    const normalized = {
      time: raw.time ?? new Date().toISOString(),
      pairId: isProjectEvent ? undefined : rawPairId,
      projectPairId: isProjectEvent ? rawPairId : undefined,
      type: raw.type ?? "UNKNOWN",
      state: raw.state,
      previousState: raw.previousState,
      reason: raw.reason ?? "",
      details: raw.details
    };
    if (filterPairId && normalized.pairId !== filterPairId && normalized.projectPairId !== filterPairId) {
      return;
    }
    events.push(normalized);
  }

  getStatus(): RuntimeStatusSummary {
    const rawStatus = this.relayEngine.getStatus();
    return {
      ...rawStatus,
      pairs: rawStatus.pairs.map((pair) => ({ ...pair, hasRelayHistory: this.hasRelayHistory(pair.pairId) }))
    };
  }

  getPairStatus(pairId: string) {
    this.assertKnownPair(pairId);
    const status = this.relayEngine.getPairStatus(pairId);
    if (!status) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    return { ...status, hasRelayHistory: this.hasRelayHistory(pairId) };
  }

  getPairDetail(pairId: string): SessionPair | undefined {
    return this.pairs.find((pair) => pair.pairId === pairId);
  }

  getSupervisorContinuity(pairId: string): SupervisorContinuity | undefined {
    const store = this.ensureStore();
    try {
      return store.getSupervisorState(pairId);
    } catch {
      return undefined;
    }
  }

  getLastValidation(pairId: string): ValidatedPair | undefined {
    const report = this.lastValidation.get(pairId);
    if (!report) {
      return undefined;
    }
    return {
      pairId: report.pairId,
      status: report.status,
      checks: report.checks.map((check) => ({ name: check.name, status: check.status, reason: check.reason })),
      validatedAt: report.validatedAt
    };
  }

  async validatePair(pairId: string): Promise<ValidatedPair> {
    const pair = this.getPairDetail(pairId);
    if (!pair) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    const adapters = createPairAdapters(pair, this.adapterOptions());
    const report = await validatePair(pair, adapters, new Date());
    const sessionRepoCheck = await this.verifyWorkerSessionRepo(pair, adapters);
    if (sessionRepoCheck) {
      report.checks = [...report.checks, sessionRepoCheck];
      if (sessionRepoCheck.status === "FAIL") {
        report.status = "NOT_READY";
      }
    }
    this.lastValidation.set(pairId, report);
    this.recordEvent("PAIR_VALIDATED", pairId, {
      reason: report.status,
      details: { validatedAt: report.validatedAt, failedChecks: report.checks.filter((c) => c.status === "FAIL").length }
    });
    return {
      pairId: report.pairId,
      status: report.status,
      checks: report.checks.map((check) => ({ name: check.name, status: check.status, reason: check.reason })),
      validatedAt: report.validatedAt
    };
  }

  async seedPlanner(pairId: string): Promise<PlannerSeedResult> {
    return this.plannerSeeding.seedPlanner(pairId);
  }

  async feedLocalAgentPrompt(pairId: string): Promise<LocalAgentFeedResult> {
    return this.plannerSeeding.feedLocalAgentPrompt(pairId);
  }

  private async verifyWorkerSessionRepo(
    pair: SessionPair,
    adapters: { worker: OpenCodeSessionManager }
  ): Promise<{ name: string; status: "PASS" | "FAIL"; reason: string; mandatory: boolean } | undefined> {
    const sessionId = pair.worker.sessionId;
    const configuredRepo = pair.worker.repoPath?.trim() ?? "";
    if (!sessionId || !configuredRepo) {
      return undefined;
    }
    try {
      const info = await adapters.worker.getSession(sessionId);
      if (!info) {
        return { name: "worker.sessionRepoMatch", status: "PASS", reason: "Worker session not found; ownership unknown (UNKNOWN) — no repo verification possible.", mandatory: true };
      }
      const sessionRepoPath = info.repoPath ?? (info as any).directory ?? (info as any).location?.directory ?? (info as any).location?.repoPath ?? (info as any).location?.project?.directory ?? "";
      if (!sessionRepoPath) {
        return { name: "worker.sessionRepoMatch", status: "PASS", reason: "Worker session reply lacks repository path; ownership unknown (UNKNOWN) — allowing conservative continue.", mandatory: true };
      }
      const configuredResolved = resolve(configuredRepo);
      const sessionResolved = resolve(sessionRepoPath);
      if (configuredResolved === sessionResolved) {
        return { name: "worker.sessionRepoMatch", status: "PASS", reason: `Verified: session belongs to ${sessionRepoPath}.`, mandatory: true };
      }
      return {
        name: "worker.sessionRepoMatch",
        status: "FAIL",
        reason: `WORKER_SESSION_REPO_MISMATCH: session belongs to "${sessionRepoPath}" but pair is configured for repo "${configuredRepo}". Reselect a compatible session or update repository.`,
        mandatory: true
      };
    } catch {
      return { name: "worker.sessionRepoMatch", status: "PASS", reason: "Worker session ownership could not be verified (UNKNOWN); allowing conservative continue.", mandatory: true };
    }
  }

  async startProject(projectPairId: string): Promise<ProjectLifecycleSummary> {
    const members = this.pairs.filter(
      (p) => p.projectPairId === projectPairId || (!p.projectPairId && !projectPairId)
    );
    const eligible = members.filter((candidate) => candidate.enabled);
    return this.withLifecycleMutex(async () => {
      const pairResults: Array<{ pairId: string; outcome: string; error?: string }> = [];
      for (const pair of eligible) {
        try {
          await this.startPairUnlocked(pair.pairId);
          pairResults.push({ pairId: pair.pairId, outcome: "started" });
        } catch (error) {
          const code = (error instanceof DesktopApplicationError ? error.code : "FAILED");
          pairResults.push({ pairId: pair.pairId, outcome: code, error: messageOf(error) });
        }
      }
      const status = this.getStatus();
      const anyFailed = pairResults.some((r) => r.outcome !== "started");
      const anyStarted = pairResults.some((r) => r.outcome === "started");
      const summary: ProjectLifecycleSummary = {
        ...status,
        projectPairId,
        pairResults,
        aggregate: anyFailed ? (anyStarted ? "partial" : "failed") : "success"
      };
      // Preserve structured per-pair result through event for visibility
      this.recordEvent("PROJECT_LIFECYCLE_STARTED", undefined, {
        projectPairId,
        reason: summary.aggregate,
        details: { requestedAction: "start", pairResults }
      });
      return summary;
    });
  }

  async resumeProject(projectPairId: string): Promise<ProjectLifecycleSummary> {
    return this.startProject(projectPairId);
  }

  async pauseProject(projectPairId: string): Promise<RuntimeStatusSummary> {
    const members = this.pairs.filter(
      (p) => p.projectPairId === projectPairId || (!p.projectPairId && !projectPairId)
    );
    const eligible = members.filter(
      (p) => {
        const status = this.relayEngine.getPairStatus(p.pairId);
        return p.enabled && (status?.runtimeState === "RUNNING" || status?.runtimeState === "STARTING");
      }
    );
    return this.withLifecycleMutex(async () => {
      const results: Array<{ pairId: string; status: string }> = [];
      for (const pair of eligible) {
        try {
          await this.pausePair(pair.pairId);
          results.push({ pairId: pair.pairId, status: "paused" });
        } catch (error) {
          results.push({ pairId: pair.pairId, status: (error instanceof DesktopApplicationError ? error.code : "FAILED") + ": " + messageOf(error) });
        }
      }
      this.recordEvent("PROJECT_LIFECYCLE_PAUSED", undefined, {
        projectPairId,
        details: { requestedAction: "pause", results }
      });
      return this.getStatus();
    });
  }

  async startPair(pairId: string, priming?: PairStartPriming): Promise<RuntimeStatusSummary> {
    return this.withLifecycleMutex(() => this.startPairUnlocked(pairId, priming));
  }

  /**
   * Start implementation without the lifecycle mutex. `startProject` already holds the mutex and
   * must call this directly: re-entering the mutex from inside its own critical section would
   * deadlock (the outer chain can only release after the inner call resolves).
   */
  private async startPairUnlocked(pairId: string, priming?: PairStartPriming): Promise<RuntimeStatusSummary> {
    this.assertKnownPair(pairId);
    const pairDetail = this.getPairDetail(pairId);
    if (!pairDetail) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    const sessionRepoResult = pairDetail.worker?.sessionId && pairDetail.worker?.repoPath
      ? await this.verifyWorkerSessionRepo(pairDetail as SessionPair, createPairAdapters(pairDetail as SessionPair, this.adapterOptions()))
      : undefined;
    if (sessionRepoResult?.status === "FAIL") {
      throw new DesktopApplicationError(
        "WORKER_SESSION_REPO_MISMATCH",
        sessionRepoResult.reason
      );
    }
    try {
      await this.relayEngine.startPair(pairId, priming);
    } catch (error) {
      throw toDesktopApplicationError(error);
    }
    this.storeResume(pairId, true);
    return this.relayEngine.getStatus();
  }

  async listWorkerModels(pairId: string): Promise<WorkerModelInfo[]> {
    return this.workerSessions.listWorkerModels(pairId);
  }
  async switchWorkerModel(pairId: string, model: OpenCodeModelRef, notifyPlanner = false): Promise<void> {
    return this.withLifecycleMutex(() => this.switchWorkerModelUnlocked(pairId, model, notifyPlanner));
  }

  private async switchWorkerModelUnlocked(pairId: string, model: OpenCodeModelRef, notifyPlanner = false): Promise<void> {
    return this.workerSessions.switchWorkerModel(pairId, model, notifyPlanner);
  }
  async resumeWithFallbackModel(pairId: string, fallbackModel: OpenCodeModelRef): Promise<RuntimeStatusSummary> {
    return this.withLifecycleMutex(async () => {
      this.assertKnownPair(pairId);
      this.assertPairStopped(pairId);
      await this.switchWorkerModelUnlocked(pairId, fallbackModel);
      const pair = this.getPairDetail(pairId);
      if (!pair) {
        throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}" after model switch.`);
      }
      const worker = this.workerModelAdapter(pair);
      const continueMessage: RelayableMessage = {
        id: `continue-${pair.pairId}-${Date.now()}`,
        source: "planner",
        role: "user",
        text: "continue",
        createdAt: Date.now()
      };
      try {
        const receipt = await worker.sendPlannerMessage(pair.worker, continueMessage);
        if (!receipt.delivered || receipt.workerStartBlocked) throw new Error("Continue was submitted but worker start was not confirmed.");
      } catch (error) {
        throw new DesktopApplicationError(
          "CONTINUE_FAILED",
          `Failed to send continue prompt to worker: ${messageOf(error)}`,
          { sessionId: pair.worker.sessionId, modelId: fallbackModel.id }
        );
      }
      this.recordEvent("WORKER_RESUMED", pairId, {
        reason: "Worker model switched and continue prompt sent.",
        details: { modelId: fallbackModel.id, sessionId: pair.worker.sessionId }
      });
      const status = this.relayEngine.getStatus();
      return status;
    });
  }

  private async primePair(pairId: string, priming: PairStartPriming): Promise<void> {
    return this.plannerSeeding.primePair(pairId, priming);
  }

  async stopPair(pairId: string): Promise<RuntimeStatusSummary> {
    return this.withLifecycleMutex(async () => {
      this.assertKnownPair(pairId);
      try {
        await this.relayEngine.stopPair(pairId);
      } catch (error) {
        throw toDesktopApplicationError(error);
      }
      this.storeResume(pairId, false);
      return this.relayEngine.getStatus();
    });
  }

  pausePair(pairId: string): RuntimeStatusSummary {
    this.assertKnownPair(pairId);
    try {
      this.relayEngine.pausePair(pairId);
    } catch (error) {
      throw toDesktopApplicationError(error);
    }
    return this.relayEngine.getStatus();
  }

  resumePair(pairId: string): RuntimeStatusSummary {
    this.assertKnownPair(pairId);
    try {
      this.relayEngine.resumePair(pairId);
    } catch (error) {
      throw toDesktopApplicationError(error);
    }
    return this.relayEngine.getStatus();
  }

  async startAll(): Promise<RuntimeStatusSummary> {
    return this.withLifecycleMutex(async () => {
      if (this.options.liveOpenCode) {
        const endpoint = this.getOpenCodeEndpoint();
        const adapter = new LiveOpenCodeAdapter(this.openCodeClientOptions(endpoint));
        try {
          await adapter.checkServer();
        } catch (error) {
          throw new DesktopApplicationError(
            "OPENCODE_SERVER_UNREACHABLE",
            `OpenCode server at ${endpoint} is unreachable. Start the server first, then retry.`
          );
        }
      }

      try {
        await this.relayEngine.startAll();
      } catch (error) {
        throw toDesktopApplicationError(error);
      }
      for (const pair of this.pairs.filter((candidate) => candidate.enabled)) {
        this.storeResume(pair.pairId, true);
      }
      return this.relayEngine.getStatus();
    });
  }

  async stopAll(): Promise<RuntimeStatusSummary> {
    return this.withLifecycleMutex(async () => {
      try {
        await this.relayEngine.stopAll();
      } catch (error) {
        throw toDesktopApplicationError(error);
      }
      for (const pair of this.pairs) {
        this.storeResume(pair.pairId, false);
      }
      return this.relayEngine.getStatus();
    });
  }

  getRecentEvents(filter: RecentEventsFilter = {}): DesktopEventRecord[] {
    return this.eventLog.recent(filter);
  }

  subscribeEvents(listener: (event: DesktopEventRecord) => void): () => void {
    return this.eventLog.subscribe(listener);
  }

  async listOpenCodeSessions(pairId: string): Promise<OpenCodeSessionInfo[]> {
    return this.workerSessions.listOpenCodeSessions(pairId);
  }
  getOpenCodeEndpoint(): string {
    return this.workerSessions.getOpenCodeEndpoint();
  }
  getChatGptEndpoint(): string {
    return this.workerSessions.getChatGptEndpoint();
  }
  async discoverOpenCodeSessions(options: OpenCodeEndpointInput = {}): Promise<OpenCodeSessionInfo[]> {
    return this.workerSessions.discoverOpenCodeSessions(options);
  }
  async scanOpenCodeDesktopSession(): Promise<OpenCodeSessionInfo> {
    return this.workerSessions.scanOpenCodeDesktopSession();
  }

  async alignWorkerSessionWithOpenCodeDesktop(pairId: string): Promise<WorkerSessionDesktopAlignment> {
    return this.workerSessions.alignWorkerSessionWithOpenCodeDesktop(pairId);
  }
  async createOpenCodeSession(input: CreateOpenCodeSessionInput): Promise<OpenCodeSessionInfo> {
    return this.workerSessions.createOpenCodeSession(input);
  }
  async testOpenCodeEndpoint(options: OpenCodeEndpointTestInput = {}): Promise<EndpointTestResult> {
    return this.workerSessions.testOpenCodeEndpoint(options);
  }
  async startOpenCodeServer(input: StartOpenCodeServerInput): Promise<ToolLaunchResult> {
    return this.workerSessions.startOpenCodeServer(input);
  }
  async updateOpenCodeCommand(): Promise<ToolActionResult> {
    return this.workerSessions.updateOpenCodeCommand();
  }
  parseChatGptUrl(input: ChatGptUrlInput): ParsedChatGptUrl {
    try {
      const parsed = parseChatGptConversationUrl(input.url);
      return {
        conversationId: parsed.conversationId,
        conversationUrl: parsed.conversationUrl,
        ...(parsed.project ? { project: parsed.project } : {})
      };
    } catch (error) {
      throw toDesktopApplicationError(error);
    }
  }

  async testPlannerEndpoint(options: PlannerEndpointInput = {}): Promise<EndpointTestResult> {
    const cdpUrl = options.cdpUrl ?? this.getChatGptEndpoint();
    const probe = this.options.chatgptProbe;
    const planner: SessionPair["planner"] = {
      type: "chatgpt-browser",
      conversationId: "probe",
      conversationUrl: options.conversationUrl ?? "https://chatgpt.com/c/probe",
      browser: { cdpUrl }
    };
    const adapter = new LiveChatGPTBrowserAdapter({
      ...(cdpUrl ? { cdpUrl } : {}),
      probe,
      lock: undefined
    });
    try {
      const checks = await adapter.checkReadiness(planner);
      const browserReachable = checks.find((check) => check.name === "planner.browserReachable");
      return {
        ok: browserReachable?.status === "PASS",
        message:
          browserReachable?.status === "PASS"
            ? "Chrome automation endpoint is reachable."
            : "Chrome automation endpoint is not reachable. Start the dedicated automation browser with remote debugging enabled, then retry.",
        checks: checks.map((check) => ({ name: check.name, status: check.status, reason: check.reason }))
      };
    } catch (error) {
      return {
        ok: false,
        message: `Chrome automation endpoint is not reachable. Start the dedicated automation browser with remote debugging enabled, then retry. (${messageOf(error)})`
      };
    }
  }

  async startAutomationBrowser(options: PlannerEndpointInput = {}): Promise<ToolLaunchResult> {
    try {
      return await this.desktopTools.startBrowser({ cdpUrl: options.cdpUrl ?? this.getChatGptEndpoint() });
    } catch (error) {
      throw this.desktopToolApplicationError(error);
    }
  }

  async validateCandidatePair(input: CandidatePairInput): Promise<ValidatedPair> {
    const pair = this.candidateToPair(input);
    const adapters = createPairAdapters(pair, this.adapterOptions());
    const report = await validatePair(pair, adapters, new Date());
    return {
      pairId: report.pairId,
      status: report.status,
      checks: report.checks.map((check) => ({ name: check.name, status: check.status, reason: check.reason })),
      validatedAt: report.validatedAt
    };
  }

  async createPair(input: CandidatePairInput): Promise<PairDetail> {
    return this.withLifecycleMutex(async () => {
      this.assertOrchestratorQuiescentForConfigMutation();
      const pair = this.candidateToPair(input);
      try {
        await this.configRepo.addPair(pair);
      } catch (error) {
        throw toDesktopApplicationError(error);
      }
      await this.refreshPairs();
      this.recordEvent("PAIR_CREATED", pair.pairId, { details: { enabled: pair.enabled } });
      const detail = this.pairs.find((candidate) => candidate.pairId === pair.pairId);
      if (!detail) {
        throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pair.pairId}".`);
      }
      return this.toPairDetail(detail);
    });
  }

  async updatePair(pairId: string, input: UpdatePairInput): Promise<PairDetail> {
    return this.withLifecycleMutex(async () => {
      this.assertOrchestratorQuiescentForConfigMutation();
      this.assertPairStopped(pairId);
      const edits: PairEdits = {};
      if (input.enabled !== undefined) {
        edits.enabled = input.enabled;
      }
      if (input.localAgentMode !== undefined) {
        edits.localAgentMode = input.localAgentMode;
      }
      if (input.worker) {
        edits.worker = {};
        if (input.worker.sessionId !== undefined) edits.worker.sessionId = input.worker.sessionId;
        if (input.worker.repoPath !== undefined) edits.worker.repoPath = input.worker.repoPath;
        if (input.worker.server !== undefined) edits.worker.server = { ...(edits.worker.server ?? {}), ...input.worker.server };
      }
      if (input.planner) {
        edits.planner = {};
        if (input.planner.conversationId !== undefined) edits.planner.conversationId = input.planner.conversationId;
        if (input.planner.conversationUrl !== undefined) edits.planner.conversationUrl = input.planner.conversationUrl;
        if (input.planner.browser !== undefined) {
          edits.planner.browser = { ...(edits.planner.browser ?? {}), ...input.planner.browser };
        }
      }
      try {
        await this.configRepo.updatePair(pairId, edits);
      } catch (error) {
        throw toDesktopApplicationError(error);
      }
      await this.refreshPairs();
      this.recordEvent("PAIR_UPDATED", pairId, {});
      const detail = this.pairs.find((candidate) => candidate.pairId === pairId);
      if (!detail) {
        throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
      }
      return this.toPairDetail(detail);
    });
  }

  async removePair(pairId: string): Promise<{ pairId: string }> {
    return this.withLifecycleMutex(async () => {
      this.assertOrchestratorQuiescentForConfigMutation();
      this.assertPairStopped(pairId);
      const detail = this.getPairDetail(pairId);
      if (!detail) {
        throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
      }
      const store = this.ensureStore();
      const payload: ArchivedPairPayload = {
        pairId,
        archivedAt: new Date().toISOString(),
        config: {
          pairId: detail.pairId,
          enabled: detail.enabled,
          projectPairId: detail.projectPairId,
          worker: detail.worker,
          planner: {
            type: detail.planner.type,
            conversationId: detail.planner.conversationId,
            conversationUrl: detail.planner.conversationUrl,
            browser: detail.planner.browser
          }
        },
        records: store.listRecords(pairId),
        cycles: store.listCycles(pairId),
        state: {
          pair: store.getPairState(pairId),
          supervisor: store.getSupervisorState(pairId),
          runtime: store.getRuntimeState(pairId)
        }
      };
      let ref: string;
      try {
        ref = await this.requireArchive().archive(payload);
      } catch (error) {
        throw toDesktopApplicationError(error);
      }
      try {
        await this.configRepo.removePair(pairId);
      } catch (error) {
        // Compensate: a failed config removal must not leave an orphaned archive
        // artifact for a pair that is still configured and active.
        try {
          await this.requireArchive().remove(ref);
        } catch {
          // Best-effort compensation; the config error below is the actionable one.
        }
        throw toDesktopApplicationError(error);
      }
      try {
        store.purgePairData(pairId);
      } catch (error) {
        this.recordEvent("PAIR_REMOVED_PURGE_FAILED", pairId, { reason: messageOf(error) });
      }
      await this.refreshPairs();
      this.recordEvent("PAIR_REMOVED", pairId, { details: { archivedRef: ref } });
      return { pairId };
    });
  }

  async listArchivedPairs(): Promise<ArchivedPairSummary[]> {
    return this.requireArchive().list();
  }

  async deleteArchivedPair(ref: string): Promise<{ ref: string }> {
    await this.requireArchive().remove(ref);
    return { ref };
  }

  async rebindWorker(pairId: string, sessionId: string): Promise<PairDetail> {
    return this.withLifecycleMutex(async () => {
      this.assertOrchestratorQuiescentForConfigMutation();
      this.assertPairStopped(pairId);
      try {
        await this.configRepo.updatePair(pairId, { worker: { sessionId } });
      } catch (error) {
        throw toDesktopApplicationError(error);
      }
      await this.refreshPairs();
      this.recordEvent("PAIR_REBOUND", pairId, { details: { sessionId } });
      const detail = this.pairs.find((candidate) => candidate.pairId === pairId);
      if (!detail) {
        throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
      }
      return this.toPairDetail(detail);
    });
  }

  async createWorkerSessionForPair(pairId: string, title?: string): Promise<PairDetail> {
    return this.withLifecycleMutex(async () => {
      this.assertKnownPair(pairId);
      this.assertPairStopped(pairId);
      const pair = this.getPairDetail(pairId);
      if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
      const worker = new LiveOpenCodeAdapter({
        ...pair.worker.server,
        ...this.options.opencode,
        fetch: this.options.opencodeFetch
      });
      let session: OpenCodeSessionSummary;
      try {
        const resolvedTitle = title?.trim() || await this.workerSessions.nextWorkerSessionTitle(pair, worker);
        session = await worker.createSession({
          repoPath: pair.worker.repoPath,
          title: resolvedTitle
        });
        await this.configRepo.updatePair(pairId, { worker: { sessionId: session.sessionId } });
      } catch (error) {
        throw new DesktopApplicationError(
          "WORKER_SESSION_CREATE_FAILED",
          `Could not create and bind a new OpenCode worker session: ${messageOf(error)}`
        );
      }
      await this.refreshPairs();
      this.recordEvent("WORKER_SESSION_CREATED", pairId, {
        reason: `Created and bound OpenCode worker session ${session.sessionId}.`,
        details: { sessionId: session.sessionId, repoPath: pair.worker.repoPath, title: session.title }
      });
      const detail = this.pairs.find((candidate) => candidate.pairId === pairId);
      if (!detail) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
      return this.toPairDetail(detail);
    });
  }

  async suggestWorkerSessionTitle(pairId: string): Promise<string> {
    return this.workerSessions.suggestWorkerSessionTitle(pairId);
  }
  async openWorkerSession(pairId: string): Promise<{ sessionId: string; selected: boolean; fallback: boolean }> {
    return this.workerSessions.openWorkerSession(pairId);
  }
  private questionService?: WorkerQuestionService;

  private workerQuestions(): WorkerQuestionService {
    return this.questionService ??= new WorkerQuestionService({ ...this.options.opencode, fetch: this.options.opencodeFetch });
  }

  async listWorkerQuestions(pairId: string) {
    const pair = this.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", "Unknown pair.");
    return this.workerQuestions().list(pair);
  }

  async getWorkerTranscript(pairId: string) {
    const pair = this.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", "Unknown pair.");
    return readWorkerTranscript(pair, { ...this.options.opencode, fetch: this.options.opencodeFetch });
  }

  async answerWorkerQuestion(pairId: string, requestId: string, answers: string[][]) {
    const pair = this.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", "Unknown pair.");
    await this.workerQuestions().answer(pair, requestId, answers);
    this.recordEvent("WORKER_QUESTION_ANSWERED", pairId, { details: { sessionId: pair.worker.sessionId, requestId } });
    return { answered: true };
  }
  async shutdown(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      await this.relayEngine.shutdown();
    } finally {
      try {
        await this.desktopTools.shutdown();
      } finally {
        this.store?.close();
        this.store = undefined;
        this.eventLog.clear();
      }
    }
  }

  private assertKnownPair(pairId: string): void {
    if (!this.pairs.some((pair) => pair.pairId === pairId)) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}". Check the configured pairs.`);
    }
  }

  private requiresInitialPlannerHandoff(pairId: string): boolean {
    return this.plannerSeeding.requiresInitialPlannerHandoff(pairId);
  }

  private hasRelayHistory(pairId: string): boolean {
    if (!this.store) {
      return false;
    }
    return this.store.listCycles(pairId).length > 0 || this.store.listRecords(pairId).length > 0;
  }

  private workerModelAdapter(pair: SessionPair): LiveOpenCodeAdapter {
    return this.workerSessions.adapterFor(pair);
  }
  private desktopToolApplicationError(error: unknown): DesktopApplicationError {
    return this.workerSessions.toToolError(error);
  }
  private openCodeClientOptions(baseUrl: string) {
    return this.workerSessions.openCodeClientOptions(baseUrl);
  }
  private candidateToPair(input: CandidatePairInput): SessionPair {
    return {
      pairId: input.pairId,
      enabled: true,
      worker: {
        type: "opencode",
        sessionId: input.worker.sessionId,
        repoPath: input.worker.repoPath,
        ...(input.worker.server ? { server: input.worker.server } : {})
      },
      planner: {
        type: "chatgpt-browser",
        conversationId: input.planner.conversationId,
        conversationUrl: input.planner.conversationUrl,
        ...(input.planner.browser ? { browser: input.planner.browser } : {})
      },
      ...(input.projectPairId ? { projectPairId: input.projectPairId.trim() } : {})
    };
  }

  private toPairDetail(pair: SessionPair): PairDetail {
    return {
      pairId: pair.pairId,
      enabled: pair.enabled,
      localAgentMode: pair.localAgentMode,
      projectPairId: pair.projectPairId,
      worker: {
        type: pair.worker.type,
        sessionId: pair.worker.sessionId,
        repoPath: pair.worker.repoPath,
        server: pair.worker.server
          ? { baseUrl: pair.worker.server.baseUrl, apiProtocol: pair.worker.server.apiProtocol }
          : undefined
      },
      planner: {
        type: pair.planner.type,
        conversationId: pair.planner.conversationId,
        conversationUrl: pair.planner.conversationUrl,
        browser: pair.planner.browser ? { cdpUrl: pair.planner.browser.cdpUrl } : undefined,
        automation: pair.planner.automation
      }
    };
  }

  private async refreshPairs(): Promise<void> {
    const loaded = await this.configRepo.load();
    try {
      this.relayEngine.reconfigurePairs(loaded.pairs);
      this.pairs = loaded.pairs;
    } catch (error) {
      throw toDesktopApplicationError(error);
    }
  }

  /**
   * Guard for configuration mutations that inspect the orchestrator.
   * Ensures no runtime owned by the orchestrator is active (STARTING/RUNNING/PAUSED/STOPPING).
   * Rejects the mutation if any pair has an active runtime state.
   */
  private assertOrchestratorQuiescentForConfigMutation(): void {
    for (const pair of this.pairs) {
      const status = this.relayEngine.getPairStatus(pair.pairId);
      // A pair not yet observed in the orchestrator is not running, so it is
      // skipped; later pairs may still be active and must still be checked.
      if (!status) continue;
      const activeStates = ["STARTING", "RUNNING", "PAUSED", "STOPPING"];
      if (activeStates.includes(status.runtimeState)) {
        throw new DesktopApplicationError(
          "PAIR_RUNNING",
          `Pair "${pair.pairId}" must be stopped before editing, rebinding, or removing it. Stop the pair first.`
        );
      }
    }
  }

  private assertPairStopped(pairId: string): void {
    const status = this.relayEngine.getPairStatus(pairId);
    if (!status) {
      return;
    }
    const activeStates = ["STARTING", "RUNNING", "PAUSED", "STOPPING"];
    if (activeStates.includes(status.runtimeState)) {
      throw new DesktopApplicationError(
        "PAIR_RUNNING",
        `Pair "${pairId}" must be stopped before editing, rebinding, or removing it. Stop the pair first.`
      );
    }
  }

  private storeResume(pairId: string, resumeAfterRestart: boolean): void {
    const store = this.ensureStore();
    try {
      store.touchResumeState({ pairId, resumeAfterRestart });
    } catch {
      // Resume intent is best-effort; a store failure must not break start/stop.
    }
  }

  getStore(): RelayStore | undefined {
    return this.store;
  }

  /**
   * Runtime-safe store access for startup paths.
   * Never use a non-null assertion on getStore(); call this instead so a
   * failed store initialization surfaces as an explicit fatal error rather
   * than an undefined store flowing into worker progress / IPC / runtime.
   */
  requireStore(): RelayStore {
    if (!this.store) {
      throw new DesktopApplicationError(
        "STORE_UNAVAILABLE",
        "Agent Relay could not open its local database. Close other instances, check disk permissions for the database directory, then relaunch."
      );
    }
    return this.store;
  }

  getResumeState(): Array<{ pairId: string; resumeAfterRestart: boolean }> {
    const store = this.ensureStore();
    const resume = new Map(store.listResumeState().map((entry) => [entry.pairId, entry.resumeAfterRestart ?? true]));
    return this.pairs.map((pair) => ({ pairId: pair.pairId, resumeAfterRestart: resume.get(pair.pairId) ?? false }));
  }

  async resumeManagedPairs(): Promise<void> {
    const store = this.ensureStore();
    const resume = new Set(store.listResumeState().map((entry) => entry.pairId));
    const toResume = this.pairs.filter((pair) => pair.enabled && resume.has(pair.pairId));
    if (toResume.length === 0) return;

    if (this.options.liveOpenCode) {
      // Pre-flight: check shared OpenCode endpoint
      const endpoint = this.getOpenCodeEndpoint();
      const adapter = new LiveOpenCodeAdapter(this.openCodeClientOptions(endpoint));
      try {
        await adapter.checkServer();
      } catch (error) {
        // Log warning but don't block resume — pairs will enter DISCONNECTED on their own
        this.recordEvent("OPENCODE_SERVER_UNREACHABLE", undefined, {
          reason: `OpenCode server at ${endpoint} unreachable: ${error instanceof Error ? error.message : String(error)}`
        });
        return;
      }
    }

    const results = await Promise.allSettled(toResume.map((pair) => this.startPair(pair.pairId)));
    for (let index = 0; index < results.length; index += 1) {
      if (results[index].status === "rejected") {
        const pairId = toResume[index].pairId;
        const reason = (results[index] as PromiseRejectedResult).reason;
        this.recordEvent("PAIR_RESUME_FAILED", pairId, {
          reason: reason instanceof Error ? reason.message : String(reason)
        });
      }
    }
  }

  getManagedState(): ManagedState {
    return deriveManagedState(this.getStatus());
  }

  private recoveryOptions(pair: SessionPair): SupervisorRecoveryOptions | undefined {
    if (this.options.recoveryPolicy === undefined) {
      return undefined;
    }
    const browser: BrowserManager = new ExternalBrowserManager();
    return {
      policy: this.options.recoveryPolicy === "none" ? "none" : "safe",
      browser,
      maxAttempts: this.options.recoveryMaxAttempts,
      baseUrl: pair.worker.server?.baseUrl,
      startServerLauncher:
        this.options.recoveryPolicy === "safe"
          ? (repoPath, baseUrl) => this.desktopTools.startOpenCode({ repoPath, baseUrl })
          : undefined
    };
  }

  private onReport(report: SupervisorReport): void {
    this.options.onLog?.(`${report.pairId}  ${report.state}  ${report.observedAt}`);
  }

private recordEvent(
    type: string,
    pairId: string | undefined,
    extras: { projectPairId?: string; reason?: string; details?: Record<string, unknown> } = {}
  ): void {
    const inferredProjectId = pairId !== undefined && !this.pairs.some((pair) => pair.pairId === pairId);
    this.eventLog.record(type, {
      ...(pairId === undefined || inferredProjectId ? {} : { pairId }),
      ...(extras.projectPairId
        ? { projectPairId: extras.projectPairId }
        : inferredProjectId
          ? { projectPairId: pairId }
          : {}),
      ...(extras.reason === undefined ? {} : { reason: extras.reason }),
      ...(extras.details === undefined ? {} : { details: extras.details })
    });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads at most the last `maxLines` non-empty lines from a text file without
 * loading the whole file. Reads backwards in fixed-size chunks so cost is
 * bounded by the tail, not by total file size.
 */
function readLastLogLines(filePath: string, maxLines: number): string[] {
  const fd = openSync(filePath, "r");
  try {
    const size = fstatSync(fd).size;
    const chunkSize = 64 * 1024;
    const lines: string[] = [];
    let remainder = Buffer.alloc(0);
    let position = size;
    while (position > 0 && lines.length <= maxLines) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const buffer = Buffer.alloc(length + remainder.length);
      readSync(fd, buffer, 0, length, position);
      remainder.copy(buffer, length);
      const newlineIndex = buffer.lastIndexOf(0x0a);
      if (newlineIndex === -1) {
        remainder = buffer;
        continue;
      }
      const complete = buffer.subarray(0, newlineIndex).toString("utf8");
      remainder = buffer.subarray(newlineIndex + 1);
      const parts = complete.split("\n");
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        if (parts[index].trim().length > 0) {
          lines.unshift(parts[index]);
        }
      }
    }
    if (remainder.length > 0 && remainder.toString("utf8").trim().length > 0) {
      lines.unshift(remainder.toString("utf8"));
    }
    return lines.slice(-maxLines);
  } finally {
    closeSync(fd);
  }
}

/**
 * Deterministic, order-independent fingerprint of the configured pairs. Used to
 * decide whether an existing orchestrator still matches the current
 * configuration, covering identity (pair ids) plus every field that affects
 * runtime behavior: enabled/state, worker session/repo/endpoint identity, and
 * planner conversation/browser routing. Sensitive credential values are
 * included only as presence flags and never surfaced.
 */
export function fingerprintPairs(pairs: SessionPair[]): string {
  const normalized = pairs
    .map((pair) => ({
      pairId: pair.pairId,
      enabled: pair.enabled,
      localAgentMode: pair.localAgentMode ?? false,
      worker: {
        type: pair.worker.type,
        sessionId: pair.worker.sessionId,
        repoPath: pair.worker.repoPath,
        baseUrl: pair.worker.server?.baseUrl,
        hasUsername: workerServerAuth(pair).length > 0
      },
      planner: {
        type: pair.planner.type,
        conversationId: pair.planner.conversationId,
        conversationUrl: pair.planner.conversationUrl,
        browser: pair.planner.browser
          ? {
              cdpUrl: pair.planner.browser.cdpUrl,
              executablePath: pair.planner.browser.executablePath,
              userDataDir: pair.planner.browser.userDataDir,
              headless: pair.planner.browser.headless,
              timeoutMs: pair.planner.browser.timeoutMs
            }
          : undefined
      }
    }))
    .sort((a, b) => (a.pairId < b.pairId ? -1 : a.pairId > b.pairId ? 1 : 0));
  return JSON.stringify(normalized);
}

function workerServerAuth(pair: SessionPair): string {
  const server = pair.worker.server;
  if (!server) {
    return "";
  }
  return [server.username ?? "", server.password ? "password-set" : "", server.passwordEnv ?? ""].join("|");
}

export type ManagedState = "RUNNING" | "ARMED" | "FAILED" | "STOPPED";

export function deriveManagedState(summary: RuntimeStatusSummary): ManagedState {
  const running = summary.pairs.filter((pair) => pair.runtimeState === "STARTING" || pair.runtimeState === "RUNNING");
  if (running.length === 0) {
    return "STOPPED";
  }
  if (running.some((pair) => isFailedRuntime(pair))) {
    return "FAILED";
  }
  if (running.every((pair) => pair.schedulerMode === "DORMANT_WATCH")) {
    return "ARMED";
  }
  return "RUNNING";
}
