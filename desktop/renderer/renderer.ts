import type {
  ArchivedPairSummaryDto,
  CandidatePairDto,
  AutomationInfoDto,
  ChatGptProjectDto,
  CreateProjectPairDto,
  EndpointTestResultDto,
  DatabaseBackupEntryDto,
  DatabaseSettingsInfoDto,
  PermissionGrantDto,
  PermissionGrantInputDto,
  EventRecordDto,
  OpenCodeProjectDto,
  OpenCodeSessionInfoDto,
  PairIdentityDto,
  PairStartPriming,
  ParsedChatGptUrlDto,
  PeerHealthDto,
  ProjectPairDto,
  StatusSummaryDto,
  ToolLaunchResultDto,
  ToolActionResultDto,
  UpdatePairDto,
  ValidationResultDto,
  WorkerModelDto,
  WorkerModelSwitchResultDto
} from "../../src/contracts/desktop.js";
import { overallHealth, evaluateSessionDrift, evaluateTransportHealth } from "../../src/application/health-monitors.js";
import { runAction, setRunActionHook, type RunActionErrorHook } from "./actions.js";
import { noteActivityEvent, openActivityView, wireActivityView } from "./activity-view.js";
import { refreshRecoveryPanel, initRecoveryPanel } from "./recovery-view.js";
import { launchPlannerForPair } from "./planner.js";
import { startWorkerManagementServer } from "./worker-management.js";
import { discoverPlannerProjects, startPlannerManagementBrowser } from "./planner-management.js";
import { wireConfigForm, wireSettingsSection } from "./settings-view.js";
import { initOutcome } from "./initialize-toast.js";
import { initPermissionsCard, refreshPermissionsCard } from "./permissions-view.js";
import { appendPairCard, expandedPairs, setPairCardHooks } from "./pair-card.js";
import {
  closeWizard,
  currentWizardStep,
  openWizard,
  renderWizard,
  doRebind,
  doSave,
  removePair,
  setWizardHooks,
  showWizardModal,
  wizard,
  setWizardStepIndex,
  wizardStepIndex,
} from "./wizard-view.js";
import {
  closeWorkerSessionModal,
  confirmWorkerSessionCreation,
  createWorkerSessionForPair,
  openWorkerSession,
  renderWorkerModelControl,
  renderWorkerSessionModal,
  setWorkerSessionDispatch
} from "./worker-session.js";



import {
  actionButton,
  buildCard,
  type CardBadgeOpts,
  buildDangerZone,
  buildExpandableToggle,
  buildIdentityBlock,
  el,
  errorMessage,
  formatTime,
  healthBadgeClass,
  identityRow,
  toast
} from "./dom.js";
import { initGlobalFocusTrap } from "./focus-trap.js";
import {
  getDiscoveredChatGptProjects,
  getDiscoveredOpenCodeProjects,
  refreshProjectAssignments,
  setDiscoveredChatGptProjects,
  setDiscoveredOpenCodeProjects,
  expandedProjectPairs,
  setStatuses,
  state,
  updateStartAllButton,
  type ProjectPairSnapshot
} from "./view-state.js";
import {
  controlsFor,
  isValidError,
  stateDotClass,
  toPairCard,
  type PairControls
} from "./state.js";
import {
  applyThemePreference,
  readStoredThemePreference,
  storeThemePreference,
  normalizeThemePreference
} from "./theme.js";
import {
  candidateIssues,
  candidateFromWizard,
  createWizardDraft,
  isValidPairId,
  rebindSelection,
  stepComplete,
  stepIssues,
  suggestPairId,
  wizardStepLabel,
  wizardSteps,
  wizardTitle,
  type WizardDraft,
  type WizardKind,
  type WizardStep
} from "./wizard.js";

const MAX_EVENTS = 200;

declare global {
  interface Window {
    desktop: {
      configPath: string;
      listPairs(): Promise<PairIdentityDto[]>;
      getStatus(): Promise<StatusSummaryDto>;
      pausePair(pairId: string): Promise<StatusSummaryDto>;
      resumePair(pairId: string): Promise<StatusSummaryDto>;
      startPair(pairId: string, priming?: PairStartPriming): Promise<StatusSummaryDto>;
      stopPair(pairId: string): Promise<StatusSummaryDto>;
      startAll(): Promise<StatusSummaryDto>;
      stopAll(): Promise<StatusSummaryDto>;
      getDiagnosticsSnapshot(): Promise<import("../../src/contracts/desktop.js").DiagnosticsSnapshotDto>;
      listPermissionGrants(pairId?: string): Promise<PermissionGrantDto[]>;
      grantPermission(input: PermissionGrantInputDto): Promise<PermissionGrantDto>;
      revokePermission(grantId: number): Promise<PermissionGrantDto>;
      getDatabaseInfo(): Promise<DatabaseSettingsInfoDto>;
      backupDatabase(): Promise<{ path: string }>;
      listDatabaseBackups(): Promise<DatabaseBackupEntryDto[]>;
      revealDatabase(): Promise<void>;
      restoreDatabase(fileName: string): Promise<{ restoredFrom: string; preRestoreBackup: string }>;
      releaseRecoverySuspension(pairId: string): Promise<StatusSummaryDto>;
      selectStartingSide(pairId: string, side: "planner" | "worker"): Promise<StatusSummaryDto>;
      cancelIncident(pairId: string): Promise<StatusSummaryDto>;
      getAutoResumeState(): Promise<Array<{ pairId: string; autoResumeAfterRestart: boolean }>>;
      setAutoResumeAfterRestart(pairId: string, enabled: boolean): Promise<Array<{ pairId: string; autoResumeAfterRestart: boolean }>>;
      getSettings(): Promise<{ historyRetentionDays?: number }>;
      updateSettings(input: { historyRetentionDays?: number }): Promise<{ historyRetentionDays?: number }>;
      validatePair(pairId: string): Promise<ValidationResultDto>;
      getValidation(pairId: string): Promise<ValidationResultDto | undefined>;
      getAutomationInfo(): Promise<AutomationInfoDto>;
      seedPlanner(pairId: string): Promise<{ pairId: string; promptVersion: string; sentAt: string }>;
      feedLocalAgent(pairId: string): Promise<{
        pairId: string;
        promptVersion: string;
        sentAt: string;
        localAgentMode: boolean;
      }>;
      listOpenCodeSessions(pairId: string): Promise<unknown[]>;
      getOpenCodeEndpoint(): Promise<string>;
      getChatGptEndpoint(): Promise<string>;
      discoverWorkerSessions(input?: { baseUrl?: string }): Promise<OpenCodeSessionInfoDto[]>;
      scanDesktopWorkerSession(): Promise<OpenCodeSessionInfoDto>;
      alignWorkerSessionWithOpenCodeDesktop(pairId: string): Promise<{
        ok: boolean;
        boundSessionId: string;
        desktopSessionId: string;
        rebound: boolean;
        message: string;
      }>;
      startWorkerServer(input: { baseUrl?: string; repoPath: string; sessionId?: string }): Promise<ToolLaunchResultDto>;
      updateOpenCode(): Promise<ToolActionResultDto>;
      createWorkerSession(input: { baseUrl?: string; repoPath: string; title?: string }): Promise<OpenCodeSessionInfoDto>;
      testWorkerEndpoint(input?: { baseUrl?: string; sessionId?: string; repoPath?: string }): Promise<EndpointTestResultDto>;
      parsePlannerUrl(input: { url: string }): Promise<ParsedChatGptUrlDto>;
      testPlannerEndpoint(input?: { cdpUrl?: string; conversationUrl?: string }): Promise<EndpointTestResultDto>;
      startPlannerBrowser(input?: { cdpUrl?: string }): Promise<ToolLaunchResultDto>;
      validateCandidate(input: CandidatePairDto): Promise<ValidationResultDto>;
      createPair(input: CandidatePairDto): Promise<PairIdentityDto>;
      updatePair(pairId: string, input: UpdatePairDto): Promise<PairIdentityDto>;
      removePair(pairId: string): Promise<{ pairId: string }>;
      rebindWorker(pairId: string, sessionId: string): Promise<PairIdentityDto>;
      suggestWorkerSessionTitle(pairId: string): Promise<string>;
      createWorkerSessionForPair(pairId: string, input?: { title?: string }): Promise<PairIdentityDto>;
      openWorkerSession(pairId: string): Promise<{
        sessionId: string;
        selected: boolean;
        foregrounded: boolean;
        fallback: boolean;
      }>;
      listWorkerModels(pairId: string): Promise<WorkerModelDto[]>;
      switchWorkerModel(pairId: string, input: { providerId: string; modelId: string; notifyPlanner?: boolean }): Promise<WorkerModelSwitchResultDto>;
      resumeWithFallbackModel(pairId: string, input: { providerId: string; modelId: string }): Promise<StatusSummaryDto>;
      adapterSettings(settings: unknown): Promise<{ ok: boolean }>;
      listLogs(): Promise<Array<{ id: string; name: string; size: number; modifiedAt: number }>>;
      readLogFile(id: string): Promise<{ id: string; modifiedAt: number; lines: string[]; truncated?: boolean }>;
      configureOpenCodeCredentials(): Promise<{ saved: boolean; username?: string }>;
      pickFolder(): Promise<{ folderPath?: string }>;
      getCodeIndex(): Promise<{
        totals?: { modules?: number; symbols?: number; modulesMissingHeader?: number };
        categories?: Array<{ category: string; modules: number }>;
        modules?: Array<{
          path: string;
          dir: string;
          category: string;
          purpose?: string;
          hasHeader?: boolean;
          symbolCount?: number;
          symbols?: Array<{ name: string; kind: string; line?: number; signature?: string }>;
        }>;
      }>;
      getDuplicateReport(): Promise<{ status: "ok" | "not-scanned" | "failed"; report?: DuplicationReport; error?: string; generatedAt?: string | null }>;
      scanDuplicates(minLines?: number): Promise<{ started: boolean; minLines?: number; pid?: number; error?: string }>;
      getWorkerProgress(pairId: string, forceRefresh?: boolean): Promise<import("../shared/worker-progress.js").WorkerProgressDto>;
      getTimeline(pairId?: string, limit?: number): Promise<Array<{ time: string; pairId?: string; projectPairId?: string; type: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> }>>;
      startProject(projectPairId: string): Promise<StatusSummaryDto>;
      pauseProject(projectPairId: string): Promise<StatusSummaryDto>;
      listProjectPairs(): Promise<ProjectPairDto[]>;
      createProjectPair(input: CreateProjectPairDto): Promise<ProjectPairDto>;
      removeProjectPair(projectPairId: string): Promise<{ projectPairId: string }>;
      discoverOpenCodeProjects(): Promise<OpenCodeProjectDto[]>;
      discoverChatGptProjects(input?: { cdpUrl?: string }): Promise<ChatGptProjectDto[]>;
      listArchive(): Promise<ArchivedPairSummaryDto[]>;
      deleteArchive(ref: string): Promise<{ ref: string }>;
      listWorkerQuestions(pairId: string): Promise<import("../../src/contracts/worker-question.js").WorkerQuestion[]>;
      getWorkerTranscript(pairId: string): Promise<import("../../src/contracts/worker-transcript.js").WorkerTranscript>;
      answerWorkerQuestion(pairId: string, input: { requestId: string; answers: string[][] }): Promise<{ answered: boolean }>;
      onEvent(listener: (event: EventRecordDto) => void): () => void;
      onStatusRefresh(listener: (payload: { reason?: string }) => void): () => void;
      onWorkerProgressUpdate(listener: (pairId: string) => void): () => void;
      clearTimeline(): Promise<{ ok: boolean }>;
      initializePair(pairId: string): Promise<ValidationResultDto>;
    };
  }
}

const SHOW_WORKER_ON_START_KEY = "agent.showWorkerOnStart";

function showWorkerOnStartPref(): boolean {
  return localStorage.getItem(SHOW_WORKER_ON_START_KEY) === "1";
}

function setShowWorkerOnStartPref(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(SHOW_WORKER_ON_START_KEY, "1");
  } else {
    localStorage.removeItem(SHOW_WORKER_ON_START_KEY);
  }
}

function initTheme(): void {
  // Preference persisted under agent.theme (system | light | dark); system follows the OS.
  applyThemePreference(readStoredThemePreference());
}
function expandAllPairs(): void {
  for (const pair of state.pairs) {
    expandedPairs.add(pair.pairId);
  }
  for (const project of state.projectPairs) {
    expandedProjectPairs.add(project.projectPairId);
  }
  renderProjectPairs();
}

function collapseAllPairs(): void {
  expandedPairs.clear();
  expandedProjectPairs.clear();
  renderProjectPairs();
}

/**
 * Project pair views (the coarser worker-project ↔ planner-project layer). Extracted from the
 * renderer; core is reached only through the typed `window.desktop` bridge.
 */

type ProjectPairPresence = "active" | "partial" | "idle" | "unknown";


function projectPairPresence(pair: ProjectPairDto): ProjectPairPresence {
  const snapshot = state.projectPairSnapshots.get(pair.projectPairId);
  if (!snapshot) {
    return "unknown";
  }
  const workerAlive = snapshot.openCodeSessions.length > 0;
  const plannerAlive =
    (snapshot.chatgpt?.openTabCount ?? 0) > 0 || (snapshot.chatgpt?.conversationIds.length ?? 0) > 0;
  if (workerAlive && plannerAlive) {
    return "active";
  }
  if (workerAlive || plannerAlive) {
    return "partial";
  }
  return "idle";
}

/** Re-render the standalone Pairs panel (used by view switch and by live refresh so status badges stay current). */
function renderPairsPanel(): void {
  const pairsList = document.getElementById("pairs-list");
  if (!pairsList) return;
  const fragment = document.createDocumentFragment();
  for (const pair of state.pairs) {
    appendPairCard(fragment, pair);
  }
  pairsList.replaceChildren(fragment);
}

type ViewMode = "sessions" | "home" | "activity" | "recovery" | "pairs" | "models" | "modules" | "logs" | "config" | "devices" | "health" | "developer" | "setup" | "source";
let currentView: ViewMode = "home";

function closeMobileSidebar(): void {
  const sidebar = document.querySelector(".sidebar-nav");
  const backdrop = document.getElementById("sidebar-backdrop");
  sidebar?.classList.remove("mobile-open");
  backdrop?.classList.add("hidden");
}

function toggleMobileSidebar(): void {
  const sidebar = document.querySelector(".sidebar-nav");
  const backdrop = document.getElementById("sidebar-backdrop");
  const isOpen = sidebar?.classList.toggle("mobile-open");
  backdrop?.classList.toggle("hidden", !isOpen);
}

interface GtTile { label: string; value: string; tone: "ok" | "warn" | "danger" | "neutral" | "info"; title?: string }

function gtChip(text: string, tone: "ok" | "warn" | "danger" | "neutral" | "info", title?: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = `ground-truth-tile ground-truth-tile-${tone}`;
  if (title) chip.title = title;
  const label = document.createElement("span");
  label.className = "ground-truth-tile-label";
  label.textContent = text;
  chip.appendChild(label);
  return chip;
}

