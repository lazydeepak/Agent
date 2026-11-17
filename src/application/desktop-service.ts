/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/desktop-service.ts
 * Purpose: Electron desktop service integration.
 */
import { dirname, join, resolve } from "node:path";
import { closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { renameSync } from "node:fs";
import type { EventRecord } from "../contracts/events.js";
import { EventLog } from "./event-log.js";
import { PlannerSeedingService } from "./planner-seeding-service.js";
import { WorkerSessionService } from "./worker-session-service.js";
import { WorkerQuestionService } from "./worker-question-service.js";
import { readWorkerTranscript } from "./worker-transcript-service.js";
import { LiveChatGPTBrowserAdapter, type ChatGPTReadinessProbe } from "../adapters/chatgpt/index.js";
import { LiveOpenCodeAdapter, type OpenCodeSessionManager, type OpenCodeSessionSummary } from "../adapters/opencode/index.js";
import { SqliteRelayStore, ensureDbParent, resolveDbPath, EXPECTED_SCHEMA_VERSION, PairArchive, type ArchiveStore, type ArchivedPairPayload, type ArchivedPairSummary, type RelayStore } from "../persistence/index.js";
import { ExternalBrowserManager, type BrowserManager } from "../recovery/index.js";
import { LockRegistry, createPairAdapters, isFailedRuntime, type RuntimeAdapterOptions, type RuntimeStatusSummary } from "../runtime/index.js";
import type { OpenCodeModelInfo, OpenCodeModelRef } from "../types.js";
import type { DiagnosticsSnapshotDto, DatabaseSettingsInfoDto, DatabaseBackupEntryDto, DatabaseRestoreResultDto, PermissionGrantDto, PermissionGrantInputDto } from "../contracts/desktop.js";
import { ConfigError } from "../sessions/pairs.js";
import { ChatGptUrlError, parseChatGptConversationUrl } from "../util/chatgpt-url.js";
import { validatePair } from "../validator/readiness.js";
import { hashText } from "../util/canonical.js";
import { credentialsAllowed, isHttpUrl } from "../util/net.js";
import { PermissionService } from "./permission-service.js";
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
import { readSettings, writeSettings } from "./settings-repository.js";
import { createOpenCodeDesktopControl } from "./opencode-desktop.js";
import type { SettingsDto } from "../contracts/desktop.js";

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
  /**
   * v1.1 §11.5 — validates that a project pair id exists before a project-scoped grant is
   * recorded. Optional; when omitted, project-scoped grants are refused (fail closed).
   */
  validateProjectScope?: (projectPairId: string) => Promise<boolean> | boolean;
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

// REBUILD: desktop save -> adapter reload (opencode/chatgpt settings).
// REBUILD: applyAdapterSettings connects UI save to adapter reload.
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
      rebindWorker: (pairId, sessionId) => this.rebindWorker(pairId, sessionId),
      permissions: () => this.ensurePermissions()
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
      const configuredDays = readSettings().historyRetentionDays ?? 0;
      if (configuredDays > 0) {
        const result = this.ensureStore().applyHistoryRetention(configuredDays);
        this.recordEvent("HISTORY_RETENTION_APPLIED", undefined, {
          reason: `Applied history retention of ${configuredDays} days.`,
          details: result
        });
      }
    } catch (error) {
      // Retention is maintenance; a failure must not block startup.
      this.recordEvent("HISTORY_RETENTION_FAILED", undefined, { reason: messageOf(error) });
    }
    try {
      const config = await this.loadConfig();
      try {
        this.relayEngine.reconfigurePairs(config.pairs);
        this.pairs = config.pairs;
      } catch (error) {
        // A reconfigure failure here is almost always a stale persisted RUNNING marker from an
        // unclean shutdown (the pair is not running in this process). Hiding every pair from the UI
        // forever is strictly worse than showing them with unknown status, so keep the config list.
        // Configuration *edits* (refreshPairs) still use the strict guard.
        this.pairs = config.pairs;
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

  clearTimeline(): void {
    this.eventLog.clear();
    try {
      const logPath = resolve("logs", "supervisor.ndjson");
      if (existsSync(logPath)) {
        writeFileSync(logPath, "");
      }
    } catch {
      // Best effort truncation; memory log is already cleared above.
    }
    this.recordEvent("TIMELINE_CLEARED", undefined, { reason: "User cleared history." });
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

  async initializePair(pairId: string): Promise<ValidatedPair> {
    this.recordEvent("PAIR_INITIALIZING", pairId, { reason: "User requested initialization." });
    return this.validatePair(pairId);
  }

  getStatus(): RuntimeStatusSummary {
    const rawStatus = this.relayEngine.getStatus();
    return {
      ...rawStatus,
      pairs: rawStatus.pairs.map((pair) => {
        const side = this.sideState(pair.pairId);
        return {
          ...pair,
          ...this.deliveryEvidence(pair.pairId),
          ...side,
          awaitingStartingSideSelection: (pair.workerActivity === "working" && pair.plannerActivity === "working") && !side.startingSide
        };
      })
    };
  }

  getPairStatus(pairId: string) {
    this.assertKnownPair(pairId);
    const status = this.relayEngine.getPairStatus(pairId);
    if (!status) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    const side = this.sideState(pairId);
    return {
      ...status,
      ...this.deliveryEvidence(pairId),
      ...side,
      awaitingStartingSideSelection: (status.workerActivity === "working" && status.plannerActivity === "working") && !side.startingSide
    };
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
    // v1.1 §7.1–7.2 — establish and record the capture boundary for this start.
    // Both peers are probed as evidence; an unhealthy side never blocks Start,
    // but the relay dispatch path holds on NOT_READY until evidence arrives.
    try {
      const boundaryPair = this.getPairDetail(pairId);
      const adapters = boundaryPair ? createPairAdapters(boundaryPair as SessionPair, this.adapterOptions()) : undefined;
      const report = adapters ? await validatePair(boundaryPair as SessionPair, adapters, new Date()) : undefined;
      this.ensureStore().touchPairState({ pairId, lastCaptureBoundaryAt: new Date().toISOString() });
      const failedChecks = report?.checks.filter((check) => check.status === "FAIL").map((check) => check.name) ?? [];
      this.recordEvent("START_CAPTURE_BOUNDARY", pairId, {
        reason: report?.status === "READY"
          ? "Both peers reachable at start; capture boundary recorded."
          : "Start completed but peer capture is not verified; dispatch will hold until evidence arrives.",
        details: { status: report?.status ?? "unknown", failedChecks }
      });
      if (report && report.status !== "READY") {
        try {
          this.ensureStore().touchSupervisorState({
            pairId,
            lastError: `START_CAPTURE_NOT_READY:${failedChecks.join(",") || "unknown"}`
          });
        } catch {
          // Advisory marker; never fail Start on it.
        }
      }
    } catch (error) {
      this.recordEvent("START_CAPTURE_BOUNDARY", pairId, {
        reason: `Capture boundary could not be verified: ${error instanceof Error ? error.message : String(error)}`,
        details: { status: "unknown" }
      });
      try {
        this.ensureStore().touchPairState({ pairId, lastCaptureBoundaryAt: new Date().toISOString() });
      } catch {
        // Advisory; never fail Start on it.
      }
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
      const continueIdentity = {
        pairId,
        direction: "planner-to-worker" as const,
        sourceMessageId: continueMessage.id,
        sourceHash: hashText(continueMessage.text)
      };
      try {
        // v1.1 §3.2 — durable admission precedes the external send.
        this.ensureStore().createRecord(continueIdentity, continueMessage.createdAt, undefined, "operator");
        this.ensureStore().updateStatus(continueIdentity, "DELIVERING", {});
      } catch {
        throw new DesktopApplicationError(
          "ADMISSION_FAILED",
          "Could not durably admit the operator continue request; refusing to send it.",
          { sessionId: pair.worker.sessionId }
        );
      }
      try {
        const receipt = await worker.sendPlannerMessage(pair.worker, continueMessage);
        if (!receipt.delivered || receipt.workerStartBlocked) {
          try { this.ensureStore().updateStatus(continueIdentity, "DELIVERING", { error: "Continue submitted; delivery unverified." }); } catch { /* ledger retained */ }
          throw new Error("Continue was submitted but worker start was not confirmed.");
        }
        try { this.ensureStore().updateStatus(continueIdentity, "DELIVERED", { targetId: receipt.targetId }); } catch { /* ledger retained */ }
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
      this.clearAutoResumeToggle(pairId);
      return this.relayEngine.getStatus();
    });
  }

  /** v1.1 §7.3 — operator selects which side establishes the first turn while both peers are busy. */
  selectStartingSide(pairId: string, side: "planner" | "worker"): RuntimeStatusSummary {
    this.assertKnownPair(pairId);
    const store = this.ensureStore();
    store.setStartingSide(pairId, side);
    this.recordEvent("STARTING_SIDE_SELECTED", pairId, {
      reason: `Operator selected the ${side} side to establish the first turn (v1.1 §7.3).`,
      details: { side }
    });
    return this.relayEngine.getStatus();
  }

  /** v1.1 §12.2 — cancel an incident: pause the pair (the affected pair stays paused/held). Operator resumes explicitly. */
  cancelIncident(pairId: string): RuntimeStatusSummary {
    this.assertKnownPair(pairId);
    try {
      this.relayEngine.pausePair(pairId);
    } catch (error) {
      throw toDesktopApplicationError(error);
    }
    try {
      this.ensureStore().touchSupervisorState({ pairId, incidentDisposition: "held" });
    } catch (error) {
      // Disposition is advisory; never fail cancel on it.
      void error;
    }
    this.recordEvent("RECOVERY_CANCELLED", pairId, {
      reason: "Operator cancelled the incident. The pair is paused/held; nothing auto-retries (v1.1 §12.2).",
      details: { disposition: "held" }
    });
    return this.relayEngine.getStatus();
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
    // v1.1 §7.1 — resume establishes a new capture boundary; dispatch still requires reconciliation evidence.
    try {
      this.ensureStore().touchPairState({ pairId, lastCaptureBoundaryAt: new Date().toISOString() });
      this.recordEvent("RESUME_CAPTURE_BOUNDARY", pairId, {
        reason: "Resume establishes a fresh capture boundary before any dispatch.",
        details: { status: "boundary-recorded" }
      });
    } catch {
      // Advisory boundary record; never fail resume on it.
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
        this.clearAutoResumeToggle(pair.pairId);
      }
      // v1.1 §5.4: Stop All is a one-time command, not a persistent lock. It blocks relay transport,
      // disables Auto Resume for every pair, and requests Bot-owned Worker terminations. This engine
      // cannot distinguish Bot-owned processes from unrelated ones — termination is UNVERIFIED.
      for (const pair of this.pairs) {
        try {
          this.ensureStore()?.touchSupervisorState({ pairId: pair.pairId, incidentDisposition: "terminated_unverified" });
        } catch {
          // Disposition is advisory; never block Stop All on it.
        }
      }
      this.recordEvent("STOP_ALL_REQUESTED", undefined, {
        reason: "Stop All issued: relay transport blocked for all pairs, Auto Resume disabled for all pairs, Bot-owned Worker terminations requested. Termination is UNVERIFIED — do not report the command as proof that every Worker stopped.",
        details: { status: "termination-unverified" }
      });
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
  // --- v1.1 §11.5 — permission grants ---------------------------------------------------
  private permissionService?: PermissionService;

  private ensurePermissions(): PermissionService {
    if (!this.permissionService) {
      this.permissionService = new PermissionService({
        store: this.ensureStore(),
        validateScopeRef: async (scopeType, scopeRef) => {
          if (!scopeRef) {
            throw new DesktopApplicationError("INVALID_INPUT", "Grant scope must not be empty.");
          }
          if (scopeType === "pair") {
            if (!this.getPairDetail(scopeRef)) {
              throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${scopeRef}".`);
            }
            return scopeRef;
          }
          const validator = this.options.validateProjectScope;
          if (!validator) {
            // Fail closed: project scopes cannot be validated in this context.
            throw new DesktopApplicationError(
              "PROJECT_SCOPE_UNVALIDATED",
              "Project-scoped grants are not available in this context (no project registry wired). Use pair scope instead."
            );
          }
          const ok = await validator(scopeRef);
          if (!ok) {
            throw new DesktopApplicationError("UNKNOWN_PROJECT_PAIR", `Unknown project pair "${scopeRef}".`);
          }
          return scopeRef;
        },
        recordEvent: (type, pairId, extras) => this.recordEvent(type, pairId, extras)
      });
    }
    return this.permissionService;
  }

  /** All grants, or those applying to one pair (its own scope + its project scope). */
  listPermissionGrants(pairId?: string): PermissionGrantDto[] {
    if (pairId === undefined) {
      return this.ensurePermissions().listAll();
    }
    this.assertKnownPair(pairId);
    const pair = this.getPairDetail(pairId);
    if (!pair) {
      throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    }
    return this.ensurePermissions().listForPair(pair);
  }

  async grantPermission(input: PermissionGrantInputDto): Promise<PermissionGrantDto> {
    if (!input || typeof input !== "object") {
      throw new DesktopApplicationError("INVALID_INPUT", "Grant input must be an object.");
    }
    return this.ensurePermissions().grant(input);
  }

  revokePermission(grantId: number): PermissionGrantDto {
    return this.ensurePermissions().revoke(grantId);
  }

  getOpenCodeEndpoint(): string {
    return this.workerSessions.getOpenCodeEndpoint();
  }

  applyAdapterSettings(input: unknown): { ok: true } {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new DesktopApplicationError("INVALID_INPUT", "Adapter settings must be an object.");
    }
    const settings = input as { opencodeServer?: unknown; chatgptUrl?: unknown };
    if (settings.opencodeServer !== undefined) {
      if (typeof settings.opencodeServer !== "string" || !isHttpUrl(settings.opencodeServer.trim())) {
        throw new DesktopApplicationError("INVALID_INPUT", "OpenCode Server URL must be a valid HTTP(S) URL.");
      }
      const endpoint = new URL(settings.opencodeServer.trim()).toString();
      if (!credentialsAllowed(endpoint)) {
        throw new DesktopApplicationError(
          "INVALID_INPUT",
          "OpenCode credentials may only be used with HTTPS or a loopback HTTP endpoint."
        );
      }
      process.env.AGENT_OPENCODE_BASE_URL = endpoint;
      this.options.opencode = { ...this.options.opencode, baseUrl: endpoint };
    }
    if (settings.chatgptUrl !== undefined) {
      if (typeof settings.chatgptUrl !== "string" || !isHttpUrl(settings.chatgptUrl.trim())) {
        throw new DesktopApplicationError("INVALID_INPUT", "Planner browser URL must be a valid HTTP(S) URL.");
      }
      const endpoint = new URL(settings.chatgptUrl.trim()).toString();
      this.options.chatgpt = { ...this.options.chatgpt, cdpUrl: endpoint };
    }
    return { ok: true };
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
      conversationId: "test",
      conversationUrl: options.conversationUrl ?? "https://chatgpt.com/",
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
      if (input.projectPairId !== undefined) edits.projectPairId = input.projectPairId.trim() === "" ? undefined : input.projectPairId;
      if (input.masterWorkerSessionId !== undefined) edits.masterWorkerSessionId = input.masterWorkerSessionId.trim() === "" ? undefined : input.masterWorkerSessionId;
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

  private sideState(pairId: string): { startingSide: "planner" | "worker" | null } {
    if (!this.store) {
      return { startingSide: null };
    }
    try {
      return { startingSide: this.store.getPairState(pairId)?.startingSide ?? null };
    } catch {
      return { startingSide: null };
    }
  }

  private deliveryEvidence(pairId: string): { hasRelayHistory: boolean; latestDeliveryStatus?: "DISCOVERED" | "DELIVERING" | "DELIVERED" | "FAILED"; latestDeliveryVerifyAttempts?: number } {
    if (!this.store) {
      return { hasRelayHistory: false };
    }
    const records = this.store.listRecords(pairId);
    const cycles = this.store.listCycles(pairId);
    const latest = records[records.length - 1];
    return {
      hasRelayHistory: records.length > 0 || cycles.length > 0,
      ...(latest
        ? {
            latestDeliveryStatus: latest.status,
            latestDeliveryVerifyAttempts: latest.verifyAttemptCount ?? 0
          }
        : {})
    };
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
      ...(input.projectPairId ? { projectPairId: input.projectPairId.trim() } : {}),
      ...(input.masterWorkerSessionId ? { masterWorkerSessionId: input.masterWorkerSessionId.trim() } : {})
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
      },
      masterWorkerSessionId: pair.masterWorkerSessionId
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

  private clearAutoResumeToggle(pairId: string): void {
    try {
      this.ensureStore().touchAutoResumeState({ pairId, autoResumeAfterRestart: false });
    } catch {
      // best-effort; a broken store must not block stop/stop-all
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
        "Agent could not open its local database. Close other instances, check disk permissions for the database directory, then relaunch."
      );
    }
    return this.store;
  }

  getResumeState(): Array<{ pairId: string; resumeAfterRestart: boolean }> {
    const store = this.ensureStore();
    const resume = new Map(store.listResumeState().map((entry) => [entry.pairId, entry.resumeAfterRestart ?? true]));
    return this.pairs.map((pair) => ({ pairId: pair.pairId, resumeAfterRestart: resume.get(pair.pairId) ?? false }));
  }

  /** v1.1 §11.4 — operator-only release of a pair's recovery suspension. Resets the repeat counter; preserves history. */
  releaseRecoverySuspension(pairId: string): RuntimeStatusSummary {
    this.assertKnownPair(pairId);
    const store = this.ensureStore();
    const existing = store.getSupervisorState(pairId);
    store.touchSupervisorState({
      pairId,
      recoverySuspended: false,
      recoverySuspendedAt: undefined,
      recoveryAttemptCount: 0,
      identicalFailureCount: 0,
      identicalFailureFirstAt: undefined
    });
    this.recordEvent("RECOVERY_SUSPENSION_RELEASED", pairId, {
      reason: existing?.recoverySuspended
        ? "Operator released the recovery suspension; automated recovery is enabled again."
        : "Operator release requested; no suspension was active."
    });
    return this.relayEngine.getStatus();
  }

  /** Rule 15 — operator-configured per-pair auto-resume after restart (default: disabled). */
  getAutoResumeState(): Array<{ pairId: string; autoResumeAfterRestart: boolean }> {
    const store = this.ensureStore();
    const resume = new Set(store.listAutoResumeState());
    return this.pairs.map((pair) => ({ pairId: pair.pairId, autoResumeAfterRestart: resume.has(pair.pairId) }));
  }

  setAutoResumeAfterRestart(pairId: string, enabled: boolean): Array<{ pairId: string; autoResumeAfterRestart: boolean }> {
    this.assertKnownPair(pairId);
    this.ensureStore().touchAutoResumeState({ pairId, autoResumeAfterRestart: Boolean(enabled) });
    this.recordEvent("AUTO_RESUME_UPDATED", pairId, {
      reason: `Auto-resume after restart ${enabled ? "enabled" : "disabled"} by the operator.`,
      details: { autoResumeAfterRestart: Boolean(enabled) }
    });
    return this.getAutoResumeState();
  }

  /** Rule 24 — operator-configured history retention settings. */
  /** Read-only ground-truth evidence for the Source view. Never mutates; never gates dispatch. */
  getDiagnosticsSnapshot(): DiagnosticsSnapshotDto {
    const settings = readSettings();
    const environment = { node: process.version, platform: process.platform, arch: process.arch };
    const base = {
      generatedAt: new Date().toISOString(),
      environment,
      config: { configPath: this.options.configPath ?? null, pairsCount: this.pairs.length, projectPairsCount: null as number | null },
      settings: { historyRetentionDays: settings.historyRetentionDays ?? 0 }
    };
    const store = this.store;
    if (!store) {
      return {
        ...base,
        available: false,
        reason: "Relay store is not available.",
        database: null,
        relayLedger: null,
        relayCycles: null,
        startupOperations: null,
        supervisorState: null,
        openAttentions: null,
        openProposals: null
      };
    }
    const diag = store.diagnosticsSnapshot();
    let dbSizeBytes: number | undefined;
    let walSizeBytes: number | undefined;
    try {
      dbSizeBytes = statSync(store.dbPath).size;
      try {
        walSizeBytes = statSync(`${store.dbPath}-wal`).size;
      } catch {
        walSizeBytes = 0;
      }
    } catch {
      // Sizes are advisory; the read-only queries below are the evidence.
    }
    return {
      ...base,
      available: true,
      database: { path: store.dbPath, schemaVersion: diag.schemaVersion, expectedSchemaVersion: EXPECTED_SCHEMA_VERSION, journalMode: diag.journalMode, dbSizeBytes, walSizeBytes },
      relayLedger: {
        total: diag.relayRecords.total,
        delivered: diag.relayRecords.delivered,
        delivering: diag.relayRecords.delivering,
        failed: diag.relayRecords.failed,
        ambiguousDelivering: diag.relayRecords.ambiguousDelivering
      },
      relayCycles: diag.relayCycles,
      startupOperations: diag.startupOperations,
      supervisorState: diag.supervisorState,
      openAttentions: diag.openAttentions,
      openProposals: diag.openProposals
    };
  }

  getDatabaseInfo(): DatabaseSettingsInfoDto {
    const dbPath = resolveDbPath(this.options.dbPath);
    const walPath = `${dbPath}-wal`;
    const backupDir = join(dirname(dbPath), "backups");
    const store = this.store;
    const exists = existsSync(dbPath);
    const info: DatabaseSettingsInfoDto = {
      generatedAt: new Date().toISOString(),
      databasePath: dbPath,
      databaseExists: exists,
      dbSizeBytes: exists ? statSync(dbPath).size : undefined,
      walSizeBytes: exists && existsSync(walPath) ? statSync(walPath).size : undefined,
      journalMode: store ? store.journalMode() : "unknown",
      schemaVersion: store ? (store.diagnosticsSnapshot().schemaVersion) : null,
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
      tableCounts: store ? store.tableCounts() : null
    };
    return info;
  }

  listDatabaseBackups(): DatabaseBackupEntryDto[] {
    const dbPath = resolveDbPath(this.options.dbPath);
    const backupDir = join(dirname(dbPath), "backups");
    if (!existsSync(backupDir)) {
      return [];
    }
    const entries: DatabaseBackupEntryDto[] = [];
    for (const name of readdirSync(backupDir)) {
      if (!/^agent-.*\.sqlite$/.test(name)) {
        continue;
      }
      const full = join(backupDir, name);
      try {
        const stat = statSync(full);
        entries.push({ fileName: name, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size });
      } catch {
        // Ignore unreadable entries.
      }
    }
    // Newest first.
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  backupDatabase(): { path: string } {
    const dbPath = resolveDbPath(this.options.dbPath);
    const store = this.requireStore();
    const backupDir = join(dirname(dbPath), "backups");
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "-").replace("Z", "");
    const target = join(backupDir, `agent-${stamp}.sqlite`);
    // VACUUM INTO gives an atomic consistent snapshot (WAL included), no user input reaches the statement.
    store.rawBackup(target);
    return { path: target };
  }

  restoreDatabase(fileName: string): DatabaseRestoreResultDto {
    const dbPath = resolveDbPath(this.options.dbPath);
    if (!/^agent-[0-9]{8}-[0-9]{6}-backup\.sqlite$|^agent-[0-9]{8}-[0-9]{6}\.sqlite$/.test(fileName)) {
      throw new DesktopApplicationError("RESTORE_INVALID_NAME", "Backup file name is not a recognised Agent backup.");
    }
    const backupDir = join(dirname(dbPath), "backups");
    const backupPath = join(backupDir, fileName);
    if (!existsSync(backupPath)) {
      throw new DesktopApplicationError("RESTORE_NOT_FOUND", "Backup file does not exist.");
    }
    // Refuse while anything is running: restore is destructive.
    try {
      const status = this.relayEngine.getStatus();
      if (status.running > 0) {
        throw new DesktopApplicationError("RESTORE_BLOCKED", `Pair(s) are still running; stop all pairs before restoring.`);
      }
    } catch (error) {
      if (error instanceof DesktopApplicationError) {
        throw error;
      }
      // If status cannot be computed, do not risk a restore under a live runtime.
      throw new DesktopApplicationError("RESTORE_BLOCKED", "Agent could not verify that no pair is running; restore aborted.");
    }
    const validationTarget = join(backupDir, `.restore-verify-${Date.now()}.sqlite`);
    copyFileSync(backupPath, validationTarget);
    try {
      const probe = new SqliteRelayStore(validationTarget);
      try {
        if (!probe.requiredTablesExist()) {
          throw new DesktopApplicationError("RESTORE_INCOMPATIBLE", "Backup is missing required relay tables.");
        }
      } finally {
        probe.close();
      }
    } finally {
      try { rmSync(validationTarget, { force: true }); } catch { /* cleanup best effort */ }
    }
    // Pre-restore snapshot of the CURRENT database (atomic copy via VACUUM INTO).
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19).replace("T", "-").replace("Z", "");
    const preRestore = join(backupDir, `pre-restore-${ts}.sqlite`);
    this.requireStore().rawBackup(preRestore);
    // Close the live store, then swap files.
    this.requireStore().close();
    const quarantine = `${dbPath}.pre-restore-${ts}`;
    try { renameSync(dbPath, quarantine); } catch { /* may already be absent */ }
    renameSync(backupPath, dbPath);
    // Remove stale WAL/SHM so the restored file starts clean.
    for (const suffix of ["-wal", "-shm"]) {
      try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* absent is fine */ }
    }
    return { restoredFrom: fileName, preRestoreBackup: preRestore };
  }

  getSettings(): SettingsDto {
    return readSettings();
  }

  updateSettings(input: SettingsDto): SettingsDto {
    if (!input || typeof input !== "object") {
      throw new DesktopApplicationError("INVALID_SETTINGS", "Settings payload must be an object.");
    }
    const days = input.historyRetentionDays;
    if (days !== undefined && (!Number.isFinite(days) || days < 0 || days > 36500)) {
      throw new DesktopApplicationError(
        "INVALID_SETTINGS",
        "historyRetentionDays must be an integer between 0 (keep forever) and 36500."
      );
    }
    const saved = writeSettings({ historyRetentionDays: days });
    if (saved.historyRetentionDays && saved.historyRetentionDays > 0) {
      const result = this.ensureStore().applyHistoryRetention(saved.historyRetentionDays);
      this.recordEvent("HISTORY_RETENTION_APPLIED", undefined, {
        reason: `Applied history retention of ${saved.historyRetentionDays} days.`,
        details: result
      });
    }
    return saved;
  }

  async resumeManagedPairs(): Promise<void> {
    const store = this.ensureStore();
    // v1.1 §6.2–6.3: only operator-enabled pairs with Auto Resume on resume automatically after a
    // restart — including explicitly paused pairs. Stop / Stop All disable Auto Resume per pair.
    const resume = new Set(store.listAutoResumeState());
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
    // v1.1 §9.3 — coordination state for a shared restart: which pairs were running before it,
    // so only previously-Running, enabled pairs are restored afterwards.
    const restartState = { paused: [] as string[] };
    const browser: BrowserManager = new ExternalBrowserManager();
    const desktopControl = createOpenCodeDesktopControl();
    return {
      policy: this.options.recoveryPolicy === "none" ? "none" : "safe",
      browser,
      maxAttempts: this.options.recoveryMaxAttempts,
      baseUrl: pair.worker.server?.baseUrl,
      // v1.1 §9 — shared OpenCode restart only after EVERY potentially affected Worker is verified idle.
      // Idle requires reachability + session existence + not gathering; anything else is NOT idle.
      verifyAllAffectedWorkersIdle: async () => {
        const others = this.pairs.filter(
          (candidate) => candidate.enabled && candidate.pairId !== pair.pairId
        );
        for (const other of others) {
          try {
            const endpoint = other.worker.server?.baseUrl ?? this.getOpenCodeEndpoint();
            const adapter = new LiveOpenCodeAdapter(this.openCodeClientOptions(endpoint));
            const observation = await adapter.observeWorkerSession(other.worker);
            if (!observation.reachable || !observation.sessionExists || observation.gathering) {
              return false; // affected Worker is active/busy — restart is unsafe
            }
          } catch {
            return false; // unobservable is NOT idle — never restart on uncertainty
          }
        }
        return true; // no other enabled pair is affected — safe
      },
      // v1.1 §9.3 — temporarily pause previously-Running affected pairs; restore exactly those after verified restoration.
      pauseAffectedPairs: async () => {
        try {
          const summary = this.relayEngine.getStatus();
          for (const other of summary.pairs) {
            if (other.pairId === pair.pairId) continue;
            const config = this.pairs.find((candidate) => candidate.pairId === other.pairId);
            if (!config?.enabled) continue;
            if (other.runtimeState !== "RUNNING") continue;      // only previously-Running pairs
            if (restartState.paused.includes(other.pairId)) continue;   // no double-pause across retries
            try {
              this.relayEngine.pausePair(other.pairId);
              restartState.paused.push(other.pairId);
            } catch {
              // A pair that cannot be paused is skipped and simply not restored afterwards.
            }
          }
        } catch {
          // Enumeration failed — do not pause anything rather than guessing.
        }
      },
      restoreAffectedPairs: async () => {
        const toRestore = [...restartState.paused].reverse();
        restartState.paused = [];
        for (const pairId of toRestore) {
          try {
            await this.startPair(pairId);
          } catch {
            // A pair that cannot be restarted stays paused; the operator restores it explicitly.
          }
        }
      },
      // v1.1 §9 — predefined shared-service recovery, gated on verified idle.
      terminateOpenCodeDesktop: this.options.recoveryPolicy === "safe" ? desktopControl.terminateOpenCodeDesktop : undefined,
      relaunchOpenCodeDesktop: this.options.recoveryPolicy === "safe" ? desktopControl.relaunchOpenCodeDesktop : undefined,
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
