import type {
  ArchivedPairSummaryDto,
  CandidatePairDto,
  AutomationInfoDto,
  ChatGptProjectDto,
  CreateProjectPairDto,
  EndpointTestResultDto,
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
import { runAction, setRunActionHook, type RunActionErrorHook } from "./actions.js";
import { launchPlannerForPair } from "./planner.js";
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
  normalizeThemePreference,
  readStoredThemePreference,
  storeThemePreference
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
      getPairStatus(pairId: string): Promise<PeerHealthDto>;
      getPairDetail(pairId: string): Promise<PairIdentityDto | undefined>;
      pausePair(pairId: string): Promise<StatusSummaryDto>;
      resumePair(pairId: string): Promise<StatusSummaryDto>;
      startPair(pairId: string, priming?: PairStartPriming): Promise<StatusSummaryDto>;
      stopPair(pairId: string): Promise<StatusSummaryDto>;
      startAll(): Promise<StatusSummaryDto>;
      stopAll(): Promise<StatusSummaryDto>;
      validatePair(pairId: string): Promise<ValidationResultDto>;
      getValidation(pairId: string): Promise<ValidationResultDto | undefined>;
      getRecentEvents(filter?: { pairId?: string; limit?: number }): Promise<EventRecordDto[]>;
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
      getWorkerProgress(pairId: string, forceRefresh?: boolean): Promise<import("../shared/worker-progress.js").WorkerProgressDto>;
      getTimeline(pairId?: string, limit?: number): Promise<Array<{ time: string; pairId?: string; projectPairId?: string; type: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> }>>;
      startProject(projectPairId: string): Promise<StatusSummaryDto>;
      resumeProject(projectPairId: string): Promise<StatusSummaryDto>;
      pauseProject(projectPairId: string): Promise<StatusSummaryDto>;
      listProjectPairs(): Promise<ProjectPairDto[]>;
      createProjectPair(input: CreateProjectPairDto): Promise<ProjectPairDto>;
      removeProjectPair(projectPairId: string): Promise<{ projectPairId: string }>;
      discoverOpenCodeProjects(): Promise<OpenCodeProjectDto[]>;
      discoverChatGptProjects(input?: { cdpUrl?: string }): Promise<ChatGptProjectDto[]>;
      listArchive(): Promise<ArchivedPairSummaryDto[]>;
      deleteArchive(ref: string): Promise<{ ref: string }>;
      copyText(text: string): Promise<{ copied: boolean }>;
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

const SHOW_WORKER_ON_START_KEY = "agent-relay.showWorkerOnStart";

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
  const select = document.getElementById("theme-select") as HTMLSelectElement | null;
  const stored = readStoredThemePreference();
  applyThemePreference(stored);
  if (select) {
    select.value = stored;
    select.addEventListener("change", () => {
      const preference = normalizeThemePreference(select.value);
      applyThemePreference(preference);
      storeThemePreference(preference);
    });
  }
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

type ViewMode = "sessions" | "home";
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

export function setView(view: ViewMode): void {
  currentView = view;
  closeMobileSidebar();
  const navHome = document.getElementById("nav-home");
  const navAllSessions = document.getElementById("nav-all-sessions");
  const dashboardPanel = document.getElementById("dashboard-panel");
  const projectPairsPanel = document.getElementById("project-pairs-panel");
  const projectsPanelHeader = document.getElementById("projects-panel-header");
  const projectPairsList = document.getElementById("project-pairs-list");
  const noProjectPairs = document.getElementById("no-project-pairs");
  const layout = document.querySelector(".layout");

  navHome?.classList.toggle("active", view === "home");
  navAllSessions?.classList.toggle("active", view === "sessions");

  if (view === "home") {
    layout?.classList.remove("view-sessions");
    layout?.classList.add("view-home");
    dashboardPanel?.classList.remove("hidden");
    projectPairsPanel?.classList.add("hidden");
    renderDashboard();
  } else {
    layout?.classList.remove("view-home");
    layout?.classList.add("view-sessions");
    dashboardPanel?.classList.add("hidden");
    projectPairsPanel?.classList.remove("hidden");
    projectPairsPanel?.classList.add("panel-full-width");
    projectsPanelHeader?.classList.remove("hidden");
    projectPairsList?.classList.remove("hidden");
    const hasContent = state.projectPairs.length > 0 || state.pairs.length > 0;
    noProjectPairs?.classList.toggle("hidden", hasContent);
  }
}

function renderDashboard(): void {
  const running = document.getElementById("stat-running");
  const healthy = document.getElementById("stat-healthy");
  const failed = document.getElementById("stat-failed");
  const total = document.getElementById("stat-total");
  const historyContainer = document.getElementById("dashboard-history");
  const gettingStarted = document.getElementById("dashboard-getting-started");

  const statuses = Array.from(state.statuses.values());
  const runningCount = statuses.filter(s => s.runtimeState === "RUNNING" || s.runtimeState === "STARTING").length;
  const healthyCount = statuses.filter(s => s.runtimeState === "RUNNING" && s.supervisorState !== "FAILED" && s.supervisorState !== "STUCK").length;
  const failedCount = statuses.filter(s => s.runtimeState === "ERROR" || s.supervisorState === "FAILED" || s.supervisorState === "STUCK").length;
  const totalCount = state.pairs.length;

  if (running) running.textContent = String(runningCount);
  if (healthy) healthy.textContent = String(healthyCount);
  if (failed) failed.textContent = String(failedCount);
  if (total) total.textContent = String(totalCount);

  if (gettingStarted) {
    gettingStarted.classList.toggle("hidden", state.projectPairs.length > 0);
  }

  if (historyContainer) {
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
  if (navProjectsCount) {
    navProjectsCount.textContent = String(state.projectPairs.length);
  }
  updateStartAllButton();
  const fragment = document.createDocumentFragment();
  for (const pair of state.projectPairs) {
    fragment.appendChild(renderProjectPairCard(pair));
  }
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
  const projects = state.projectPairs.filter(p => p.projectPairId.toLowerCase().includes(query));

  if (projects.length === 0) {
    const empty = el("div", "sidebar-empty-hint");
    empty.textContent = query ? "No matches" : "No projects";
    fragment.appendChild(empty);
  } else {
    for (const project of projects) {
      const btn = el("button", "sidebar-project-item");
      btn.dataset.projectPairId = project.projectPairId;
      const presence = projectPairPresence(project);
      const dotClass = presence === "active" ? "dot-ok" : presence === "partial" ? "dot-warn" : "dot-dim";
      const dot = el("span", `sidebar-project-status-dot ${dotClass}`);
      const icon = el("span", "sidebar-project-icon");
      icon.textContent = "📁";
      const name = el("span", "sidebar-project-name");
      name.textContent = project.projectPairId;
      name.title = project.projectPairId;
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
      titleChildren: [(() => { const t = el("span", "pair-id"); t.textContent = "Unassigned"; return t; })()],
      badges: [{ cssClass: "badge-neutral", text: `${unassigned.length} session${unassigned.length === 1 ? "" : "s"}` }],
      toggleLabel: "Details"
    },
    body: [sessionList]
  });
}

function renderProjectPairCard(pair: ProjectPairDto): HTMLElement {
  const expanded = expandedProjectPairs.has(pair.projectPairId);
  const presence = projectPairPresence(pair);

  const body: HTMLElement[] = [];
  if (expanded) {
    body.push(renderProjectPairDetails(pair));
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
  titleSpan.textContent = pair.projectPairId;

  const sessions = state.pairs.filter(
    (session) => state.sessionProject.get(session.pairId) === pair.projectPairId
  );
  if (sessions.length > 0) {
    const head = el("div", "detail");
    head.textContent = `Sessions (${sessions.length})`;
    body.push(head);
    const sessionList = el("div", "project-session-list");
    for (const session of sessions) {
      appendPairCard(sessionList, session);
    }
    body.push(sessionList);
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
  if (hasEligiblePair) {
    projectActions.appendChild(actionButton("Start Relay", "btn-sm btn-primary", true, () => {
      void (async () => {
        const status = await runAction(async () => window.desktop.startProject?.(pair.projectPairId));
        if (status) setStatuses(status);
        renderProjectPairs();
      })();
    }));
  }
  if (hasActivePair) {
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

  const projectConfigActions = el("div", "pair-actions-row");
  projectConfigActions.style.marginTop = "12px";
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
  workerHead.textContent = "Worker Agent project";
  details.appendChild(workerHead);
  details.appendChild(buildIdentityBlock([
    { label: "Folder", value: pair.worker.repoPath },
    { label: "Agent ID", value: pair.worker.projectId ?? "—" }
  ]));

  const sessions = snapshot?.openCodeSessions ?? [];
  const sessionHead = el("div", "detail");
  sessionHead.textContent = snapshot ? `Sessions (${sessions.length})` : "Sessions (unknown — Worker Agent unreachable)";
  details.appendChild(sessionHead);
  if (snapshot && sessions.length === 0) {
    const none = el("div", "detail");
    none.textContent = "No open sessions for this agent.";
    details.appendChild(none);
  }
  for (const session of sessions) {
    const sessionTitle = (session.title ?? "").trim() || "Untitled session";
    details.appendChild(identityRow(sessionTitle, session.sessionId));
  }

  const plannerHead = el("div", "detail");
  plannerHead.textContent = "Planner Agent project";
  details.appendChild(plannerHead);
  details.appendChild(buildIdentityBlock([
    { label: "Name", value: pair.planner.projectName ?? "—" },
    { label: "Slug", value: pair.planner.projectSlug }
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
  const projects = await runAction(() => window.desktop.discoverChatGptProjects());
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
  const result = await runAction(() => window.desktop.startWorkerServer({ repoPath }));
  if (!result) {
    return;
  }
  toast(result.message, "ok");
  void detectOpenCodeProjects();
}

async function startAutomationBrowserForPair(): Promise<void> {
  hideProjectPairError();
  const result = await runAction(() => window.desktop.startPlannerBrowser());
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
    showProjectPairError("A ChatGPT project slug or project conversation URL is required.");
    return;
  }
  const input: CreateProjectPairDto = {
    ...(name ? { projectPairId: name } : {}),
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
  try {
    const [pairs, status, automation] = await Promise.all([
      window.desktop.listPairs(),
      window.desktop.getStatus(),
      window.desktop.getAutomationInfo()
    ]);
    state.pairs = pairs;
    state.automation = automation;
    const statusMap = new Map<string, PeerHealthDto>();
    for (const pair of status.pairs) {
      statusMap.set(pair.pairId, pair);
    }
    state.statuses = statusMap;

    refreshProjectAssignments();
    renderProjectPairs();
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
  }
  renderProjectPairs();
}

function wireEvents(): void {
  window.desktop.onEvent((event) => {
    if (event.type.startsWith("RECOVERY_") || event.type === "STATE_CHANGED" || event.type === "PAIR_RUNTIME_RECOVERED") {
      void refresh();
    }
    if (event.type === "PAIR_REMOVED" || event.type === "PAIR_ADDED" || event.type === "PROJECT_PAIR_ADDED" || event.type === "PROJECT_PAIR_REMOVED") {
      void refreshProjectPairs();
    }
  });
  window.desktop.onStatusRefresh(() => {
    void refresh();
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

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  const showWorkerOnStart = document.getElementById("show-worker-on-start") as HTMLInputElement | null;
  if (showWorkerOnStart) {
    showWorkerOnStart.checked = showWorkerOnStartPref();
    showWorkerOnStart.addEventListener("change", () => {
      setShowWorkerOnStartPref(showWorkerOnStart.checked);
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
  document.getElementById("project-pair-create")?.addEventListener("click", () => {
    void confirmProjectPairCreation();
  });
  document.getElementById("timeline-close")?.addEventListener("click", closeTimelineModal);
  document.getElementById("timeline-done")?.addEventListener("click", closeTimelineModal);
  document.getElementById("project-pair-repo-detect")?.addEventListener("click", () => {
    void detectOpenCodeProjects();
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
      if (!window.confirm("Clear all transport history? This cannot be undone.")) return;
      await window.desktop.clearTimeline();
      renderDashboard();
    })();
  });
  document.getElementById("clear-errors")?.addEventListener("click", () => {
    void (async () => {
      if (!window.confirm("Clear error log? This cannot be undone.")) return;
      await window.desktop.clearTimeline(); // Reuse clearTimeline for now as it clears the whole log
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

  const sidebarToggle = document.getElementById("sidebar-toggle");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  sidebarToggle?.addEventListener("click", toggleMobileSidebar);
  sidebarBackdrop?.addEventListener("click", closeMobileSidebar);

  const addPairBtn = document.getElementById("add-pair");
  const addProjectPairBtn = document.getElementById("add-project-pair");
  addPairBtn?.addEventListener("click", closeMobileSidebar);
  addProjectPairBtn?.addEventListener("click", closeMobileSidebar);

  setView("home");

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
  rerender: () => renderProjectPairs(),
  refreshAll: () => refresh(),
  openWizard: (kind, pairId) => openWizard(kind, pairId),
  removePair: (pairId) => removePair(pairId),
  openTimeline: (pairId) => openTimelineModal(pairId)
});

setWizardHooks({
  refresh: () => refresh()
});
