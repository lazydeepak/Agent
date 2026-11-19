import type { PairIdentityDto, PairStartPriming, ValidationResultDto } from "../../src/contracts/desktop.js";
import {
  actionButton,
  buildCard,
  buildDangerZone,
  buildExpandableToggle,
  buildIdentityBlock,
  el,
  formatDurationMs,
  formatTime,
  healthBadgeClass,
  toast
} from "./dom.js";
import {
  controlsFor,
  stateDotClass,
  toPairCard,
  type PairCardModel,
  type PairControls
} from "./state.js";
import { setStatuses, state } from "./view-state.js";

let autoResumeSnapshot: Map<string, boolean> | null = null;
let autoResumeSyncPending: Promise<void> | null = null;

/** Fetch the per-pair auto-resume preference (Rule 15) and reflect it on every toggle in the DOM. */
async function syncAutoResumeToggles(): Promise<void> {
  if (!window.desktop || typeof window.desktop.getAutoResumeState !== "function") return;
  try {
    const rows = await window.desktop.getAutoResumeState();
    autoResumeSnapshot = new Map(rows.map((row) => [row.pairId, row.autoResumeAfterRestart]));
    for (const button of document.querySelectorAll<HTMLButtonElement>(".auto-resume-toggle[data-pair-id]")) {
      const pairId = button.dataset.pairId;
      if (pairId) {
        const enabled = autoResumeSnapshot.get(pairId) ?? false;
        button.setAttribute("aria-pressed", String(enabled));
        button.classList.toggle("is-on", enabled);
        const text = button.querySelector<HTMLElement>(".auto-resume-toggle-text");
        if (text) text.textContent = `Auto Resume ${enabled ? "On" : "Off"}`;
      }
    }
  } catch {
    // Leave toggles unchecked rather than fabricate operator intent.
  }
}

function scheduleSync(): void {
  if (autoResumeSyncPending) return;
  autoResumeSyncPending = syncAutoResumeToggles().finally(() => {
    autoResumeSyncPending = null;
  });
}
import { createWorkerSessionForPair, openWorkerSession, alignWorkerSessionWithOpenCodeDesktop, renderWorkerModelControl } from "./worker-session.js";
import { runAction } from "./actions.js";
import { launchPlannerForPair } from "./planner.js";

/** Entry points owned by the renderer that pair cards need. Wired once at boot. */
export interface PairCardHooks {
  rerender(): void;
  refreshAll(): Promise<void>;
  openWizard(kind: "edit" | "rebind", pairId: string): void;
  removePair(pairId: string): void;
  openTimeline(pairId: string): void;
  isOpenWorkerOnStart?(): boolean;
  /** Initialize flow with browser auto-launch; renderer-owned so pair-card stays transport-agnostic. */
  initializePair(pairId: string): Promise<unknown>;
}

let hooks: PairCardHooks = {
  rerender: () => undefined,
  refreshAll: async () => undefined,
  openWizard: () => undefined,
  removePair: () => undefined,
  openTimeline: () => undefined,
  isOpenWorkerOnStart: undefined,
  initializePair: async (pairId) => {
    const result = await runAction(() => window.desktop.initializePair(pairId));
    if (result) {
      toast(`Initialization completed: ${result.status}`);
    }
    await hooks.refreshAll();
  }
};

export function setPairCardHooks(h: PairCardHooks): void {
  hooks = h;
}

/** Expanded state for session-pair cards, shared with the pair list. */
export const expandedPairs = new Set<string>();

const startPrimingChoice = new Map<string, PairStartPriming | "resume">();

export function appendPairCard(parent: Node, pair: PairIdentityDto): void {
  const status = state.statuses.get(pair.pairId);
  const card = toPairCard(pair, status);
  parent.appendChild(renderPairCard(card, pair));
}

function pairCardBadges(card: PairCardModel): Array<{ cssClass: string; text: string }> {
  const badges: Array<{ cssClass: string; text: string }> = [];
  if (card.runtimeState === "RUNNING") {
    badges.push({ cssClass: "badge-ok", text: "ACTIVE" });
  } else if (card.paused) {
    badges.push({ cssClass: "badge-paused", text: "PAUSED" });
  } else {
    badges.push({ cssClass: "badge-neutral", text: "STOPPED" });
  }
  return badges;
}

