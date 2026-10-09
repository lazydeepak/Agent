import type { PairIdentityDto, PairStartPriming, ValidationResultDto } from "../../src/contracts/desktop.js";
import {
  actionButton,
  buildCard,
  buildDangerZone,
  buildExpandableToggle,
  buildIdentityBlock,
  el,
  formatTime,
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
}

let hooks: PairCardHooks = {
  rerender: () => undefined,
  refreshAll: async () => undefined,
  openWizard: () => undefined,
  removePair: () => undefined,
  openTimeline: () => undefined,
  isOpenWorkerOnStart: undefined
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
  } else {
    badges.push({ cssClass: "badge-neutral", text: "STOPPED" });
  }
  if (card.paused) {
    badges.push({ cssClass: "badge-paused", text: "PAUSED" });
  }
  return badges;
}

function renderPairCard(card: PairCardModel, pair: PairIdentityDto): HTMLElement {
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
  body.push(bridge);

  const compact = el("div", "pair-card-compact");
  const activity = el("span", "pair-activity");
  activity.textContent = `Last active ${card.lastObservedAt ? formatTime(card.lastObservedAt) : "—"}`;
  compact.appendChild(activity);

  const actions = el("div", "pair-actions");
  if (controls.canStart) {
    actions.appendChild(
      actionButton("Start Relay", "btn-sm btn-primary", true, () => startPair(card.pairId, selectedStartPriming(card.pairId, card.hasRelayHistory)))
    );
  }
  if (controls.canResume) {
    actions.appendChild(actionButton("Start Relay", "btn-sm btn-primary", true, () => resumePair(card.pairId)));
  }
  if (controls.canPause) {
    actions.appendChild(actionButton("Stop Relay", "btn-sm", true, () => pausePair(card.pairId)));
  }
  if (controls.canStop) {
    actions.appendChild(actionButton("Stop Relay", "btn-sm btn-danger", true, () => stopPair(card.pairId)));
  }
  actions.appendChild(actionButton("Open Worker Agent", "btn-sm", true, () => openWorkerSession(card.pairId)));
  compact.appendChild(actions);
  body.push(compact);

  if (expanded) {
    body.push(renderPairDetails(card, pair, controls, card.runtimeState !== "STOPPED" && card.runtimeState !== "ERROR"));
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
  return hasRelayHistory ? undefined : "from-planner";
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

export async function resumePair(pairId: string): Promise<void> {
  const status = await runAction(() => window.desktop.resumePair(pairId));
  if (status) setStatuses(status);
  hooks.rerender();
}

export async function initializePair(pairId: string): Promise<void> {
  const result = await runAction(() => window.desktop.initializePair(pairId));
  if (result) {
    toast(`Initialization completed: ${result.status}`);
  }
  hooks.refreshAll();
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
  const workerStatus = el("span", `badge badge-sm ${card.workerStatus === "HEALTHY" ? "badge-ok" : "badge-danger"}`);
  workerStatus.textContent = card.workerStatus;
  const workerActivity = el("span", "health-activity");
  workerActivity.textContent = card.workerActivity ? `(${card.workerActivity})` : "";
  workerRow.append(workerLabel, workerStatus, workerActivity);

  const plannerRow = el("div", "health-row");
  const plannerLabel = el("span", "health-label");
  plannerLabel.textContent = "Planner Agent:";
  const plannerStatus = el("span", `badge badge-sm ${card.plannerStatus === "HEALTHY" ? "badge-ok" : "badge-danger"}`);
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