async function refreshGroundTruth(): Promise<void> {
  const grid = document.getElementById("ground-truth-grid");
  const status = document.getElementById("ground-truth-status");
  const sim = document.getElementById("ground-truth-simulated");
  const ambiguousPanel = document.getElementById("ground-truth-ambiguous");
  const ambiguousList = document.getElementById("ground-truth-ambiguous-list");
  const suspendedPanel = document.getElementById("ground-truth-suspended");
  const suspendedList = document.getElementById("ground-truth-suspended-list");
  if (!grid) return;
  if (typeof window.desktop?.getDiagnosticsSnapshot !== "function") {
    grid.replaceChildren(gtChip("Unavailable in this build", "neutral", "This build does not expose diagnostics."));
    return;
  }
  try {
    const dto = await window.desktop.getDiagnosticsSnapshot();
    if (sim) sim.classList.toggle("hidden", !dto.simulated);
    grid.replaceChildren();

    const tiles: GtTile[] = [];
    const env = dto.environment;
    tiles.push({ label: `node ${env.node} · ${env.platform} · ${env.arch}`, value: "Environment", tone: "info", title: "Runtime identity reported by the process." });
    tiles.push({ label: dto.config.configPath ?? "(no config path)", value: `${dto.config.pairsCount ?? "?"} pairs configured`, tone: dto.config.pairsCount && dto.config.pairsCount > 0 ? "info" : "warn", title: `Active pairs in pairs.local.json. Project pairs (coarser repo↔planner grouping): ${dto.config.projectPairsCount ?? "unknown"}.` });

    if (!dto.available || dto.database === null) {
      tiles.push({ label: dto.reason ?? "Relay store unavailable", value: "Store down", tone: "danger", title: "The relay store could not be opened — every store-derived value is null, never guessed." });
      if (status) {
        status.textContent = "Relay store unavailable — no evidence available.";
        status.className = "ground-truth-status ground-truth-status-danger";
      }
    } else {
      const db = dto.database;
      const size = db.dbSizeBytes !== undefined ? `${(db.dbSizeBytes / 1024).toFixed(0)} KB` : "size?";
      const wal = db.walSizeBytes !== undefined ? ` + ${(db.walSizeBytes / 1024).toFixed(0)} KB wal` : "";
      const schemaOk = db.schemaVersion === db.expectedSchemaVersion;
      tiles.push({ label: `${db.path}`, value: `schema v${db.schemaVersion ?? "?"} / expected v${db.expectedSchemaVersion} · ${db.journalMode.toUpperCase()} · ${size}${wal}`, tone: schemaOk ? "ok" : "danger", title: schemaOk ? "Store schema matches the build's expected version." : "Store schema and binary disagree — migrations may be pending or blocked; do not trust in-flight state." });
      const ledger = dto.relayLedger;
      if (ledger) {
        tiles.push({ label: `${ledger.total} records — ${ledger.delivered} delivered · ${ledger.delivering} delivering · ${ledger.failed} failed`, value: ledger.delivering > 0 ? `${ledger.delivering} unverified` : "Ledger", tone: ledger.delivering > 0 ? "warn" : ledger.failed > 0 ? "warn" : "ok", title: "DELIVERING records are unconfirmed deliveries (never assumed delivered). FAILED records are terminal failures awaiting operator attention." });
      }
      const cycles = dto.relayCycles;
      if (cycles) {
        const cycleText = Object.entries(cycles.byStatus).map(([k, v]) => `${k}:${v}`).join(" · ") || "none";
        tiles.push({ label: cycleText, value: `${cycles.total} cycles`, tone: "info", title: "Relay cycles by state — total cycles completed/created." });
      }
      const sup = dto.supervisorState;
      if (sup) {
        tiles.push({ label: `${sup.paused} paused · ${sup.suspended} suspended`, value: "Supervisor", tone: sup.suspended > 0 ? "danger" : "info", title: "Paused pairs finish their current step then stop dispatching. Suspended pairs halt automated recovery entirely until operator release." });
      }
      const startup = dto.startupOperations;
      if (startup) {
        tiles.push({ label: `${startup.pending} pending · ${startup.hold} on hold · ${startup.stabilized} stabilized`, value: "Startup ops", tone: startup.hold > 0 ? "warn" : startup.pending > 0 ? "info" : "ok", title: "Startup activations in flight; 'hold' means an operator-reconciled startup could not complete safely." });
      }
      if (dto.openAttentions !== null) tiles.push({ label: `${dto.openAttentions} open attention item(s) · ${dto.openProposals ?? 0} pending proposal(s)`, value: "Queue", tone: (dto.openAttentions ?? 0) > 0 ? "warn" : "ok", title: "Unresolved attention items block automation on those pairs until the operator resolves them." });
      tiles.push({ label: `${dto.settings.historyRetentionDays} day(s)`, value: "Retention", tone: "neutral", title: "Delivered relay cycles older than this are pruned on next write." });

      // status banner
      if (status) {
        const schemaBad = db.schemaVersion !== db.expectedSchemaVersion;
        const ambiguous = ledger?.delivering ?? 0;
        const suspendedCount = sup?.suspended ?? 0;
        const holdCount = startup?.hold ?? 0;
        if (schemaBad || suspendedCount > 0 || ambiguous > 0 || holdCount > 0) {
          status.textContent = schemaBad
            ? "Attention: store schema does not match this build — verify before relying on in-flight state."
            : `Attention: ${[ambiguous ? `${ambiguous} unverified delivery(s)` : "", suspendedCount ? `${suspendedCount} suspended pair(s)` : "", holdCount ? `${holdCount} held startup op(s)` : ""].filter(Boolean).join(", ")}.`;
          status.className = "ground-truth-status ground-truth-status-danger";
        } else {
          status.textContent = "All evidence nominal — nothing needs attention.";
          status.className = "ground-truth-status ground-truth-status-ok";
        }
      }
    }

    for (const tile of tiles) {
      const el = document.createElement("div");
      el.className = `ground-truth-tile ground-truth-tile-${tile.tone}`;
      if (tile.title) el.title = tile.title;
      const label = document.createElement("div");
      label.className = "ground-truth-tile-label";
      label.textContent = tile.label;
      const value = document.createElement("div");
      value.className = "ground-truth-tile-value";
      value.textContent = tile.value;
      el.append(value, label);
      grid.appendChild(el);
    }

    // evidence lists (only ambiguities/interrupts with evidence matter)
    if (ambiguousPanel && ambiguousList) {
      const items = dto.relayLedger?.ambiguousDelivering ?? [];
      ambiguousList.replaceChildren();
      ambiguousPanel.classList.toggle("hidden", items.length === 0);
      for (const record of items) {
        const row = document.createElement("div");
        row.className = "ground-truth-evidence-row";
        const age = formatTimeAgo(record.firstSeenAt);
        row.textContent = `${record.pairId} · ${record.direction} · ${age} · verify attempts ${record.verifyAttemptCount}`;
        row.title = `${record.sourceMessageId} (first seen ${new Date(record.firstSeenAt).toISOString()})`;
        ambiguousList.appendChild(row);
      }
    }
    if (suspendedPanel && suspendedList) {
      const items = dto.supervisorState?.suspendedPairs ?? [];
      suspendedList.replaceChildren();
      suspendedPanel.classList.toggle("hidden", items.length === 0);
      for (const record of items) {
        const row = document.createElement("div");
        row.className = "ground-truth-evidence-row";
        row.textContent = `${record.pairId} · ${record.suspendedAt ? `suspended ${formatTimeAgo(record.suspendedAt)}` : "suspended"} · ${record.attemptCount} attempt(s)`;
        suspendedList.appendChild(row);
      }
    }
  } catch (error) {
    if (status) {
      status.textContent = `Diagnostics failed: ${errorMessage(error)}`;
      status.className = "ground-truth-status ground-truth-status-danger";
    }
    grid.replaceChildren(gtChip("Diagnostics failed to load", "danger"));
  }
}