function renderPairCard(card: PairCardModel, pair: PairIdentityDto): HTMLElement {
  const status = state.statuses.get(pair.pairId);
  const expanded = expandedPairs.has(card.pairId);
  const controls = controlsFor(card.runtimeState, card.paused, card.enabled);

  const dot = el("span", `state-dot ${stateDotClass(card.runtimeState, card.paused)}`);
  const idSpan = el("span", "pair-id");
  idSpan.textContent = card.pairId;

  const body: HTMLElement[] = [];

  const bridge = el("div", "relay-bridge");

  const workerEndpoint = el("div", "bridge-endpoint");
  const workerRole = el("span", "bridge-role");
  workerRole.textContent = "Worker Agent";
  const workerRepo = el("span", "bridge-path");
  workerRepo.textContent = card.repoPath ? (card.repoPath.split("/").slice(-2).join("/") || card.repoPath) : "No repo";
  workerRepo.title = card.repoPath ?? "";
  const workerId = el("span", "bridge-id");
  workerId.textContent = card.workerSessionId ? card.workerSessionId : "No session";
  workerEndpoint.append(workerRole, workerRepo, workerId);

  const connector = el("div", "bridge-connector");
  const arrow = el("span", "bridge-arrow");
  arrow.textContent = "⇄";
  arrow.title = "Bidirectional relay bridge";
  connector.appendChild(arrow);

  const plannerEndpoint = el("div", "bridge-endpoint");
  const plannerRole = el("span", "bridge-role");
  plannerRole.textContent = "Planner Agent";
  const plannerConv = el("span", "bridge-path");
  plannerConv.textContent = card.conversationId ? `conv_${card.conversationId.slice(0, 12)}` : "Planner Agent";
  plannerConv.title = card.conversationUrl ?? "";
  const plannerType = el("span", "bridge-id");
  plannerType.textContent = pair.planner?.browser?.cdpUrl ? "CDP Attached" : "Chat Web";
  plannerEndpoint.append(plannerRole, plannerConv, plannerType);

  bridge.append(workerEndpoint, connector, plannerEndpoint);
  // v1.1 §7.3–7.4 — both peers busy with pending work and no starting side selected: offer the operator the choice.
  if (status?.awaitingStartingSideSelection) {
    const selectPanel = el("div", "starting-side-panel");
    const selectLabel = el("span", "starting-side-label");
    selectLabel.textContent = "Both peers are busy — pick which side relays first (v1.1 §7.3):";
    const plannerFirst = actionButton("Planner first", "btn-sm btn-primary", true, () => selectStartingSide(card.pairId, "planner"));
    plannerFirst.title = "The Planner's pending instruction is relayed to the Worker before any Worker report is forwarded.";
    const workerFirst = actionButton("Worker first", "btn-sm btn-primary", true, () => selectStartingSide(card.pairId, "worker"));
    workerFirst.title = "The Worker's pending report is forwarded to the Planner before any Planner instruction is dispatched.";
    selectPanel.append(selectLabel, plannerFirst, workerFirst);
    body.push(selectPanel);
  } else if (status?.startingSide) {
    const selected = el("div", "starting-side-panel starting-side-selected");
    const text = el("span", "starting-side-label");
    text.textContent = `Starting side: ${status.startingSide === "planner" ? "Planner first" : "Worker first"} (clears after first admission)`;
    selected.appendChild(text);
    body.push(selected);
  }

  const compact = el("div", "pair-card-compact");
  const activity = el("span", "pair-activity");
  const activeRuntimeMs = card.lastRuntimeStartAt && card.runtimeState !== "STOPPED" && card.runtimeState !== "ERROR"
    ? Math.max(0, Date.now() - Date.parse(card.lastRuntimeStartAt))
    : 0;
  const totalRuntime = formatDurationMs(card.cumulativeRuntimeMs + (Number.isFinite(activeRuntimeMs) ? activeRuntimeMs : 0));
  activity.textContent = [
    `Last active ${card.lastObservedAt ? formatTime(card.lastObservedAt) : "—"}`,
    `Last turn ${card.latestCycleStatus ?? "—"}`,
    `Total work ${totalRuntime}`
  ].join(" · ");
  compact.appendChild(activity);

  const actions = el("div", "pair-actions");
  // Always render all four action buttons (Start/Stop/Pause/Resume) so the operator
  // sees the full control surface regardless of state. Disabled buttons are inert.
  actions.appendChild(
    actionButton("Start", "btn-sm btn-primary", controls.canStart, () => startPair(card.pairId, selectedStartPriming(card.pairId, card.hasRelayHistory)))
  );
  actions.appendChild(
    actionButton("Resume", "btn-sm btn-primary", controls.canResume, () => resumePair(card.pairId))
  );
  actions.appendChild(
    actionButton("Pause", "btn-sm", controls.canPause, () => pausePair(card.pairId))
  );
  actions.appendChild(
    actionButton("Stop", "btn-sm btn-danger", controls.canStop, () => stopPair(card.pairId))
  );
  actions.appendChild(actionButton("Open Worker Agent", "btn-sm", true, () => openWorkerSession(card.pairId)));
  // Initialize also appears in compact mode for the dashboard.
  const notRunning = card.runtimeState !== "RUNNING" && card.runtimeState !== "STARTING";
  actions.appendChild(actionButton("Initialize", "btn-sm", notRunning, () => initializePair(card.pairId)));
  compact.appendChild(actions);
  const autoResumeButton = el("button", "btn btn-sm auto-resume-toggle") as HTMLButtonElement;
  autoResumeButton.type = "button";
  autoResumeButton.dataset.pairId = card.pairId;
  autoResumeButton.title = "Resume this pair automatically after an engine/computer restart (Rule 15). Default: off. An Emergency Stop always takes precedence.";
  const autoResumeEnabled = autoResumeSnapshot?.get(card.pairId) ?? false;
  autoResumeButton.setAttribute("aria-pressed", String(autoResumeEnabled));
  autoResumeButton.classList.toggle("is-on", autoResumeEnabled);
  const autoResumeSwitch = el("span", "auto-resume-switch");
  autoResumeSwitch.setAttribute("aria-hidden", "true");
  const autoResumeText = el("span", "auto-resume-toggle-text");
  autoResumeText.textContent = `Auto Resume ${autoResumeEnabled ? "On" : "Off"}`;
  autoResumeButton.append(autoResumeSwitch, autoResumeText);
  autoResumeButton.addEventListener("click", () => {
    const enabled = autoResumeButton.getAttribute("aria-pressed") !== "true";
    autoResumeButton.disabled = true;
    void (async () => {
      if (typeof window.desktop?.setAutoResumeAfterRestart !== "function") return;
      try {
        await window.desktop.setAutoResumeAfterRestart(card.pairId, enabled);
        autoResumeSnapshot?.set(card.pairId, enabled);
        for (const button of document.querySelectorAll<HTMLButtonElement>(`.auto-resume-toggle[data-pair-id="${CSS.escape(card.pairId)}"]`)) {
          button.setAttribute("aria-pressed", String(enabled));
          button.classList.toggle("is-on", enabled);
          const text = button.querySelector<HTMLElement>(".auto-resume-toggle-text");
          if (text) text.textContent = `Auto Resume ${enabled ? "On" : "Off"}`;
        }
        toast(enabled ? "Auto-resume after restart enabled for this pair." : "Auto-resume after restart disabled for this pair.", "ok");
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error");
      } finally {
        autoResumeButton.disabled = false;
      }
    })();
  });
  actions.appendChild(autoResumeButton);
  body.push(compact);
  scheduleSync();

  if (expanded) {
    const details = renderPairDetails(card, pair, controls, card.runtimeState !== "STOPPED" && card.runtimeState !== "ERROR");
    details.insertBefore(bridge, details.firstChild);
    body.push(details);
  }

  return buildCard({
    wrapperClass: "pair-card",
    datasetKey: "pairId",
    datasetValue: card.pairId,
    expanded,
    header: {
      wrapperClass: "pair-card-header",
      id: card.pairId,
      titleClass: "pair-card-title",
      titleChildren: [dot, idSpan],
      badges: pairCardBadges(card),
      toggleLabel: "Details",
      onToggle: buildExpandableToggle(card.pairId, expanded, expandedPairs, () => hooks.rerender())
    },
    body
  });
}

function renderPairDetails(
  card: PairCardModel,
  pair: PairIdentityDto,
  controls: PairControls,
  running: boolean
): HTMLElement {
  const details = el("div", "pair-card-details");

  details.appendChild(buildIdentityBlock([
    { label: "Worker Agent session", value: card.workerSessionId },
    { label: "Repo", value: card.repoPath },
    { label: "Planner Agent conv", value: card.conversationId },
    { label: "Conversation URL", value: card.conversationUrl }
  ]));

  details.appendChild(renderHealthStatus(card, running));

  details.appendChild(renderWorkerModelControl(card, running));

  const configActions = el("div", "pair-actions-row");
  configActions.appendChild(
    actionButton("Launch Planner Agent", "btn-sm", true, () => launchPlannerForPair(card.pairId, card.cdpEndpoint))
  );
  configActions.appendChild(
    actionButton("View Timeline", "btn-sm", true, () => hooks.openTimeline(card.pairId))
  );
  configActions.appendChild(
    actionButton("Sync Worker Agent Desktop", "btn-sm", !running, () => alignWorkerSessionWithOpenCodeDesktop(card.pairId))
  );
  configActions.appendChild(
    actionButton("Initialize", "btn-sm", !running, () => initializePair(card.pairId))
  );
  configActions.appendChild(
    actionButton("Rebind Worker Agent", "btn-sm", !running, () => hooks.openWizard("rebind", card.pairId))
  );
  configActions.appendChild(
    actionButton("New Worker Agent Session", "btn-sm", !running, () => createWorkerSessionForPair(card.pairId))
  );
  configActions.appendChild(
    actionButton("Edit", "btn-sm", !running, () => hooks.openWizard("edit", card.pairId))
  );
  details.appendChild(configActions);

  details.appendChild(buildDangerZone([{
    label: "Remove",
    enabled: !running,
    onClick: () => {
      if (!window.confirm(`Remove pair ${card.pairId}? This cannot be undone.`)) return;
      hooks.removePair(card.pairId);
    }
  }]));

  if (card.lastError) {
    const err = el("div", "detail");
    err.textContent = `Error: ${card.lastError}`;
    details.appendChild(err);
  }

  return details;
}