function formatTimeAgo(iso: string): string {
  const past = Date.parse(iso);
  if (Number.isNaN(past)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - past) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function initDatabasePanel(): void {
  const status = document.getElementById("database-status");
  const setStatus = (text: string, ok = true): void => {
    if (status) {
      status.textContent = text;
      status.classList.toggle("fail", !ok);
      status.classList.toggle("ok", ok);
    }
  };

  document.getElementById("database-refresh")?.addEventListener("click", () => {
    void refreshDatabaseSection();
  });

  document.getElementById("database-backup")?.addEventListener("click", async () => {
    if (typeof window.desktop?.backupDatabase !== "function") {
      setStatus("Backup is not available in this build.", false);
      return;
    }
    try {
      const result = await window.desktop.backupDatabase();
      setStatus(`Backup written: ${result.path}`);
      void refreshDatabaseSection();
      void refreshDatabaseBackupList();
    } catch (error) {
      setStatus(`Backup failed: ${errorMessage(error)}`, false);
    }
  });

  document.getElementById("database-reveal")?.addEventListener("click", () => {
    void window.desktop?.revealDatabase?.().catch(() => setStatus("Could not reveal the database in your file manager.", false));
  });

  document.getElementById("database-copy-path")?.addEventListener("click", async () => {
    const pathEl = document.getElementById("database-path") as HTMLInputElement | null;
    const text = pathEl?.value ?? "";
    if (!text) {
      setStatus("Path not yet known — refresh first.", false);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Path copied to clipboard.");
    } catch {
      setStatus("Clipboard not available for writes.", false);
    }
  });

  // Restore flow
  const panel = document.getElementById("database-restore-panel");
  const toggleBtn = document.getElementById("database-restore-toggle") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("database-restore-cancel");
  const restoreBtn = document.getElementById("database-restore-confirm-btn") as HTMLButtonElement | null;
  const confirmInput = document.getElementById("database-restore-confirm") as HTMLInputElement | null;
  const restoreStatus = document.getElementById("database-restore-status");

  const showPanel = async (show: boolean): Promise<void> => {
    panel?.classList.toggle("hidden", !show);
    toggleBtn?.classList.toggle("hidden", show);
    if (show) {
      await refreshDatabaseBackupList();
    }
  };
  toggleBtn?.addEventListener("click", () => { void showPanel(true); });
  cancelBtn?.addEventListener("click", () => {
    void showPanel(false);
    if (confirmInput) confirmInput.value = "";
    if (restoreStatus) restoreStatus.textContent = "";
  });

  restoreBtn?.addEventListener("click", async () => {
    if (!restoreStatus) return;
    const typed = (confirmInput?.value ?? "").trim();
    if (typed !== "RESTORE") {
      restoreStatus.textContent = "Type RESTORE to confirm.";
      return;
    }
    const chosen = document.querySelector<HTMLInputElement>('input[name="database-backup-choice"]:checked')?.value;
    if (!chosen) {
      restoreStatus.textContent = "Pick a backup to restore from.";
      return;
    }
    if (typeof window.desktop?.restoreDatabase !== "function") {
      restoreStatus.textContent = "Restore is not available in this build.";
      return;
    }
    restoreBtn.disabled = true;
    restoreStatus.textContent = "Restoring and restarting Agent…";
    try {
      await window.desktop.restoreDatabase(chosen);
      // The app exits and relaunches itself; nothing else runs.
    } catch (error) {
      restoreStatus.textContent = `Restore failed: ${errorMessage(error)}`;
      restoreBtn.disabled = false;
    }
  });
}

async function refreshDatabaseSection(): Promise<void> {
  const status = document.getElementById("database-status");
  const pathEl = document.getElementById("database-path") as HTMLInputElement | null;
  const sizeEl = document.getElementById("database-size");
  const walEl = document.getElementById("database-wal-size");
  const journalEl = document.getElementById("database-journal-mode");
  const schemaEl = document.getElementById("database-schema");
  const countsEl = document.getElementById("database-table-counts");
  const backupList = document.getElementById("database-backup-list");
  if (!pathEl || !sizeEl || !walEl || !journalEl || !schemaEl || !countsEl) return;

  if (typeof window.desktop?.getDatabaseInfo !== "function") {
    if (status) status.textContent = "Database panel unavailable in this build.";
    return;
  }

  try {
    const info = await window.desktop.getDatabaseInfo();
    pathEl.value = info.databasePath;
    pathEl.title = info.databasePath;
    sizeEl.textContent = info.dbSizeBytes !== undefined ? formatBytes(info.dbSizeBytes) : "missing";
    walEl.textContent = info.walSizeBytes !== undefined ? formatBytes(info.walSizeBytes) : "absent";
    journalEl.textContent = info.journalMode.toUpperCase();
    const ok = info.schemaVersion === info.expectedSchemaVersion;
    schemaEl.textContent = info.schemaVersion == null ? "unavailable" : `v${info.schemaVersion} (expected v${info.expectedSchemaVersion})`;
    schemaEl.style.color = ok ? "var(--ok)" : "var(--danger)";
    const parts = Object.entries(info.tableCounts ?? {}).map(([k, v]) => `${k}:${v}`);
    countsEl.textContent = parts.join(" · ") || "—";
    if (status) status.textContent = info.databaseExists ? "" : "Database file missing.";
  } catch (error) {
    if (status) status.textContent = `Failed to read database info: ${errorMessage(error)}`;
  }
}

async function refreshDatabaseBackupList(): Promise<void> {
  const listEl = document.getElementById("database-backup-list");
  const status = document.getElementById("database-restore-status");
  if (!listEl) return;
  listEl.replaceChildren();
  try {
    const backups = await window.desktop?.listDatabaseBackups?.();
    if (!backups || backups.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-hint";
      empty.textContent = "No backups yet — press “Back Up Now” to create one.";
      listEl.appendChild(empty);
      return;
    }
    for (const backup of backups) {
      const row = document.createElement("label");
      row.className = "database-backup-row";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "database-backup-choice";
      radio.value = backup.fileName;
      const text = document.createElement("span");
      text.innerHTML = `<strong>${escapeHtmlC(backup.fileName)}</strong> — ${formatBytes(backup.sizeBytes)} · ${new Date(backup.createdAt).toLocaleString()}`;
      row.append(radio, text);
      listEl.appendChild(row);
    }
  } catch (error) {
    const fail = document.createElement("p");
    fail.className = "settings-status settings-status--danger";
    fail.textContent = `Failed to list backups: ${errorMessage(error)}`;
    listEl.appendChild(fail);
    if (status) status.textContent = "";
  }
}


function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function setView(view: ViewMode): void {
  currentView = view;
  closeMobileSidebar();
  const navHome = document.getElementById("nav-home");
  const navAllSessions = document.getElementById("nav-all-sessions");
  const navActivity = document.getElementById("nav-activity");
  const dashboardPanel = document.getElementById("dashboard-panel");
  const projectPairsPanel = document.getElementById("project-pairs-panel");
  const activityPanel = document.getElementById("activity-panel");
  const logsPanel = document.getElementById("logs-panel");
  const recoveryPanel = document.getElementById("recovery-panel");
  const pairsPanel = document.getElementById("pairs-panel");
  const pairsList = document.getElementById("pairs-list");
  const noPairs = document.getElementById("no-pairs");
  const mockPagePanel = document.getElementById("mock-page-panel");
  const mockPageTitle = document.getElementById("mock-page-title");
  const sourcePanel = document.getElementById("source-panel");
  const projectsPanelHeader = document.getElementById("projects-panel-header");
  const projectPairsList = document.getElementById("project-pairs-list");
  const noProjectPairs = document.getElementById("no-project-pairs");
  const layout = document.querySelector(".layout");

  navHome?.classList.toggle("active", view === "home");
  navAllSessions?.classList.toggle("active", view === "sessions");
  document.getElementById("nav-pairs")?.classList.toggle("active", view === "pairs");
  navActivity?.classList.toggle("active", view === "activity");
  document.getElementById("nav-recovery")?.classList.toggle("active", view === "recovery");
  document.getElementById("nav-models")?.classList.toggle("active", view === "models");
  document.getElementById("nav-modules")?.classList.toggle("active", view === "modules");
  document.getElementById("nav-logs")?.classList.toggle("active", view === "logs");
  document.getElementById("nav-source")?.classList.toggle("active", view === "source");
  document.getElementById("nav-config")?.classList.toggle("active", view === "config");
  document.getElementById("nav-devices")?.classList.toggle("active", view === "devices");
  document.getElementById("nav-health")?.classList.toggle("active", view === "health");
  document.getElementById("nav-developer")?.classList.toggle("active", view === "developer");
  document.getElementById("nav-setup")?.classList.toggle("active", view === "setup");

  if (view === "activity") {
    layout?.classList.remove("view-home", "view-sessions");
    layout?.classList.add("view-activity");
    logsPanel?.classList.add("hidden");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.add("hidden");
    pairsPanel?.classList.add("hidden");
    activityPanel?.classList.remove("hidden");
    recoveryPanel?.classList.add("hidden");
    mockPagePanel?.classList.add("hidden");
    void openActivityView();
    return;
  }

  if (view === "logs") {
    layout?.classList.remove("view-home", "view-sessions", "view-activity");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.add("hidden");
    pairsPanel?.classList.add("hidden");
    activityPanel?.classList.add("hidden");
    recoveryPanel?.classList.add("hidden");
    mockPagePanel?.classList.add("hidden");
    sourcePanel?.classList.add("hidden");
    logsPanel?.classList.remove("hidden");
    void openLogsView();
    return;
  }

  if (view === "recovery") {
    layout?.classList.remove("view-home", "view-sessions");
    recoveryPanel?.classList.remove("hidden");
    logsPanel?.classList.add("hidden");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.add("hidden");
    pairsPanel?.classList.add("hidden");
    activityPanel?.classList.add("hidden");
    mockPagePanel?.classList.add("hidden");
    void refreshRecoveryPanel();
    return;
  }

  if (view === "source") {
    layout?.classList.remove("view-home", "view-sessions", "view-activity");
    logsPanel?.classList.add("hidden");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.add("hidden");
    pairsPanel?.classList.add("hidden");
    activityPanel?.classList.add("hidden");
    recoveryPanel?.classList.add("hidden");
    mockPagePanel?.classList.add("hidden");
    sourcePanel?.classList.remove("hidden");
    void loadAndRenderSourceIndex();
    void refreshGroundTruth();
    return;
  }

  sourcePanel?.classList.add("hidden");

  if (view === "pairs") {
    layout?.classList.remove("view-home", "view-sessions", "view-activity");
    logsPanel?.classList.add("hidden");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.add("hidden");
    activityPanel?.classList.add("hidden");
    mockPagePanel?.classList.add("hidden");
    pairsPanel?.classList.remove("hidden");
    // render pairs
    renderPairsPanel();
    if (noPairs) noPairs.classList.toggle("hidden", state.pairs.length > 0);
    return;
  }

  pairsPanel?.classList.add("hidden");

  logsPanel?.classList.add("hidden");
  const mockViews: Record<string, { title: string; description: string }> = {
    models: { title: "Models", description: "Worker AI models: list, switch, fallback." },
    modules: { title: "Modules & Plugins", description: "Install and manage local plugins and diagnostic capability." },
    config: { title: "Config", description: "" },
    devices: { title: "Devices", description: "Mobile devices connected via the remote service." },
    health: { title: "Health", description: "Worker connectivity, browser state, and delivery health." },
    developer: { title: "Developer", description: "Low-level diagnostics, logs, registry and internal state." },
    setup: { title: "Setup", description: "Bootstrap a new pair or project." },
  };
  if (view in mockViews) {
    layout?.classList.remove("view-home", "view-sessions", "view-activity");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.add("hidden");
    activityPanel?.classList.add("hidden");
    mockPagePanel?.classList.remove("hidden");
    const body = document.getElementById("mock-page-body");
    const configContent = document.getElementById("config-content");
    const isConfig = view === "config";
    if (mockPagePanel) {
      const sub = document.getElementById("mock-page-subtitle");
      if (sub) {
        sub.textContent = isConfig ? "Edit adapter endpoints; changes apply immediately." : mockViews[view].description;
      }
    }
    if (body) body.classList.toggle("hidden", isConfig);
    if (configContent) configContent.classList.toggle("hidden", !isConfig);
    if (isConfig) {
      void refreshDatabaseSection();
      void refreshPermissionsCard();
    }
    if (mockPageTitle) mockPageTitle.textContent = isConfig ? "Adapter Settings" : mockViews[view].title;
    return;
  }

  activityPanel?.classList.add("hidden");
  recoveryPanel?.classList.add("hidden");
  mockPagePanel?.classList.add("hidden");

  if (view === "config") {
    void refreshDatabaseSection();
  }

  if (view === "home") {
    layout?.classList.remove("view-sessions", "view-activity");
    layout?.classList.add("view-home");
    dashboardPanel?.classList.remove("hidden");
    projectPairsPanel?.classList.add("hidden");
    pairsPanel?.classList.add("hidden");
    renderDashboard();
  } else {
    layout?.classList.remove("view-home", "view-activity");
    layout?.classList.add("view-sessions");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.remove("hidden");
    projectPairsPanel?.classList.add("panel-full-width");
    pairsPanel?.classList.add("hidden");
    projectsPanelHeader?.classList.remove("hidden");
    projectPairsList?.classList.remove("hidden");
    const hasContent = state.projectPairs.length > 0 || state.pairs.length > 0;
    noProjectPairs?.classList.toggle("hidden", hasContent);
  }
}

function animateCount(element: HTMLElement, target: number, duration = 600): void {
  const start = Number(element.textContent) || 0;
  const delta = target - start;
  if (delta === 0) {
    element.textContent = String(target);
    return;
  }
  const startTime = performance.now();
  const tick = (now: number): void => {
    const elapsed = Math.min(1, (now - startTime) / duration);
    const ease = 1 - Math.pow(1 - elapsed, 3);
    element.textContent = String(Math.round(start + delta * ease));
    if (elapsed < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderDashboard(): void {
  const running = document.getElementById("stat-running");
  const healthy = document.getElementById("stat-healthy");
  const failed = document.getElementById("stat-failed");
  const total = document.getElementById("stat-total");
  const historyContainer = document.getElementById("dashboard-history");
  const agentHealthContainer = document.getElementById("dashboard-agent-health-list");
  const gettingStarted = document.getElementById("dashboard-getting-started");

  const statuses = Array.from(state.statuses.values());
  const runningCount = statuses.filter(s => s.runtimeState === "RUNNING" || s.runtimeState === "STARTING" || s.supervisorState === "SUPERVISING").length;
  const healthyCount = statuses.filter(s => (s.runtimeState === "RUNNING" || s.supervisorState === "SUPERVISING") && s.supervisorState !== "FAILED" && s.supervisorState !== "STUCK" && !["failed", "fail"].includes((s.worker ?? "").toLowerCase()) && !["failed", "fail"].includes((s.planner ?? "").toLowerCase())).length;
  const failedCount = statuses.filter(s => s.runtimeState === "ERROR" || s.supervisorState === "FAILED" || s.supervisorState === "STUCK" || ["failed", "fail"].includes((s.worker ?? "").toLowerCase()) || ["failed", "fail"].includes((s.planner ?? "").toLowerCase())).length;
  const totalCount = Math.max(state.pairs.length, statuses.length);

  if (running) animateCount(running, runningCount);
  if (healthy) animateCount(healthy, healthyCount);
  if (failed) animateCount(failed, failedCount);
  if (total) animateCount(total, totalCount);

  if (gettingStarted) {
    gettingStarted.classList.toggle("hidden", state.projectPairs.length > 0 || state.pairs.length > 0);
  }

  const diagReport = document.querySelector(".diagnostics-report");
  if (diagReport) {
    const transport = evaluateTransportHealth(failedCount === 0, healthyCount > 0);
    const drift = evaluateSessionDrift(runningCount, Math.max(1, totalCount));
    const overall = overallHealth([transport, drift]);
    const lines = [
      `Overall health: ${overall.toUpperCase()}`,
      `Transport: ${transport.status} — ${transport.message}`,
      `Session drift: ${drift.status} — ${drift.message}`,
      `Pairs: ${totalCount}`,
      `Running: ${runningCount}`,
      `Healthy: ${healthyCount}`,
      `Failed: ${failedCount}`,
      `Last refresh: ${new Date().toLocaleTimeString()}`,
    ];
    diagReport.textContent = lines.join("\n");
    diagReport.classList.toggle("health-critical", overall === "critical");
    diagReport.classList.toggle("health-warning", overall === "warning");
  }

  if (agentHealthContainer) {
    renderDashboardAgentHealth(agentHealthContainer);
  }

  void updateBackendHealthStatus();

  renderAgent();

  if (historyContainer) {
    if (window.desktop && typeof window.desktop.getTimeline === "function") {
    void (async () => {
      const timeline = await window.desktop.getTimeline(undefined, 50);
      const transportEvents = timeline.filter(e => !e.type.includes("ERROR") && e.type !== "FAIL" && e.type !== "VALIDATION_FAILED");
      const errorEvents = timeline.filter(e => e.type.includes("ERROR") || e.type === "FAIL" || e.type === "VALIDATION_FAILED" || e.type.includes("FAILED"));

      renderEventList(historyContainer, transportEvents.slice(-10), "No transport activity observed yet.");
      
      const errorContainer = document.getElementById("dashboard-errors");
      if (errorContainer) {
        renderEventList(errorContainer, errorEvents.slice(-10), "No errors reported recently.");
      }
    })();
    }
  }
}

function renderDashboardAgentHealth(container: HTMLElement): void {
if (state.pairs.length === 0) {
    const empty = el("div", "empty-state agent-empty");
    empty.innerHTML = `<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="2" stroke-opacity="0.4"/><path d="M24 8 L36 24 L24 40 L12 24 Z" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="4" fill="currentColor"/></svg><span><strong>No agent pairs yet.</strong><br/>Click <em>+ Add Pair</em> to create your first Planner ↔ Worker relay.</span>`;
    container.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const pair of state.pairs) {
    const status = state.statuses.get(pair.pairId);
    const card = el("div", "dashboard-agent-card");

    // Header: Name, overall status, Action buttons (Start/Pause, Initialize, Timeline)
    const header = el("div", "dashboard-agent-header");
    const titleArea = el("div", "dashboard-agent-title");
    const name = el("span", "dashboard-agent-name");
    name.textContent = pair.pairId;

    const runtimeStateBadge = el("span", `badge ${
      (status?.runtimeState === "RUNNING" || status?.runtimeState === "STARTING") ? "badge-ok" :
      status?.runtimeState === "PAUSED" ? "badge-warn" :
      status?.runtimeState === "ERROR" ? "badge-danger" : "badge-neutral"
    }`);
    runtimeStateBadge.textContent = status?.runtimeState || (pair.enabled ? "READY" : "DISABLED");

    titleArea.append(name, runtimeStateBadge);

    const actions = el("div", "dashboard-agent-actions");

    // Start / Pause button
    const isRunning = status?.runtimeState === "RUNNING" || status?.runtimeState === "STARTING" || status?.supervisorState === "SUPERVISING";
    const toggleBtn = el("button", `btn btn-sm ${isRunning ? "btn-warn" : "btn-primary"}`);
    toggleBtn.textContent = isRunning ? "Pause" : "Start";
    toggleBtn.addEventListener("click", async () => {
      toggleBtn.disabled = true;
      try {
        if (isRunning) {
          await runAction(() => window.desktop.pausePair(pair.pairId));
          toast(`Pair "${pair.pairId}" paused.`);
        } else {
          await runAction(() => window.desktop.startPair(pair.pairId));
          toast(`Pair "${pair.pairId}" started.`);
        }
        await refresh();
      } finally {
        toggleBtn.disabled = false;
      }
    });

    // Initialize button
    const initBtn = el("button", "btn btn-sm btn-ghost");
    initBtn.textContent = "⚡ Initialize";
    initBtn.title = "Verify server reachability, session binding, and browser connectivity";
    initBtn.addEventListener("click", async () => {
      initBtn.disabled = true;
      initBtn.textContent = "Initializing…";
      try {
        const result = await runAction(() => window.desktop.initializePair(pair.pairId));
        const outcome = initOutcome(pair.pairId, result);
        toast(outcome.message, outcome.tone);
        if (result?.status !== "READY") {
          for (const check of (result?.checks ?? []).filter((check) => check.status !== "PASS")) {
            noteActivityEvent({
              pairId: pair.pairId,
              type: "PAIR_VALIDATION_FAILED",
              reason: `${check.name}: ${check.reason}`,
              time: new Date().toISOString()
            });
          }
        }
        await refresh();
      } catch (err) {
        toast(`Initialization error: ${errorMessage(err)}`);
      } finally {
        initBtn.disabled = false;
        initBtn.textContent = "⚡ Initialize";
      }
    });

    // Timeline button
    const timelineBtn = el("button", "btn btn-sm btn-ghost");
    timelineBtn.textContent = "Timeline";
    timelineBtn.addEventListener("click", () => {
      void openTimelineModal(pair.pairId);
    });

    actions.append(toggleBtn, initBtn, timelineBtn);
    header.append(titleArea, actions);

    // Body: Worker & Planner peers side-by-side
    const peersGrid = el("div", "dashboard-agent-peers");

    // Worker Peer Box
    const workerBox = el("div", "dashboard-peer-box");
    const workerTop = el("div", "dashboard-peer-top");
    const workerRole = el("span", "dashboard-peer-role");
    workerRole.textContent = "Worker Agent";

    const workerStatusArea = el("div", "dashboard-peer-status");
    const workerHealth = el("span", `badge ${healthBadgeClass(status?.worker)}`);
    workerHealth.textContent = status?.worker ?? "UNKNOWN";

    const workerActivity = el("span", `activity-badge ${status?.workerActivity === "working" ? "working" : "idle"}`);
    const workerPulse = el("span", "pulse-circle");
    const workerActivityLabel = el("span");
    workerActivityLabel.textContent = status?.workerActivity === "working" ? "Working" : "Idle";
    workerActivity.append(workerPulse, workerActivityLabel);

    workerStatusArea.append(workerHealth, workerActivity);
    workerTop.append(workerRole, workerStatusArea);

    const workerSession = el("div", "dashboard-peer-detail");
    workerSession.textContent = `Session: ${pair.worker.sessionId || "unbound"}`;
    workerSession.title = pair.worker.sessionId || "";

    const workerRepo = el("div", "dashboard-peer-detail");
    workerRepo.textContent = `Repo: ${pair.worker.repoPath || "not configured"}`;
    workerRepo.title = pair.worker.repoPath || "";

    const workerEndpoint = el("div", "dashboard-peer-detail");
    workerEndpoint.textContent = `Endpoint: ${pair.worker.server?.baseUrl || "http://127.0.0.1:4096/"}`;

    workerBox.append(workerTop, workerSession, workerRepo, workerEndpoint);

    // Planner Peer Box
    const plannerBox = el("div", "dashboard-peer-box");
    const plannerTop = el("div", "dashboard-peer-top");
    const plannerRole = el("span", "dashboard-peer-role");
    plannerRole.textContent = "Planner Agent";

    const plannerStatusArea = el("div", "dashboard-peer-status");
    const plannerHealth = el("span", `badge ${healthBadgeClass(status?.planner)}`);
    plannerHealth.textContent = status?.planner ?? "UNKNOWN";

    const plannerActivity = el("span", `activity-badge ${status?.plannerActivity === "working" ? "working" : "idle"}`);
    const plannerPulse = el("span", "pulse-circle");
    const plannerActivityLabel = el("span");
    plannerActivityLabel.textContent = status?.plannerActivity === "working" ? "Working" : "Idle";
    plannerActivity.append(plannerPulse, plannerActivityLabel);

    plannerStatusArea.append(plannerHealth, plannerActivity);
    plannerTop.append(plannerRole, plannerStatusArea);

    const plannerConv = el("div", "dashboard-peer-detail");
    plannerConv.textContent = `Conv: ${pair.planner.conversationId || "not linked"}`;
    plannerConv.title = pair.planner.conversationId || "";

    const plannerBrowser = el("div", "dashboard-peer-detail");
    plannerBrowser.textContent = `CDP: ${pair.planner.browser?.cdpUrl || "http://127.0.0.1:9222/"}`;

    plannerBox.append(plannerTop, plannerConv, plannerBrowser);

    peersGrid.append(workerBox, plannerBox);

    // Footer metadata: Supervisor & recovery
    const meta = el("div", "dashboard-agent-meta");
    const supervisor = el("span");
    supervisor.textContent = `Supervisor: ${status?.supervisorState || "IDLE"}${status?.recovering ? " (Recovering…)" : ""}`;

    const observed = el("span");
    observed.textContent = `Last observed: ${status?.lastObservedAt ? formatTime(status.lastObservedAt) : "Just now"}`;

    meta.append(supervisor, observed);

    card.append(header, peersGrid, meta);
    fragment.appendChild(card);
  }

  container.replaceChildren(fragment);
}

/** Format a millisecond duration as HH:MM:SS for uptime tiles. */
function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Real relay uptime: time since the longest-running RUNNING pair started (from runtime_state). */
function relayUptime(statuses: PeerHealthDto[]): string {
  let earliest: number | undefined;
  for (const status of statuses) {
    if (status.runtimeState !== "RUNNING" && status.runtimeState !== "STARTING") continue;
    const start = status.lastRuntimeStartAt ? Date.parse(status.lastRuntimeStartAt) : Number.NaN;
    if (Number.isNaN(start)) continue;
    if (earliest === undefined || start < earliest) earliest = start;
  }
  return earliest === undefined ? "—" : formatElapsed(Date.now() - earliest);
}

function installAgentRefreshTimer(): void {
  window.setInterval(() => {
    if (currentView === "home" && document.getElementById("agent-hero")) {
      try { renderAgent(); } catch { /* paint best-effort */ }
    }
  }, 1000);
}

/** Pick the pair the dashboard should focus on: the running one, else an enabled non-paused one, else the first. */
function pickDashboardPair(pairs: typeof state.pairs): (typeof state.pairs)[number] | undefined {
  const running = pairs.find((pair) => {
    const status = state.statuses.get(pair.pairId);
    return status?.runtimeState === "RUNNING" || status?.runtimeState === "STARTING";
  });
  if (running) return running;
  const enabled = pairs.find((pair) => pair.enabled && state.statuses.get(pair.pairId)?.paused !== true);
  return enabled ?? pairs[0];
}

function turnSummary(status?: PeerHealthDto): string {
  if (!status) return "no observation yet";
  if (status.latestCycleStatus) {
    return `last cycle: ${status.latestCycleStatus}`;
  }
  return status.hasRelayHistory ? "history present, no cycles yet" : "no turns yet";
}

function renderAgent(): void {
  const statuses = Array.from(state.statuses.values());
  const focused = pickDashboardPair(state.pairs);
  const focusedStatus = focused ? state.statuses.get(focused.pairId) : undefined;

  const activePairs = state.statuses
    ? [...state.statuses.values()].filter((s) => s.runtimeState === "RUNNING" || s.runtimeState === "STARTING").length
    : 0;
  const isAmbiguous = (s: PeerHealthDto): boolean => s.latestDeliveryStatus === "DELIVERING" && (s.latestDeliveryVerifyAttempts ?? 0) >= 3;
  const attentionPairs = statuses.filter((s) => s.supervisorState === "STUCK" || s.supervisorState === "FAILED" || s.recovering === true || isAmbiguous(s)).length;

  const setText = (id: string, text: string): void => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText("agent-active-pairs", String(activePairs));
  const focusedObserved = focusedStatus?.lastObservedAt;
  setText("agent-last-update", focusedObserved ? `Observed ${new Date(focusedObserved).toLocaleTimeString()}` : "Awaiting observation");
  setText("agent-pairs-count", String(state.pairs.length));
  setText("agent-attention-count", String(attentionPairs));
  setText("agent-uptime", relayUptime(statuses));

  // Current Turn / Ownership
  const ownerText = focusedStatus ? ownerLabel(focusedStatus) : "Unknown";
  setText("agent-turn-owner", ownerText);
  setText("agent-turn-subtitle", focused ? `${focused.pairId} · ${turnSummary(focusedStatus)}` : "No pair configured");

  // Bot Activity
  const activity = focusedStatus ? activityLabel(focusedStatus) : null;
  setText("agent-activity-label", activity?.label ?? "Unknown");
  setText("agent-activity-sub", activity?.detail ?? "Not observing");

  // Delivery — relay-record evidence. verifiedAttempts >= 3 (Rule 12/13 verification
  // budget) means the delivery is unverified/ambiguous, never presented as success.
  const delivery = deliveryEvidenceFor(focusedStatus);
  setText("agent-delivery-label", delivery.label);
  setText("agent-delivery-sub", delivery.detail);
  const deliveryCard = document.getElementById("agent-delivery-card");
  if (deliveryCard) {
    deliveryCard.className = `agent-kpi${delivery.variant ? ` ${delivery.variant}` : ""}`;
    const deliveryIcon = deliveryCard.querySelector(".agent-kpi-icon-right");
    if (deliveryIcon) {
      deliveryIcon.className = `agent-kpi-icon-right ${delivery.iconClass}`;
    }
  }

  // Time in State / since
  const stateChanged = focusedStatus?.stateChangedAt ?? focusedStatus?.lastObservedAt;
  const sinceText = stateChanged ? new Date(stateChanged).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  setText("agent-time-value", stateChanged ? timeSinceIso(stateChanged) : "—");
  setText("agent-time-sub", stateChanged ? `Since ${sinceText}` : "No state transition observed");

  // Progression stages
  renderAgentProgression(document.getElementById("agent-progression-track"), focusedStatus);
  setText("agent-gate-text", gateLabel(focusedStatus));
}

function ownerLabel(status: PeerHealthDto): string {
  if (status.paused) return "Paused";
  const busy = status.workerActivity === "working" || status.plannerActivity === "working";
  const stuck = status.supervisorState === "STUCK" || status.supervisorState === "FAILED";
  if (status.supervisorState === "WAITING_PLANNER") return "Planner";
  if (stuck) return "Unknown";
  if (busy && status.workerActivity === "working") return "Worker";
  if (busy && status.plannerActivity === "working") return "Planner";
  if (status.supervisorState === "WORKING" || status.supervisorState === "WAITING_WORKER") return "Worker";
  if (status.supervisorState === "WAITING_INPUT") return "Planner";
  if (status.supervisorState === "READY") return "Ready";
  if (status.supervisorState === "IDLE") return "Idle";
  if (status.supervisorState === "COMPLETED") return "Complete";
  return "Unknown";
}

function activityLabel(status: PeerHealthDto): { label: string; detail: string } {
  if (status.recovering) return { label: "Recovering", detail: status.lastError ?? "Recovery in progress" };
  if (status.supervisorState === "STUCK") return { label: "Blocked", detail: "No progress observed" };
  if (status.supervisorState === "FAILED") return { label: "Failed", detail: status.lastError ?? "Turn failed" };
  if (status.supervisorState === "PAUSED" || status.paused) return { label: "Paused", detail: "Awaiting resume" };
  if (status.supervisorState === "WAITING_WORKER" || status.workerActivity === "working") return { label: "Observing", detail: "Awaiting Worker report" };
  if (status.supervisorState === "WAITING_PLANNER" || status.plannerActivity === "working") return { label: "Observing", detail: "Awaiting Planner response" };
  if (status.supervisorState === "WAITING_INPUT") return { label: "Awaiting", detail: "Worker waiting for input" };
  if (status.supervisorState === "WORKING") return { label: "Dispatching", detail: "Supervisor state: WORKING" };
  if (status.supervisorState === "READY") return { label: "Ready", detail: "Ready for next turn" };
  if (status.supervisorState === "IDLE") return { label: "Idle", detail: "Idle" };
  if (status.supervisorState === "COMPLETED") return { label: "Complete", detail: "Turn complete" };
  return { label: "Unknown", detail: status.supervisorState ?? "Not observed" };
}

function deliveryEvidenceFor(status?: PeerHealthDto): { label: string; detail: string; variant: string; iconClass: string } {
  const attempts = status?.latestDeliveryVerifyAttempts ?? 0;
  const latest = status?.latestDeliveryStatus;
  if (latest === "DELIVERED") return { label: "Confirmed", detail: "Delivered to relay target", variant: "agent-kpi-ok", iconClass: "agent-ok" };
  if (latest === "FAILED") return { label: "Failed", detail: "Delivery failed — see Activity", variant: "agent-kpi-danger", iconClass: "agent-danger" };
  if (latest === "DELIVERING" && attempts >= 3) return { label: "Ambiguous", detail: "Unverified after 3 attempts — resolve before resend", variant: "agent-kpi-danger", iconClass: "agent-danger" };
  if (latest === "DELIVERING" && attempts > 0) return { label: "Verifying", detail: `Verification attempt ${attempts}/3`, variant: "agent-kpi-warn", iconClass: "agent-warn" };
  if (latest) return { label: "Pending", detail: "Awaiting delivery verification", variant: "", iconClass: "agent-warn" };
  if (status?.hasRelayHistory) return { label: "Pending", detail: "Delivery not verified", variant: "", iconClass: "agent-warn" };
  return { label: "Pending", detail: "No deliveries yet", variant: "", iconClass: "agent-warn" };
}

function gateLabel(status: PeerHealthDto | undefined): string {
  if (!status) return "No pair selected";
  if (status.awaitingStartingSideSelection) return "Awaiting Starting-Side Selection — pick which side relays first";
  if (status.startingSide) return `Starting side: ${status.startingSide === "planner" ? "Planner" : "Worker"} — dispatching the selected side first`;
  if (status.lastError?.startsWith("UNRECOVERABLE_GAPS")) return "Event window may contain gaps — unverified";
  if (status.recovering) return `Recovering: ${status.lastError ?? "automatic retry"}`;
  if (status.supervisorState === "STUCK") return "Awaiting operator or Recovery Agent";
  if (status.supervisorState === "FAILED") return status.lastError ? `Blocked: ${status.lastError}` : "Blocked";
  if (status.supervisorState === "PAUSED" || status.paused) return "Paused — awaiting resume";
  if (status.latestDeliveryStatus === "DELIVERING" && (status.latestDeliveryVerifyAttempts ?? 0) >= 3) return "Delivery unverified — resolve ambiguity before resend";
  if (status.supervisorState === "COMPLETED") return "Turn complete";
  if (status.workerActivity === "working" || status.supervisorState === "WAITING_WORKER" || status.supervisorState === "WORKING") return "Observing Worker execution";
  if (status.plannerActivity === "working" || status.supervisorState === "WAITING_PLANNER") return "Observing Planner response";
  if (status.supervisorState === "READY") return "Ready for next dispatch";
  if (status.supervisorState === "IDLE") return "Idle";
  return "Observing";
}

function timeSinceIso(iso: string): string {
  const past = Date.parse(iso);
  if (Number.isNaN(past)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - past) / 1000));
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

// Real turn lifecycle, derived from the durable ledger + relay cycles:
// admitted (planner→worker record accepted) → dispatched (cycle created) →
// reported (worker completion observed) → delivered (report at the planner).
const AGENT_STAGES: Array<{ id: string; label: string }> = [
  { id: "admitted", label: "Admitted" },
  { id: "dispatched", label: "Dispatched" },
  { id: "reported", label: "Reported" },
  { id: "delivered", label: "Delivered" }
];

let lastAgentTrackSignature: string | undefined;

function renderAgentProgression(track: HTMLElement | null, status?: PeerHealthDto): void {
  if (!track) return;
  const activeIndex = stageIndexFor(status);
  const blocked = status?.supervisorState === "STUCK" || status?.supervisorState === "FAILED";
  const signature = `${activeIndex}|${blocked ? "blocked" : "open"}|${status?.latestCycleStatus ?? "none"}|${status?.latestCycleWorkerCompletedAt ? 1 : 0}|${status?.latestCycleDispatchedAt ? 1 : 0}`;
  if (signature === lastAgentTrackSignature) return;
  lastAgentTrackSignature = signature;
  const frag = document.createDocumentFragment();
  AGENT_STAGES.forEach((stage, index) => {
    const done = !status ? false : isBeforeOrDone(activeIndex, index);
    const active = !blocked && index === activeIndex;
    const wrapper = document.createElement("div");
    wrapper.className = [
      "agent-stage",
      done ? "done" : "",
      active ? "active" : ""
    ].filter(Boolean).join(" ");
    wrapper.setAttribute("role", "listitem");
    wrapper.setAttribute("aria-label", `${stage.label}: ${done ? "done" : active ? "active" : "pending"}`);
    const pip = document.createElement("span");
    pip.className = "agent-stage-pip";
    pip.textContent = done ? "✓" : "";
    wrapper.appendChild(pip);
    const label = document.createElement("span");
    label.className = "agent-stage-label";
    label.textContent = stage.label;
    wrapper.appendChild(label);
    if (index < AGENT_STAGES.length - 1) {
      const connector = document.createElement("span");
      connector.className = `agent-stage-connector${done ? " done" : ""}`;
      connector.setAttribute("aria-hidden", "true");
      wrapper.appendChild(connector);
    }
    frag.appendChild(wrapper);
  });
  track.replaceChildren(frag);
}

function stageIndexFor(status?: PeerHealthDto): number {
  if (!status) return -1;
  const blocked = status.supervisorState === "STUCK" || status.supervisorState === "FAILED" || status.recovering;
  if (status.latestCycleStatus === "DELIVERED") return blocked ? 3 : 3;
  if (status.latestCycleWorkerCompletedAt) return 2;
  if (status.latestCycleDispatchedAt || status.latestCycleStatus === "DISPATCHED" || status.latestCycleStatus === "WORKER_RESPONDED") return 1;
  if (status.hasRelayHistory) return 0;
  return -1;
}

function isBeforeOrDone(activeIndex: number, index: number): boolean {
  if (activeIndex < 0) return false;
  return index < activeIndex;
}

function renderEventList(container: HTMLElement, events: any[], emptyMessage: string): void {
  if (events.length === 0) {
    const empty = el("div", "empty-state");
    empty.textContent = emptyMessage;
    container.replaceChildren(empty);
    return;
  }

  const list = el("div", "history-list");
  for (const entry of [...events].reverse()) {
    const item = el("div", "history-item");
    const time = el("span", "history-time");
    time.textContent = formatTime(entry.time);
    const type = el("span", `history-type badge ${entry.type.includes("FAILED") || entry.type.includes("ERROR") || entry.type === "FAIL" ? "badge-danger" : "badge-neutral"}`);
    type.textContent = entry.type.replace("WORKER_", "W_").replace("PLANNER_", "P_").replace("_RELAYED", "").replace("_OBSERVED", "").replace("VALIDATION_", "V_");
    
    const label = el("span", "history-label");
    label.textContent = entry.pairId || entry.projectPairId || "System";

    const reason = el("span", "history-reason");
    reason.textContent = entry.reason || "—";
    reason.title = entry.reason || "";
    
    item.append(time, type, label, reason);
    list.appendChild(item);
  }
  container.replaceChildren(list);
}

function projectPairBadgeClass(presence: ProjectPairPresence): string {
  switch (presence) {
    case "active":
      return "badge-ok";
    case "partial":
      return "badge-degraded";
    default:
      return "badge-neutral";
  }
}


function renderProjectPairs(): void {
  const list = document.getElementById("project-pairs-list");
  const empty = document.getElementById("no-project-pairs");
  if (!list || !empty) {
    return;
  }
  const navProjectsCount = document.getElementById("nav-projects-count");
  const groups = projectPairGroups();
  if (navProjectsCount) navProjectsCount.textContent = String(groups.length);
  updateStartAllButton();
  const fragment = document.createDocumentFragment();
  for (const group of groups) fragment.appendChild(renderProjectPairCard(group.primary, group.members));
  const unassigned = renderUnassignedSessions();
  if (unassigned) {
    fragment.appendChild(unassigned);
  }
  list.replaceChildren(fragment);
  const hasContent = state.projectPairs.length > 0 || state.pairs.length > 0;
  empty.classList.toggle("hidden", hasContent);
  list.classList.toggle("hidden", !hasContent);
  renderSidebarProjects();
}

function renderSidebarProjects(): void {
  const container = document.getElementById("sidebar-projects-list");
  if (!container) return;
  const searchInput = document.getElementById("sidebar-search-input") as HTMLInputElement | null;
  const query = (searchInput?.value ?? "").toLowerCase().trim();

  const fragment = document.createDocumentFragment();
  const projects = projectPairGroups().filter((group) => group.title.toLowerCase().includes(query));

  if (projects.length === 0) {
    const empty = el("div", "sidebar-empty-hint");
    empty.textContent = query ? "No matches" : "No projects";
    fragment.appendChild(empty);
  } else {
    for (const group of projects) {
      const project = group.primary;
      const btn = el("button", "sidebar-project-item");
      btn.dataset.projectPairId = project.projectPairId;
      const presence = group.members.some((member) => projectPairPresence(member) === "active")
        ? "active"
        : group.members.some((member) => projectPairPresence(member) === "partial") ? "partial" : "idle";
      const dotClass = presence === "active" ? "dot-ok" : presence === "partial" ? "dot-warn" : "dot-dim";
      const dot = el("span", `sidebar-project-status-dot ${dotClass}`);
      const icon = el("span", "sidebar-project-icon");
      icon.textContent = "📁";
      const name = el("span", "sidebar-project-name");
      name.textContent = group.title;
      name.title = group.title;
      btn.append(dot, icon, name);
      btn.addEventListener("click", () => {
        container.querySelectorAll(".sidebar-project-item").forEach((el) => el.classList.remove("active-project"));
        btn.classList.add("active-project");
        setView("sessions");
        expandedProjectPairs.add(project.projectPairId);
        renderProjectPairs();
        const card = document.querySelector(`[data-project-pair-id="${project.projectPairId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "start" });
          card.classList.add("highlight-pulse");
          setTimeout(() => card.classList.remove("highlight-pulse"), 1200);
        }
      });
      fragment.appendChild(btn);
    }
  }
  container.replaceChildren(fragment);
}

function renderUnassignedSessions(): HTMLElement | null {
  const unassigned = state.pairs.filter((pair) => state.sessionProject.get(pair.pairId) === undefined);
  if (unassigned.length === 0) {
    return null;
  }
  const sessionList = el("div", "project-session-list");
  for (const session of unassigned) {
    appendPairCard(sessionList, session);
  }
  return buildCard({
    wrapperClass: "project-pair-card",
    datasetKey: "projectPairId",
    datasetValue: "unassigned",
    expanded: false,
    header: {
      wrapperClass: "project-pair-head",
      id: "unassigned",
      titleClass: "pair-id",
      titleChildren: [(() => { const t = el("span", "pair-id"); t.textContent = "Unassigned relay pairs"; return t; })()],
      badges: [{ cssClass: "badge-neutral", text: `${unassigned.length} relay pair${unassigned.length === 1 ? "" : "s"}` }],
      toggleLabel: "Details"
    },
    body: [sessionList]
  });
}

function projectDisplayName(pair: ProjectPairDto): string {
  return pair.projectName?.trim() || repoBasename(pair.worker.repoPath) || pair.planner.projectName || pair.projectPairId;
}

function projectPairGroups(): Array<{ title: string; primary: ProjectPairDto; members: ProjectPairDto[] }> {
  const grouped = new Map<string, ProjectPairDto[]>();
  for (const pair of state.projectPairs) {
    const title = projectDisplayName(pair);
    const key = title.trim().toLocaleLowerCase();
    const members = grouped.get(key) ?? [];
    members.push(pair);
    grouped.set(key, members);
  }
  return [...grouped.values()].map((members) => {
    members.sort((left, right) => Number(Boolean(right.worker.repoPath)) - Number(Boolean(left.worker.repoPath)));
    return { title: projectDisplayName(members[0]!), primary: members[0]!, members };
  });
}

function renderProjectPairCard(pair: ProjectPairDto, members: ProjectPairDto[] = [pair]): HTMLElement {
  const expanded = expandedProjectPairs.has(pair.projectPairId);
  const presence = members.some((member) => projectPairPresence(member) === "active")
    ? "active"
    : members.some((member) => projectPairPresence(member) === "partial") ? "partial" : "idle";

  const body: HTMLElement[] = [];
  if (expanded) {
    body.push(renderProjectPairDetails(pair));
    if (members.length > 1) {
      const mappings = el("div", "project-session-list");
      for (const member of members) {
        const mapping = el("div", "detail");
        mapping.textContent = [
          member.planner.projectName ?? member.planner.projectSlug,
          member.planner.projectUrl,
          member.projectPairId
        ].filter(Boolean).join(" · ");
        mappings.appendChild(mapping);
      }
      body.push(mappings);
    }
    body.push(buildDangerZone([{
      label: "Remove",
      enabled: true,
      onClick: () => {
        if (!window.confirm(`Remove project ${pair.projectPairId}? This cannot be undone.`)) return;
        removeProjectPair(pair.projectPairId);
      }
    }]));
  }

  const titleSpan = el("span", "pair-id");
  titleSpan.textContent = projectDisplayName(pair);

  const sessions = state.pairs.filter(
    (session) => members.some((member) => state.sessionProject.get(session.pairId) === member.projectPairId)
  );
  if (sessions.length > 0) {
    const head = el("div", "detail");
    head.textContent = `Relay pairs for this project (${sessions.length})`;
    body.push(head);
    const sessionList = el("div", "project-session-list");
    for (const session of sessions) {
      appendPairCard(sessionList, session);
    }
    body.push(sessionList);
  }

  if (sessions.length === 0 && expanded) {
    const hint = el("div", "detail starting-side-selected");
    hint.textContent = "No relay pairs linked to this project — pairs whose worker repo matches this folder appear here.";
    body.push(hint);
  }

  const sessionIds = sessions.map((s) => s.pairId);
  const hasEligiblePair = sessionIds.some((id) => {
    const s = state.statuses.get(id);
    return s && (s.runtimeState === "STOPPED" || s.runtimeState === "PAUSED");
  });
  const hasActivePair = sessionIds.some((id) => {
    const s = state.statuses.get(id);
    return s && (s.runtimeState === "RUNNING" || s.runtimeState === "STARTING");
  });
  const projectActions = el("div", "project-actions");
  if (members.length === 1 && hasEligiblePair) {
    projectActions.appendChild(actionButton("Start Relay", "btn-sm btn-primary", true, () => {
      void (async () => {
        const status = await runAction(async () => window.desktop.startProject?.(pair.projectPairId));
        if (status) setStatuses(status);
        renderProjectPairs();
      })();
    }));
  }
  if (members.length === 1 && hasActivePair) {
    projectActions.appendChild(actionButton("Stop Relay", "btn-sm", true, () => {
      void (async () => {
        const status = await runAction(async () => window.desktop.pauseProject?.(pair.projectPairId));
        if (status) setStatuses(status);
        renderProjectPairs();
      })();
    }));
  }
  if (projectActions.childNodes.length > 0) {
    body.push(projectActions);
  }

  const projectConfigActions = el("div", "pair-actions-row pair-actions-row--mt-12");
  projectConfigActions.appendChild(
    actionButton("View Timeline", "btn-sm", true, () => openTimelineModal(pair.projectPairId))
  );
  body.push(projectConfigActions);

  return buildCard({
    wrapperClass: "project-pair-card",
    datasetKey: "projectPairId",
    datasetValue: pair.projectPairId,
    expanded,
    header: {
      wrapperClass: "project-pair-head",
      id: pair.projectPairId,
      titleClass: "pair-id",
      titleChildren: [titleSpan],
      badges: [{ cssClass: projectPairBadgeClass(presence), text: presence.toUpperCase() }],
      toggleLabel: "Details",
      onToggle: buildExpandableToggle(pair.projectPairId, expanded, expandedProjectPairs, () => renderProjectPairs())
    },
    body
  });
}

function renderProjectPairDetails(pair: ProjectPairDto): HTMLElement {
  const details = el("div", "pair-card-details");
  const snapshot = state.projectPairSnapshots.get(pair.projectPairId);

  const workerHead = el("div", "detail");
  workerHead.textContent = "Worker project";
  details.appendChild(workerHead);
  details.appendChild(buildIdentityBlock([
    { label: "Folder", value: pair.worker.repoPath },
    { label: "Agent project ID", value: pair.worker.projectId ?? "—" }
  ]));

  const sessions = snapshot?.openCodeSessions ?? [];
  const sessionHead = el("div", "detail");
  sessionHead.textContent = snapshot ? `Worker Agent sessions (${sessions.length})` : "Worker Agent sessions (unknown — Worker Agent unreachable)";
  details.appendChild(sessionHead);
  if (snapshot && sessions.length === 0) {
    const none = el("div", "detail");
    none.textContent = "No open Worker Agent sessions for this repo.";
    details.appendChild(none);
  }
  for (const session of sessions) {
    const sessionTitle = (session.title ?? "").trim() || "Untitled session";
    details.appendChild(identityRow(sessionTitle, session.sessionId));
  }

  const plannerHead = el("div", "detail");
  plannerHead.textContent = "Planner project";
  details.appendChild(plannerHead);
  details.appendChild(buildIdentityBlock([
    { label: "Name", value: pair.planner.projectName ?? "—" },
    { label: "Slug", value: pair.planner.projectSlug },
    { label: "Project URL", value: pair.planner.projectUrl ?? "—" }
  ]));

  const conversations = snapshot?.chatgpt?.conversationIds ?? [];
  const titles = snapshot?.chatgpt?.conversationTitles ?? {};
  const tabCount = snapshot?.chatgpt?.openTabCount ?? 0;
  const convoHead = el("div", "detail");
  convoHead.textContent = snapshot?.chatgpt
    ? `Conversations (${conversations.length} · ${tabCount} open tab${tabCount === 1 ? "" : "s"})`
    : "Conversations (unknown — Planner Agent unreachable)";
  details.appendChild(convoHead);
  if (snapshot?.chatgpt && conversations.length === 0) {
    const none = el("div", "detail");
    none.textContent = "No open conversations in this project.";
    details.appendChild(none);
  }
  for (const conversationId of conversations) {
    const convoTitle = (titles[conversationId] ?? "").trim() || "Untitled conversation";
    details.appendChild(identityRow(convoTitle, conversationId));
  }

  return details;
}

async function refreshProjectPairs(): Promise<void> {
  if (!window.desktop || typeof window.desktop.listProjectPairs !== "function") {
    return;
  }
  const pairs = await runAction(() => window.desktop.listProjectPairs());
  if (!pairs) {
    return;
  }
  state.projectPairs = pairs;
  const [sessions, projects] = await Promise.all([
    window.desktop.discoverWorkerSessions().catch(() => undefined),
    window.desktop.discoverChatGptProjects().catch(() => undefined)
  ]);
  const snapshots = new Map<string, ProjectPairSnapshot>();
  for (const pair of pairs) {
    snapshots.set(pair.projectPairId, {
      openCodeSessions: (sessions ?? []).filter((session) => session.repoPath === pair.worker.repoPath),
      chatgpt: (projects ?? []).find((project) => project.projectSlug === pair.planner.projectSlug)
    });
  }
  state.projectPairSnapshots = snapshots;
  refreshProjectAssignments();
  renderProjectPairs();
}

async function removeProjectPair(projectPairId: string): Promise<void> {
  const result = await runAction(() => window.desktop.removeProjectPair(projectPairId));
  if (result) {
    toast(`Removed project ${result.projectPairId}.`, "ok");
    await refreshProjectPairs();
  }
}

function openProjectPairModal(): void {
  setDiscoveredOpenCodeProjects([]);
  setDiscoveredChatGptProjects([]);
  const name = document.getElementById("project-pair-name") as HTMLInputElement | null;
  const repo = document.getElementById("project-pair-repo") as HTMLInputElement | null;
  const chatgpt = document.getElementById("project-pair-chatgpt") as HTMLInputElement | null;
  if (name) name.value = "";
  if (repo) repo.value = "";
  if (chatgpt) chatgpt.value = "";
  hideProjectPairError();
  renderProjectPairOptions();
  document.getElementById("project-pair-modal")?.classList.remove("hidden");
  repo?.focus();
}

function closeProjectPairModal(): void {
  document.getElementById("project-pair-modal")?.classList.add("hidden");
}

function showProjectPairError(message: string): void {
  const error = document.getElementById("project-pair-error");
  if (!error) {
    return;
  }
  error.textContent = message;
  error.classList.remove("hidden");
}

function hideProjectPairError(): void {
  const error = document.getElementById("project-pair-error");
  if (!error) {
    return;
  }
  error.textContent = "";
  error.classList.add("hidden");
}

function renderProjectPairOptions(): void {
  const repoSelect = document.getElementById("project-pair-repo-options") as HTMLSelectElement | null;
  if (repoSelect) {
    repoSelect.replaceChildren();
    if (getDiscoveredOpenCodeProjects().length > 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = `Detected Worker Agents (${getDiscoveredOpenCodeProjects().length})…`;
      repoSelect.appendChild(placeholder);
      for (const project of getDiscoveredOpenCodeProjects()) {
        const option = document.createElement("option");
        option.value = project.repoPath;
        option.textContent = `${project.name} — ${project.sessionCount} agent session${project.sessionCount === 1 ? "" : "s"}`;
        repoSelect.appendChild(option);
      }
      repoSelect.classList.remove("hidden");
    } else {
      repoSelect.classList.add("hidden");
    }
  }
  const chatgptSelect = document.getElementById("project-pair-chatgpt-options") as HTMLSelectElement | null;
  if (chatgptSelect) {
    chatgptSelect.replaceChildren();
    if (getDiscoveredChatGptProjects().length > 0) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = `Detected Planner Agents (${getDiscoveredChatGptProjects().length})…`;
      chatgptSelect.appendChild(placeholder);
      for (const project of getDiscoveredChatGptProjects()) {
        const option = document.createElement("option");
        option.value = project.projectSlug;
        option.textContent = `${project.projectName ?? project.projectSlug} — ${project.openTabCount} open tab${project.openTabCount === 1 ? "" : "s"}`;
        chatgptSelect.appendChild(option);
      }
      chatgptSelect.classList.remove("hidden");
    } else {
      chatgptSelect.classList.add("hidden");
    }
  }
}

async function detectOpenCodeProjects(): Promise<void> {
  const projects = await runAction(() => window.desktop.discoverOpenCodeProjects());
  if (!projects) {
    return;
  }
  setDiscoveredOpenCodeProjects(projects);

  renderProjectPairOptions();
  if (projects.length === 0) {
    toast("No Worker Agents detected. Is the agent server running?");
  }
}

async function detectChatGptProjects(): Promise<void> {
  const projects = await discoverPlannerProjects();
  if (!projects) {
    return;
  }
  setDiscoveredChatGptProjects(projects);
  renderProjectPairOptions();
  if (projects.length === 0) {
    toast("No Planner Agents detected in open tabs. Open a project conversation in the automation browser.");
  }
}

async function startOpenCodeServerForPair(): Promise<void> {
  hideProjectPairError();
  const repo = document.getElementById("project-pair-repo") as HTMLInputElement | null;
  const repoPath = repo?.value.trim() ?? "";
  if (!repoPath) {
    showProjectPairError("Enter a repository path before starting the Worker Agent.");
    return;
  }
  const result = await startWorkerManagementServer({ repoPath });
  if (!result) {
    return;
  }
  toast(result.message, "ok");
  void detectOpenCodeProjects();
}

async function startAutomationBrowserForPair(): Promise<void> {
  hideProjectPairError();
  const result = await startPlannerManagementBrowser();
  if (!result) {
    return;
  }
  toast(result.message, "ok");
  void detectChatGptProjects();
}

async function useActiveOpenCodeSession(): Promise<void> {
  const found = await runAction(() => window.desktop.scanDesktopWorkerSession());
  if (!found) {
    return;
  }
  if (!found.repoPath) {
    toast("The active desktop session has no project directory.");
    return;
  }
  const repo = document.getElementById("project-pair-repo") as HTMLInputElement | null;
  if (repo) {
    repo.value = found.repoPath;
    const name = document.getElementById("project-pair-name") as HTMLInputElement | null;
    if (name && !name.value.trim()) name.value = repoBasename(found.repoPath);
  }
  toast(`Using active desktop session in ${found.repoPath}.`, "ok");
}

async function confirmProjectPairCreation(): Promise<void> {
  const name = (document.getElementById("project-pair-name") as HTMLInputElement | null)?.value.trim() ?? "";
  const repoPath = (document.getElementById("project-pair-repo") as HTMLInputElement | null)?.value.trim() ?? "";
  const chatgpt = (document.getElementById("project-pair-chatgpt") as HTMLInputElement | null)?.value.trim() ?? "";
  hideProjectPairError();
  if (!repoPath) {
    showProjectPairError("An OpenCode repository path is required.");
    return;
  }
  if (!chatgpt) {
    showProjectPairError("A Planner project URL or project slug is required. Use Add Pair for conversation URLs.");
    return;
  }
  const input: CreateProjectPairDto = {
    ...(name ? { projectName: name } : {}),
    worker: { repoPath },
    planner: { projectSlug: chatgpt }
  };
  const result = await runAction(() => window.desktop.createProjectPair(input));
  if (!result) {
    return;
  }
  closeProjectPairModal();
  toast(`Paired ${result.worker.repoPath} ↔ ${result.planner.projectName ?? result.planner.projectSlug}.`, "ok");
  await refreshProjectPairs();
}

async function refresh(): Promise<void> {
  if (!window.desktop || typeof window.desktop.listPairs !== "function") {
    return;
  }
  try {
    const [pairs, status, automation, projectPairs] = await Promise.all([
      window.desktop.listPairs(),
      window.desktop.getStatus(),
      window.desktop.getAutomationInfo(),
      window.desktop.listProjectPairs().catch(() => [])
    ]);
    state.pairs = pairs;
    const navPairs = document.getElementById("nav-pairs-count");
    if (navPairs) {
      navPairs.textContent = String(pairs.length);
    }
    state.projectPairs = projectPairs ?? [];
    state.automation = automation;
    const statusMap = new Map<string, PeerHealthDto>();
    for (const pair of status.pairs) {
      statusMap.set(pair.pairId, pair);
    }
    state.statuses = statusMap;

    refreshProjectAssignments();
    renderProjectPairs();
    if (currentView === "pairs") {
      renderPairsPanel();
    }
    if (currentView === "home") {
      renderDashboard();
    }
    const configDisplay = document.getElementById("config-path-display");
    if (configDisplay) {
      configDisplay.textContent = window.desktop.configPath || "No config loaded";
      configDisplay.setAttribute("title", window.desktop.configPath);
    }
    const brandName = document.querySelector(".app-header .brand-name");
    if (brandName) {
      brandName.setAttribute("title", `Config: ${window.desktop.configPath}`);
    }
  } catch (error) {
    toast(errorMessage(error));
  }
}

async function startAll(): Promise<void> {
  const status = await runAction(() => window.desktop.startAll());
  if (status) {
    setStatuses(status);
    if (showWorkerOnStartPref()) {
      for (const pair of status.pairs) {
        await openWorkerSession(pair.pairId);
      }
    }
  }
  renderProjectPairs();
}

async function stopAll(): Promise<void> {
  const status = await runAction(() => window.desktop.stopAll());
  if (status) {
    setStatuses(status);
    toast("Stop All issued — relay transport blocked and Auto Resume disabled for all pairs. Termination is unverified (v1.1 §5.4).", "ok");
  }
  renderProjectPairs();
}

function wireEvents(): void {
  if (!window.desktop || typeof window.desktop.onEvent !== "function") {
    return;
  }
  window.desktop.onEvent((event) => {
    noteActivityEvent(event);
    if (event.type.startsWith("RECOVERY_") || event.type === "ESCALATED_TO_AGENT" || event.type === "STATE_CHANGED" || event.type === "PAIR_RUNTIME_RECOVERED" || event.type === "RECOVERY_CANCELLED" || event.type === "STARTING_SIDE_SELECTED" || event.type === "RECOVERY_SUSPENSION_RELEASED" || event.type === "STOP_ALL_REQUESTED") {
      void refresh();
    }
    if (currentView === "recovery" && (event.type.startsWith("RECOVERY_") || event.type === "STATE_CHANGED" || event.type === "STOP_ALL_REQUESTED" || event.type === "RECOVERY_CANCELLED" || event.type === "STARTING_SIDE_SELECTED")) {
      void refreshRecoveryPanel();
    }
    if (event.type === "PAIR_REMOVED" || event.type === "PAIR_ADDED" || event.type === "PROJECT_PAIR_ADDED" || event.type === "PROJECT_PAIR_REMOVED") {
      void refreshProjectPairs();
    }
  });
  window.desktop.onStatusRefresh(() => {
    void refresh();
    if (currentView === "recovery") {
      void refreshRecoveryPanel();
    }
  });
}

export async function openTimelineModal(pairId: string): Promise<void> {
  const modal = document.getElementById("timeline-modal");
  const content = document.getElementById("timeline-content");
  const title = document.getElementById("timeline-title");
  if (!modal || !content) return;

  if (title) title.textContent = `Timeline: ${pairId}`;
  const loading = el("div", "empty-state");
  loading.textContent = "Loading timeline…";
  content.replaceChildren(loading);
  modal.classList.remove("hidden");

  try {
    const timeline = await window.desktop.getTimeline(pairId, 100);
    if (timeline.length === 0) {
      const empty = el("div", "empty-state");
      empty.textContent = "No events recorded for this pair.";
      content.replaceChildren(empty);
      return;
    }

    const list = document.createDocumentFragment();
    for (const entry of [...timeline].reverse()) {
      const item = el("div", "history-item");
      const time = el("span", "history-time");
      time.textContent = formatTime(entry.time);
      const type = el("span", `history-type badge ${entry.type.includes("FAILED") ? "badge-danger" : "badge-neutral"}`);
      type.textContent = entry.type.replace("WORKER_", "W_").replace("PLANNER_", "P_").replace("_RELAYED", "").replace("_OBSERVED", "");
      
      const label = el("span", "history-label");
      label.textContent = entry.pairId || entry.projectPairId || "System";

      const reason = el("span", "history-reason");
      reason.textContent = entry.reason || "—";
      reason.title = entry.reason || "";
      
      item.append(time, type, label, reason);
      list.appendChild(item);
    }
    content.replaceChildren(list);
  } catch (error) {
    const fail = el("div", "result-fail");
    fail.textContent = `Failed to load timeline: ${errorMessage(error)}`;
    content.replaceChildren(fail);
  }
}

function closeTimelineModal(): void {
  document.getElementById("timeline-modal")?.classList.add("hidden");
}

function repoBasename(repoPath: string): string {
  const parts = repoPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function initPairCreateForm(): void {
  const idEl = document.getElementById("pair-create-id") as HTMLInputElement | null;
  const nameEl = document.getElementById("pair-create-name") as HTMLInputElement | null;
  const urlEl = document.getElementById("pair-create-url") as HTMLInputElement | null;
  const sessionEl = document.getElementById("pair-create-session") as HTMLInputElement | null;
  const repoEl = document.getElementById("pair-create-repo") as HTMLInputElement | null;
  const pick = document.getElementById("pair-create-folder");
  const save = document.getElementById("pair-create-save");

  nameEl?.addEventListener("input", () => {
    if (idEl) {
      idEl.value = slugify(nameEl.value);
    }
  });

  pick?.addEventListener("click", async () => {
    const result = await runAction(() => window.desktop.pickFolder());
    if (result && result.folderPath && repoEl) {
      repoEl.value = result.folderPath;
      if (nameEl && !nameEl.value.trim()) {
        nameEl.value = repoBasename(result.folderPath);
        if (idEl) idEl.value = slugify(nameEl.value);
      }
      toast(`Project folder: ${result.folderPath}`, "ok");
    }
  });

  save?.addEventListener("click", async () => {
    const url = urlEl?.value.trim() ?? "";
    const sessionId = sessionEl?.value.trim() ?? "";
    const repoPath = repoEl?.value.trim() ?? "";
    let pairId = idEl?.value.trim() ?? "";
    if (!pairId) {
      const name = nameEl?.value.trim() ?? "";
      if (name) pairId = slugify(name);
    }
    if (!pairId || !url || !sessionId) {
      toast("Pair name, ChatGPT URL, and OpenCode Session ID are required.", "error");
      return;
    }
    const parsed = await runAction(() => window.desktop.parsePlannerUrl({ url }));
    if (!parsed) return;
    const candidate = {
      pairId,
      worker: { sessionId, repoPath: repoPath || "" },
      planner: { conversationId: parsed.conversationId, conversationUrl: parsed.conversationUrl ?? url }
    } as import("../../src/contracts/desktop.js").CandidatePairDto;
    const saved = await runAction(() => window.desktop.createPair(candidate));
    if (saved) {
      toast("Session pair created.", "ok");
      idEl && (idEl.value = "");
      nameEl && (nameEl.value = "");
      urlEl && (urlEl.value = "");
      sessionEl && (sessionEl.value = "");
      repoEl && (repoEl.value = "");
      await refreshProjectPairs();
      void refresh();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initPairCreateForm();
  void wireConfigForm();
  void wireSettingsSection();
  const showWorkerOnStart = document.getElementById("show-worker-on-start") as HTMLInputElement | null;
  if (showWorkerOnStart) {
    showWorkerOnStart.checked = showWorkerOnStartPref();
    showWorkerOnStart.addEventListener("change", () => {
      setShowWorkerOnStartPref(showWorkerOnStart.checked);
    });
  }
  const themeSelect = document.getElementById("theme-preference") as HTMLSelectElement | null;
  if (themeSelect) {
    themeSelect.value = readStoredThemePreference();
    themeSelect.addEventListener("change", () => {
      const value = normalizeThemePreference(themeSelect.value);
      storeThemePreference(value);
      applyThemePreference(value);
      themeSelect.value = value;
    });
  }
  const refreshButton = document.getElementById("refresh");
  refreshButton?.addEventListener("click", () => {
    state.workerModels.clear();
    void refresh();
    void refreshProjectPairs();
  });
  document.getElementById("start-all")?.addEventListener("click", () => {
    void startAll();
  });
  document.getElementById("stop-all")?.addEventListener("click", () => {
    void stopAll();
  });
  document.getElementById("add-pair")?.addEventListener("click", () => {
    openWizard("create");
  });
  document.getElementById("expand-all")?.addEventListener("click", () => {
    expandAllPairs();
  });
  document.getElementById("collapse-all")?.addEventListener("click", () => {
    collapseAllPairs();
  });
  document.getElementById("wizard-close")?.addEventListener("click", () => {
    closeWizard();
  });
  document.getElementById("wizard-cancel")?.addEventListener("click", () => {
    closeWizard();
  });
  document.getElementById("worker-session-close")?.addEventListener("click", closeWorkerSessionModal);
  document.getElementById("worker-session-cancel")?.addEventListener("click", closeWorkerSessionModal);
  document.getElementById("worker-session-confirm")?.addEventListener("click", () => {
    void confirmWorkerSessionCreation();
  });
  document.getElementById("add-project-pair")?.addEventListener("click", () => {
    openProjectPairModal();
  });
  document.getElementById("project-pair-close")?.addEventListener("click", closeProjectPairModal);
  document.getElementById("project-pair-cancel")?.addEventListener("click", closeProjectPairModal);
  document.getElementById("project-pair-modal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeProjectPairModal();
    }
  });
  document.getElementById("project-pair-modal")?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProjectPairModal();
    } else if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
      event.preventDefault();
      void confirmProjectPairCreation();
    }
  });
  document.getElementById("project-pair-create")?.addEventListener("click", () => {
    void confirmProjectPairCreation();
  });
  document.getElementById("timeline-close")?.addEventListener("click", closeTimelineModal);
  document.getElementById("timeline-done")?.addEventListener("click", closeTimelineModal);
  document.getElementById("project-pair-repo-detect")?.addEventListener("click", () => {
    void detectOpenCodeProjects();
  });
  document.getElementById("project-pair-repo-browse")?.addEventListener("click", () => {
    void (async () => {
      const result = await runAction(() => window.desktop.pickFolder());
      const repo = document.getElementById("project-pair-repo") as HTMLInputElement | null;
      if (result?.folderPath && repo) {
        repo.value = result.folderPath;
        const name = document.getElementById("project-pair-name") as HTMLInputElement | null;
        if (name && !name.value.trim()) name.value = repoBasename(result.folderPath);
        repo.focus();
      }
    })();
  });
  document.getElementById("project-pair-opencode-connect")?.addEventListener("click", () => {
    void (async () => {
      const result = await runAction(() => window.desktop.configureOpenCodeCredentials());
      if (!result?.saved) return;
      toast(`OpenCode credentials saved securely for ${result.username}.`, "ok");
      await detectOpenCodeProjects();
    })();
  });
  document.getElementById("project-pair-repo-start-server")?.addEventListener("click", () => {
    void startOpenCodeServerForPair();
  });
  document.getElementById("project-pair-repo-active")?.addEventListener("click", () => {
    void useActiveOpenCodeSession();
  });
  document.getElementById("sidebar-search-input")?.addEventListener("input", () => {
    renderSidebarProjects();
  });
  document.getElementById("clear-history")?.addEventListener("click", () => {
    void (async () => {
      await window.desktop.clearTimeline();
      toast("Transport history cleared.");
      renderDashboard();
    })();
  });
  document.getElementById("clear-errors")?.addEventListener("click", () => {
    void (async () => {
      await window.desktop.clearTimeline();
      toast("Error log cleared.");
      renderDashboard();
    })();
  });
  document.getElementById("refresh-projects")?.addEventListener("click", () => {
    void refreshProjectPairs();
  });
  document.getElementById("project-pair-chatgpt-detect")?.addEventListener("click", () => {
    void detectChatGptProjects();
  });
  document.getElementById("project-pair-chatgpt-start-browser")?.addEventListener("click", () => {
    void startAutomationBrowserForPair();
  });
  document.getElementById("project-pair-repo-options")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (!value) {
      return;
    }
    const repo = document.getElementById("project-pair-repo") as HTMLInputElement | null;
    if (repo) {
      repo.value = value;
      const name = document.getElementById("project-pair-name") as HTMLInputElement | null;
      if (name && !name.value.trim()) name.value = repoBasename(value);
    }
  });
  document.getElementById("project-pair-chatgpt-options")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (!value) {
      return;
    }
    const input = document.getElementById("project-pair-chatgpt") as HTMLInputElement | null;
    if (input) {
      input.value = value;
    }
  });
  document.getElementById("dashboard-add-project")?.addEventListener("click", () => {
    openProjectPairModal();
  });
  document.getElementById("wizard-back")?.addEventListener("click", () => {
    if (wizardStepIndex > 0) {
      setWizardStepIndex(wizardStepIndex - 1);
      renderWizard();
    }
  });
  document.getElementById("wizard-next")?.addEventListener("click", () => {
    if (!wizard) {
      return;
    }
    const steps = wizardSteps(wizard.kind);
    if (wizardStepIndex < steps.length - 1) {
      setWizardStepIndex(wizardStepIndex + 1);
      renderWizard();
    } else if (wizard.kind === "rebind") {
      void doRebind();
    } else {
      void doSave();
    }
  });

  const navHome = document.getElementById("nav-home");
  const navAllSessions = document.getElementById("nav-all-sessions");

  navHome?.addEventListener("click", () => {
    setView("home");
  });

  navAllSessions?.addEventListener("click", () => {
    const container = document.getElementById("sidebar-projects-list");
    container?.querySelectorAll(".sidebar-project-item").forEach((el) => el.classList.remove("active-project"));
    setView("sessions");
  });

  document.getElementById("nav-pairs")?.addEventListener("click", () => {
    setView("pairs");
  });

  document.getElementById("nav-activity")?.addEventListener("click", () => {
    document.getElementById("sidebar-projects-list")
      ?.querySelectorAll(".sidebar-project-item")
      .forEach((el) => el.classList.remove("active-project"));
    setView("activity");
  });
  document.getElementById("nav-recovery")?.addEventListener("click", () => setView("recovery"));
  ["models", "modules", "logs", "config", "devices", "health", "developer", "setup"].forEach((v) => {
    document.getElementById(`nav-${v}`)?.addEventListener("click", () => setView(v as ViewMode));
  });
  document.getElementById("nav-source")?.addEventListener("click", () => setView("source"));
  document.getElementById("projects-go-pairs")?.addEventListener("click", () => setView("pairs"));

  const sidebarToggle = document.getElementById("sidebar-toggle");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  sidebarToggle?.addEventListener("click", toggleMobileSidebar);
  sidebarBackdrop?.addEventListener("click", closeMobileSidebar);

  const sidebarFold = document.getElementById("sidebar-fold");
  sidebarFold?.addEventListener("click", () => {
    const workspace = document.querySelector(".app-workspace");
    if (!workspace) return;
    workspace.classList.toggle("sidebar-collapsed");
    const collapsed = workspace.classList.contains("sidebar-collapsed");
    sidebarFold.textContent = collapsed ? "»" : "«";
    try { localStorage.setItem("agent.sidebarCollapsed", collapsed ? "1" : "0"); } catch { /* ignore */ }
  });
  // Restore collapsed state.
  try {
    if (localStorage.getItem("agent.sidebarCollapsed") === "1") {
      document.querySelector(".app-workspace")?.classList.add("sidebar-collapsed");
      const btn = document.getElementById("sidebar-fold");
      if (btn) btn.textContent = "»";
    }
  } catch { /* ignore */ }

  const addPairBtn = document.getElementById("add-pair");
  const addProjectPairBtn = document.getElementById("add-project-pair");
  addPairBtn?.addEventListener("click", closeMobileSidebar);
  addProjectPairBtn?.addEventListener("click", closeMobileSidebar);

  setView("home");
  document.getElementById("logs-refresh")?.addEventListener("click", () => {
    void openLogsView();
  });

  installAgentRefreshTimer();
  wireActivityView();
  initRecoveryPanel();
  initDatabasePanel();
  void initPermissionsCard();
  document.getElementById("ground-truth-refresh")?.addEventListener("click", () => { void refreshGroundTruth(); });
  wireEvents();
  initGlobalFocusTrap();
  void refresh();
  void refreshProjectPairs();
});

// Boot: wire wizard-aware runAction and the worker-session view seams.
setRunActionHook({
  handle: (error) => {
    if (wizard && isValidError(error)) {
      const details = (error as { details?: Record<string, unknown> }).details;
      const fallbackCommand = details?.fallbackCommand;
      if (typeof fallbackCommand === "string" && fallbackCommand.trim()) {
        wizard.manualCommand = {
          command: fallbackCommand,
          verify: currentWizardStep() === "planner" ? "planner" : "worker"
        };
        renderWizard();
      }
    }
  }
});

setWorkerSessionDispatch({
  rerender: () => renderProjectPairs(),
  refreshAll: async () => {
    await refresh();
  }
});

// Boot: wire the pair-card view hooks into renderer-owned entry points.
setPairCardHooks({
  rerender: () => {
    renderProjectPairs();
    if (currentView === "pairs") {
      renderPairsPanel();
    }
  },
  refreshAll: () => refresh(),
  openWizard: (kind, pairId) => openWizard(kind, pairId),
  removePair: (pairId) => removePair(pairId),
  openTimeline: (pairId) => openTimelineModal(pairId)
});

setWizardHooks({
  refresh: () => refresh()
});

async function updateBackendHealthStatus(): Promise<void> {
  if (!window.desktop || typeof window.desktop.getOpenCodeEndpoint !== "function") {
    return;
  }
  const opencodeStatusEl = document.getElementById("backend-opencode-status");
  const opencodeDetailEl = document.getElementById("backend-opencode-detail");
  const chatgptStatusEl = document.getElementById("backend-chatgpt-status");
  const chatgptDetailEl = document.getElementById("backend-chatgpt-detail");

  try {
    const opencodeEndpoint = await window.desktop.getOpenCodeEndpoint();
    if (opencodeDetailEl) opencodeDetailEl.textContent = `Endpoint: ${opencodeEndpoint}`;
    const opencodeTest = await window.desktop.testWorkerEndpoint({ baseUrl: opencodeEndpoint });
    if (opencodeStatusEl) {
      opencodeStatusEl.textContent = opencodeTest.ok ? "ONLINE" : "OFFLINE";
      opencodeStatusEl.className = `badge ${opencodeTest.ok ? "badge-ok" : "badge-danger"}`;
    }
  } catch {
    if (opencodeStatusEl) {
      opencodeStatusEl.textContent = "OFFLINE";
      opencodeStatusEl.className = "badge badge-danger";
    }
  }

  try {
    const chatgptEndpoint = await window.desktop.getChatGptEndpoint();
    if (chatgptDetailEl) chatgptDetailEl.textContent = `CDP Endpoint: ${chatgptEndpoint}`;
    const chatgptTest = await window.desktop.testPlannerEndpoint({ cdpUrl: chatgptEndpoint });
    if (chatgptStatusEl) {
      chatgptStatusEl.textContent = chatgptTest.ok ? "ONLINE" : "OFFLINE";
      chatgptStatusEl.className = `badge ${chatgptTest.ok ? "badge-ok" : "badge-danger"}`;
    }
  } catch {
    if (chatgptStatusEl) {
      chatgptStatusEl.textContent = "OFFLINE";
      chatgptStatusEl.className = "badge badge-danger";
    }
  }
}

const logsEmpty = (message: string): HTMLElement => {
  const node = el("div", "logs-empty");
  node.textContent = message;
  return node;
};

async function openLogsView(): Promise<void> {
  const list = document.getElementById("logs-list");
  const viewer = document.getElementById("logs-viewer");
  if (!list) return;
  list.replaceChildren(logsEmpty("Loading logs…"));
  const files = await runAction(() => window.desktop.listLogs());
  if (!files) {
    list.replaceChildren(logsEmpty("Could not list logs/."));
    return;
  }
  if (files.length === 0) {
    list.replaceChildren(logsEmpty("No .ndjson logs under logs/ yet."));
    if (viewer) viewer.textContent = "Nothing to show.";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const button = el("button", "logs-file");
    button.type = "button";
    button.textContent = `${file.name}  ·  ${formatBytes(file.size)}`;
    button.title = `${file.name} — modified ${new Date(file.modifiedAt).toLocaleString()}`;
    button.addEventListener("click", () => {
      list.querySelectorAll(".logs-file.active").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      void loadLogFile(file.id);
    });
    fragment.appendChild(button);
  }
  list.replaceChildren(fragment);
  const first = list.querySelector<HTMLButtonElement>(".logs-file");
  first?.click();
}

async function loadLogFile(id: string): Promise<void> {
  const viewer = document.getElementById("logs-viewer");
  if (!viewer) return;
  viewer.textContent = "Loading…";
  const data = await runAction(() => window.desktop.readLogFile(id));
  if (!data) return;
  const body = data.lines.length > 0 ? data.lines.join("\n") : "(empty file)";
  viewer.textContent = data.truncated
    ? `— showing last portion of ${id} — \n${body}`
    : body;
  viewer.scrollTop = viewer.scrollHeight;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("backend-test-opencode")?.addEventListener("click", async () => {
    const res = await runAction(() => window.desktop.testWorkerEndpoint());
    if (res) toast(res.message, res.ok ? "ok" : "error");
    void updateBackendHealthStatus();
  });
  document.getElementById("backend-start-opencode")?.addEventListener("click", async () => {
    const repoPath = state.pairs[0]?.worker.repoPath || "/tmp";
    const res = await runAction(() => window.desktop.startWorkerServer({ repoPath }));
    if (res) toast(res.message, res.ok ? "ok" : "error");
    void updateBackendHealthStatus();
  });
  document.getElementById("backend-update-opencode")?.addEventListener("click", async () => {
    const res = await runAction(() => window.desktop.updateOpenCode());
    if (res) toast(res.message, res.ok ? "ok" : "error");
    void updateBackendHealthStatus();
  });
  document.getElementById("backend-test-chatgpt")?.addEventListener("click", async () => {
    const res = await runAction(() => window.desktop.testPlannerEndpoint());
    if (res) toast(res.message, res.ok ? "ok" : "error");
    void updateBackendHealthStatus();
  });
  document.getElementById("backend-start-chatgpt")?.addEventListener("click", async () => {
    const res = await runAction(() => window.desktop.startPlannerBrowser());
    if (res) toast(res.message, res.ok ? "ok" : "error");
    void updateBackendHealthStatus();
  });
});

interface DuplicationOccurrence { path: string; start: number; end: number }
interface DuplicationGroup { id: string; lines: number; occurrenceCount: number; occurrences: DuplicationOccurrence[]; duplicatedLines: number; cloneCount: number }
interface DuplicationReport {
  status: "ok" | "failed";
  generatedAt?: string;
  minLines?: number;
  scannedSources?: number;
  totalScannedLines?: number;
  reportedDuplicatedLines?: number;
  duplicatedLines?: number;
  duplicatedLinePercentage?: number;
  totalOccurrences?: number;
  groupCount?: number;
  groups?: DuplicationGroup[];
  error?: string;
}

interface CodeIndexSymbol { name: string; kind: string; line?: number; signature?: string }
interface CodeIndexModule { path: string; dir: string; category: string; purpose?: string; hasHeader?: boolean; symbolCount?: number; symbols?: CodeIndexSymbol[] }

interface CodeIndex {
  totals?: { modules?: number; symbols?: number; modulesMissingHeader?: number };
  categories?: Array<{ category: string; modules: number }>;
  modules?: CodeIndexModule[];
}
let cachedCodeIndex: CodeIndex | null = null;

type SourceView = "modules" | "symbols" | "missing-headers" | "duplicates";
let sourceView: SourceView = "modules";
const SOURCE_VIEW_TITLES: Record<SourceView, string> = {
  modules: "Module browser",
  symbols: "Symbol index",
  "missing-headers": "Missing headers",
  duplicates: "Duplicate code blocks"
};

function setSourceView(view: SourceView): void {
  sourceView = view;
  document.getElementById("source-modules")?.classList.toggle("hidden", view !== "modules");
  document.getElementById("source-symbols")?.classList.toggle("hidden", view !== "symbols");
  document.getElementById("source-missing-headers")?.classList.toggle("hidden", view !== "missing-headers");
  document.getElementById("duplicate-section")?.classList.toggle("hidden", view !== "duplicates");
  document.querySelectorAll<HTMLElement>(".source-kpi").forEach((el) => {
    const active = el.dataset.view === view;
    el.classList.toggle("active", active);
    el.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const title = document.getElementById("source-view-title");
  if (title) title.textContent = SOURCE_VIEW_TITLES[view];
  document.getElementById("source-back-to-modules")?.classList.toggle("hidden", view === "modules");
  document.querySelector(".source-search-wrap")?.classList.toggle("hidden", view === "duplicates");
}

async function loadAndRenderSourceIndex(): Promise<void> {
  const list = document.getElementById("source-list");
  const totals = document.getElementById("source-totals");
  const search = document.getElementById("source-search") as HTMLInputElement | null;
  const duplicateSection = document.getElementById("duplicate-section");
  const duplicateStatus = document.getElementById("duplicate-status");
  const duplicateGroups = document.getElementById("duplicate-groups");
  const duplicateHint = document.getElementById("duplicate-hint");
  const duplicateRescan = document.getElementById("duplicate-rescan");
  if (!list || !totals) return;
  setSourceView(sourceView);
  const backBtn = document.getElementById("source-back-to-modules");
  if (backBtn && !backBtn.dataset.wired) {
    backBtn.addEventListener("click", () => setSourceView("modules"));
    backBtn.dataset.wired = "1";
  }

  const renderDuplicationState = async (state: { status: "ok" | "not-scanned" | "failed"; report?: DuplicationReport; error?: string; generatedAt?: string | null }): Promise<void> => {
    if (!duplicateStatus || !duplicateGroups || !duplicateHint) return;
    duplicateSection?.classList.remove("scanning", "failed", "ok", "not-scanned");
    duplicateSection?.classList.add(state.status);
    if (state.status === "failed") {
      duplicateStatus.textContent = `Duplicate analysis failed: ${state.error ?? "unknown error"} — rescan to retry.`;
      duplicateStatus.className = "duplicate-status failed";
      duplicateGroups.innerHTML = "";
      return;
    }
    if (state.status === "not-scanned") {
      duplicateStatus.textContent = "Not scanned yet — run `npm run index:code` or click Rescan.";
      duplicateStatus.className = "duplicate-status not-scanned";
      duplicateGroups.innerHTML = "";
      return;
    }
    const report = state.report;
    if (!report) {
      duplicateStatus.textContent = "Duplicate report unavailable.";
      duplicateStatus.className = "duplicate-status failed";
      duplicateGroups.innerHTML = "";
      return;
    }
    const groupCount = report.groupCount ?? 0;
    const percentage = report.duplicatedLinePercentage ?? 0;
    const totalLines = report.totalScannedLines ?? 0;
    const minLines = report.minLines ?? 10;
    duplicateStatus.textContent = `${groupCount} distinct duplicate group${groupCount === 1 ? "" : "s"} — ${report.duplicatedLines ?? 0} duplicated lines of ${totalLines} (${percentage}%) — min block ${minLines} lines, scanned ${report.scannedSources ?? "?"} files.`;
    duplicateStatus.className = "duplicate-status ok";
    duplicateHint.textContent = `Cached ${report.generatedAt ? new Date(report.generatedAt).toLocaleString() : "recently"}. Click a group to see file paths and line ranges.`;
    const groups = report.groups ?? [];
    duplicateGroups.innerHTML = groups
      .map((g, index) => `<div class="duplicate-group" data-index="${index}">
        <div class="duplicate-group-header">
          <span class="duplicate-group-title">Group ${index + 1} · ${escapeHtmlC(g.id)}</span>
          <span class="duplicate-group-meta"><span>${g.lines} lines × ${g.occurrenceCount} occurrences</span><span><span class="duplicate-arrow">▶</span></span><span>${g.duplicatedLines} dup. lines</span></span>
        </div>
        <div class="duplicate-group-body">
          <div class="duplicate-occurrences">${g.occurrenceCount} occurrences of one ${g.lines}-line block</div>
          ${g.occurrences.map((o) => `<div class="duplicate-file"><span>${escapeHtmlC(o.path)}</span><span>L${o.start}–L${o.end}</span></div>`).join("")}
        </div>
      </div>`)
      .join("");
  };

  const renderDuplicationFromCache = async (): Promise<void> => {
    if (!window.desktop || typeof window.desktop.getDuplicateReport !== "function") {
      if (duplicateStatus) {
        duplicateStatus.textContent = "Duplicate analysis unavailable in this build.";
        duplicateStatus.className = "duplicate-status not-scanned";
      }
      return;
    }
    const state = await window.desktop.getDuplicateReport();
    await renderDuplicationState(state as Parameters<typeof renderDuplicationState>[0]);
  };

  const pollDuplicationRefresh = async (previousGeneratedAt: string | null): Promise<void> => {
    if (!window.desktop || typeof window.desktop.getDuplicateReport !== "function") return;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const state = await window.desktop.getDuplicateReport();
      const generatedAt = (state.report as DuplicationReport | undefined)?.generatedAt ?? null;
      if (generatedAt !== previousGeneratedAt && state.status === "ok") {
        await renderDuplicationState(state as Parameters<typeof renderDuplicationState>[0]);
        return;
      }
      if (state.status === "failed") {
        await renderDuplicationState(state as Parameters<typeof renderDuplicationState>[0]);
        return;
      }
    }
    if (duplicateStatus) {
      duplicateStatus.textContent = "Scan is taking longer than expected — refresh the page to see results.";
      duplicateStatus.className = "duplicate-status not-scanned";
    }
  };

  if (duplicateRescan) {
    duplicateRescan.addEventListener("click", async () => {
      if (!window.desktop || typeof window.desktop.scanDuplicates !== "function") {
        if (duplicateStatus) {
          duplicateStatus.textContent = "Duplicate analysis unavailable in this build.";
          duplicateStatus.className = "duplicate-status not-scanned";
        }
        return;
      }
      let previousGeneratedAt: string | null = null;
      try {
        const current = await window.desktop.getDuplicateReport();
        previousGeneratedAt = (current.report as DuplicationReport | undefined)?.generatedAt ?? null;
      } catch {
        previousGeneratedAt = null;
      }
      if (duplicateStatus) {
        duplicateStatus.textContent = "Scanning for duplicate blocks…";
        duplicateStatus.className = "duplicate-status scanning";
      }
      const started = await window.desktop.scanDuplicates(10);
      if (!started.started) {
        if (duplicateStatus) {
          duplicateStatus.textContent = `Failed to start duplicate scan: ${started.error ?? "unknown error"}`;
          duplicateStatus.className = "duplicate-status failed";
        }
        return;
      }
      const previous = previousGeneratedAt;
      void pollDuplicationRefresh(previous);
    });
  }

  if (!duplicateGroups?.dataset.wired) {
    duplicateGroups?.addEventListener("click", (event) => {
      const header = (event.target as HTMLElement).closest(".duplicate-group-header");
      if (!header) return;
      header.parentElement?.classList.toggle("open");
    });
    if (duplicateGroups) duplicateGroups.dataset.wired = "1";
  }

  try {
    if (!cachedCodeIndex) {
      if (!window.desktop || typeof window.desktop.getCodeIndex !== "function") {
        list.innerHTML = "<div class='empty-state'>Source index unavailable — run <code>npm run index:code</code> and restart.</div>";
        return;
      }
      cachedCodeIndex = (await window.desktop.getCodeIndex()) as CodeIndex;
    }
    const modules = cachedCodeIndex?.modules ?? [];
    const totalsValue = cachedCodeIndex?.totals ?? {};
    const dupState = !window.desktop || typeof window.desktop.getDuplicateReport !== "function"
      ? { status: "not-scanned" as const }
      : await window.desktop.getDuplicateReport();
    const duplicateValue = dupState.status === "ok" && dupState.report
      ? String((dupState.report as DuplicationReport).groupCount ?? 0)
      : "—";
    const duplicateLabel = "Duplicate Blocks";
    const duplicateOk = dupState.status === "ok" && (dupState.report as DuplicationReport | undefined)?.groupCount === 0;
    const tiles: Array<{ label: string; value: string; ok?: boolean; view: SourceView }> = [
      { label: "Modules", value: String(totalsValue.modules ?? modules.length), view: "modules" },
      { label: "Symbols", value: String(totalsValue.symbols ?? modules.reduce((sum, m) => sum + (m.symbolCount ?? 0), 0)), view: "symbols" },
      { label: "Missing headers", value: String(totalsValue.modulesMissingHeader ?? 0), view: "missing-headers" },
      { label: duplicateLabel, value: duplicateValue, ok: duplicateOk, view: "duplicates" }
    ];
    totals.innerHTML = tiles
      .map(({ label, value, ok, view }) => `<button type="button" class="source-stat source-kpi${ok ? " duplicate-kpi-tile ok" : ""}${view === sourceView ? " active" : ""}" data-view="${view}" aria-pressed="${view === sourceView ? "true" : "false"}"><div class="source-stat-value">${value}</div><div class="source-stat-label">${escapeHtmlC(label)}</div></button>`)
      .join("");
    if (!totals.dataset.wired) {
      totals.addEventListener("click", (event) => {
        const tile = (event.target as HTMLElement).closest(".source-kpi") as HTMLElement | null;
        if (!tile) return;
        const view = tile.dataset.view as SourceView | undefined;
        if (view) setSourceView(view);
      });
      totals.dataset.wired = "1";
    }

    await renderDuplicationState(dupState as Parameters<typeof renderDuplicationState>[0]);

    const categories = new Map<string, CodeIndexModule[]>();
    for (const mod of modules) {
      const list2 = categories.get(mod.category) ?? [];
      list2.push(mod);
      categories.set(mod.category, list2);
    }
    const sortedCategories = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const renderModule = (mod: CodeIndexModule): string => {
      const symbols = (mod.symbols ?? [])
        .map((s) => `<span class="source-symbol" data-kind="${escapeHtmlC(s.kind)}" title="${escapeHtmlC(s.signature ?? s.name)}"><b>${escapeHtmlC(s.name)}</b></span>`)
        .join("");
      return `<div class="source-module"><div class="source-module-path">${escapeHtmlC(mod.path)}</div><div class="source-module-purpose">${escapeHtmlC(mod.purpose ?? "")}</div><div class="source-symbols">${symbols}</div></div>`;
    };

    const renderList = (query: string): void => {
      const q = query.trim().toLowerCase();
      const filtered = q
        ? sortedCategories
            .map(([category, listForCategory]) => {
              const matching = listForCategory.filter((mod) => {
                if (mod.path.toLowerCase().includes(q)) return true;
                if ((mod.purpose ?? "").toLowerCase().includes(q)) return true;
                return (mod.symbols ?? []).some((s) => s.name.toLowerCase().includes(q));
              });
              return [category, matching] as [string, CodeIndexModule[]];
            })
            .filter(([, listForCategory]) => listForCategory.length > 0)
        : sortedCategories;

      const openClass = q ? " open" : "";
      list.innerHTML = filtered
        .map(
          ([category, listForCategory]) => `<div class="source-category${openClass}" data-category="${escapeHtmlC(category)}">
            <div class="source-category-header">
              <span class="source-category-title">${escapeHtmlC(category)}</span>
              <span><span class="source-count">${listForCategory.length} modules</span> <span class="source-arrow">▶</span></span>
            </div>
            <div class="source-modules">${listForCategory.map(renderModule).join("")}</div>
          </div>`
        )
        .join("");
    };

    const symbolsList = document.getElementById("symbols-list");
    const allSymbols: Array<{ name: string; kind: string; line?: number; signature?: string; path: string }> = [];
    for (const mod of modules) {
      for (const s of mod.symbols ?? []) {
        allSymbols.push({ name: s.name, kind: s.kind, line: s.line, signature: s.signature, path: mod.path });
      }
    }
    allSymbols.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
    const SYMBOLS_RENDER_LIMIT = 800;
    const renderSymbols = (query: string): void => {
      if (!symbolsList) return;
      const q = query.trim().toLowerCase();
      const filtered = q
        ? allSymbols.filter((s) =>
            s.name.toLowerCase().includes(q) ||
            (s.signature ?? "").toLowerCase().includes(q) ||
            s.path.toLowerCase().includes(q) ||
            s.kind.toLowerCase().includes(q)
          )
        : allSymbols;
      if (filtered.length === 0) {
        symbolsList.innerHTML = `<div class="empty-state">${q ? "No symbols match your search." : "No symbols indexed."}</div>`;
        return;
      }
      const shown = filtered.slice(0, SYMBOLS_RENDER_LIMIT);
      const rows = shown
        .map((s) => `<div class="symbol-row" title="${escapeHtmlC(s.signature ?? s.name)}"><span class="symbol-row-name"><b>${escapeHtmlC(s.name)}</b></span><span class="symbol-row-kind">${escapeHtmlC(s.kind)}</span><span class="symbol-row-path">${escapeHtmlC(s.path)}${s.line ? `:${s.line}` : ""}</span></div>`)
        .join("");
      const more = filtered.length > shown.length
        ? `<div class="symbols-more">Showing first ${shown.length} of ${filtered.length} symbols — refine your search to narrow results.</div>`
        : "";
      symbolsList.innerHTML = rows + more;
    };

    const missingList = document.getElementById("missing-headers-list");
    const missingModules = modules.filter((m) => m.hasHeader === false);
    const renderMissingHeaders = (query: string): void => {
      if (!missingList) return;
      const q = query.trim().toLowerCase();
      const filtered = q
        ? missingModules.filter((m) =>
            m.path.toLowerCase().includes(q) ||
            (m.purpose ?? "").toLowerCase().includes(q) ||
            (m.category ?? "").toLowerCase().includes(q)
          )
        : missingModules;
      if (filtered.length === 0) {
        missingList.innerHTML = `<div class="empty-state">${q ? "No missing-header modules match your search." : "All modules have header comments. 🎉"}</div>`;
        return;
      }
      missingList.innerHTML = `<div class="missing-headers-summary">${filtered.length} module${filtered.length === 1 ? "" : "s"} missing a header comment</div>` +
        filtered
          .map((m) => `<div class="missing-header-row"><div class="missing-header-path">${escapeHtmlC(m.path)}</div><div class="missing-header-meta"><span class="missing-header-category">${escapeHtmlC(m.category)}</span>${m.purpose ? `<span class="missing-header-purpose">${escapeHtmlC(m.purpose)}</span>` : ""}</div></div>`)
          .join("");
    };

    const applySearch = (query: string): void => {
      renderList(query);
      renderSymbols(query);
      renderMissingHeaders(query);
    };
    applySearch(search?.value ?? "");
    search?.addEventListener("input", () => applySearch(search.value));
    setSourceView(sourceView);

    if (!list.dataset.wired) {
      list.addEventListener("click", (event) => {
        const header = (event.target as HTMLElement).closest(".source-category-header");
        if (!header) return;
        header.parentElement?.classList.toggle("open");
      });
      list.dataset.wired = "1";
    }
    if (!search) { /* no search */ }
  } catch (error) {
    list.innerHTML = `<div class="empty-state">Failed to load source index: ${error instanceof Error ? escapeHtmlC(error.message) : String(error)}</div>`;
  }
}

function escapeHtmlC(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