function selectedStartPriming(pairId: string, hasRelayHistory: boolean): PairStartPriming | undefined {
  if (state.automation?.mode !== "relay") {
    return undefined;
  }
  // v1.1 §7.5 — pairs with relay history resume via direct continuation only when the
  // durable ledger shows no uncertainty; otherwise a checkpoint briefing is sent.
  return hasRelayHistory ? "resume" : "from-planner";
}

export async function startPair(pairId: string, priming?: PairStartPriming): Promise<void> {
  const status = await runAction(() => window.desktop.startPair(pairId, priming));
  if (status) {
    setStatuses(status);
  }
  hooks.rerender();
}

export async function stopPair(pairId: string): Promise<void> {
  const status = await runAction(() => window.desktop.stopPair(pairId));
  if (status) setStatuses(status);
  hooks.rerender();
}

export async function pausePair(pairId: string): Promise<void> {
  const status = await runAction(() => window.desktop.pausePair(pairId));
  if (status) setStatuses(status);
  hooks.rerender();
}

export async function selectStartingSide(pairId: string, side: "planner" | "worker"): Promise<void> {
  if (typeof window.desktop?.selectStartingSide !== "function") {
    toast("Desktop bridge is not available.", "error");
    return;
  }
  try {
    await window.desktop.selectStartingSide(pairId, side);
    toast(`Starting side set to ${side}; the selected side will relay first.`, "ok");
    await refreshAllSafe();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

async function refreshAllSafe(): Promise<void> {
  try {
    await hooks.refreshAll();
  } catch {
    // Refresh is best-effort after the selection is durably recorded.
  }
}

export async function resumePair(pairId: string): Promise<void> {
  const status = await runAction(() => window.desktop.resumePair(pairId));
  if (status) setStatuses(status);
  hooks.rerender();
}

export async function initializePair(pairId: string): Promise<void> {
  await hooks.initializePair(pairId);
}

function renderHealthStatus(card: PairCardModel, running: boolean): HTMLElement {
  const container = el("div", "health-status-block");
  const header = el("div", "sidebar-title");
  header.textContent = "Agent Health";
  container.appendChild(header);

  const grid = el("div", "health-grid");

  const workerRow = el("div", "health-row");
  const workerLabel = el("span", "health-label");
  workerLabel.textContent = "Worker Agent:";
  const workerStatus = el("span", `badge badge-sm ${healthBadgeClass(card.workerStatus)}`);
  workerStatus.textContent = card.workerStatus;
  const workerActivity = el("span", "health-activity");
  workerActivity.textContent = card.workerActivity ? `(${card.workerActivity})` : "";
  workerRow.append(workerLabel, workerStatus, workerActivity);

  const plannerRow = el("div", "health-row");
  const plannerLabel = el("span", "health-label");
  plannerLabel.textContent = "Planner Agent:";
  const plannerStatus = el("span", `badge badge-sm ${healthBadgeClass(card.plannerStatus)}`);
  plannerStatus.textContent = card.plannerStatus;
  const plannerActivity = el("span", "health-activity");
  plannerActivity.textContent = card.plannerActivity ? `(${card.plannerActivity})` : "";
  plannerRow.append(plannerLabel, plannerStatus, plannerActivity);

  grid.append(workerRow, plannerRow);
  container.appendChild(grid);

  if (card.recovering) {
    const recoveryMsg = el("div", "detail recovery-info");
    recoveryMsg.textContent = "⚠ Agent is currently in recovery mode (reconnecting/retrying).";
    container.appendChild(recoveryMsg);
  }

  return container;
}
