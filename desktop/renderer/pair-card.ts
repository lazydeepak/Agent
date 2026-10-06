import type { PairIdentityDto, PairStartPriming } from "../shared/dto.js";
import {
  actionButton,
  buildCard,
  buildDangerZone,
  buildExpandableToggle,
  buildIdentityBlock,
  el,
  toast
} from "./dom.js";
import {
  controlsFor,
  peerBadgeClass,
  supervisorBadgeClass,
  stateDotClass,
  toPairCard,
  type PairCardModel,
  type PairControls
} from "./state.js";
import { formatTime, renderValidation, humanizePeer } from "./events.js";
import { setStatuses, state } from "./view-state.js";
import { showProgressModal } from "./progress-view.js";
import { createWorkerSessionForPair, openWorkerSession, viewWorkerTranscript, alignWorkerSessionWithOpenCodeDesktop, renderWorkerModelControl } from "./worker-session.js";
import { showWorkerQuestions } from "./worker-questions.js";
import { runAction } from "./actions.js";
import { launchPlannerForPair } from "./planner.js";

/** Entry points owned by the renderer that pair cards need. Wired once at boot. */
export interface PairCardHooks {
  rerender(): void;
  refreshAll(): Promise<void>;
  openWizard(kind: "edit" | "rebind", pairId: string): void;
  removePair(pairId: string): void;
  isOpenWorkerOnStart?(): boolean;
}

let hooks: PairCardHooks = {
  rerender: () => undefined,
  refreshAll: async () => undefined,
  openWizard: () => undefined,
  removePair: () => undefined,
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
  const validation = state.validations.get(pair.pairId);
  const card = toPairCard(pair, status, validation);
  parent.appendChild(renderPairCard(card, pair));
}

function pairCardBadges(card: PairCardModel): Array<{ cssClass: string; text: string }> {
  const badges: Array<{ cssClass: string; text: string }> = [];
  badges.push({
    cssClass: "badge-neutral",
    text: card.paused ? "PAUSED" : card.runtimeState === "RUNNING" && card.schedulerMode === "DORMANT_WATCH" ? "ARMED" : card.runtimeState
  });
  if (card.localAgentMode) {
    badges.push({ cssClass: "badge-local", text: "LOCAL AGENT" });
  }
  if (card.supervisorState) {
    badges.push({ cssClass: supervisorBadgeClass(card.supervisorState), text: card.supervisorState });
  }
  badges.push({
    cssClass: peerBadgeClass(card.worker, card.worker === "failed" && card.recovering),
    text: humanizePeer("Worker", card.worker, card.workerActivity, card.worker === "failed" && card.recovering, card.workerFailureReason)
  });
  badges.push({
    cssClass: peerBadgeClass(card.planner, card.planner === "failed" && card.recovering),
    text: humanizePeer("ChatGPT", card.planner, card.plannerActivity, card.planner === "failed" && card.recovering, card.plannerFailureReason)
  });
  return badges;
}

function renderPairCard(card: PairCardModel, pair: PairIdentityDto): HTMLElement {
  const expanded = expandedPairs.has(card.pairId);
  const running = card.runtimeState === "RUNNING" || card.runtimeState === "STARTING" || card.runtimeState === "STOPPING" || card.runtimeState === "PAUSED";
  const controls = controlsFor(card.runtimeState, card.paused, card.enabled);
  const seeded = pair.planner.automation?.promptVersion === state.automation?.universalPromptVersion;

  const dot = el("span", `state-dot ${stateDotClass(card.runtimeState, card.paused)}`);
  const idSpan = el("span", "pair-id");
  idSpan.textContent = card.pairId;

  const body: HTMLElement[] = [];

  const bridge = el("div", "relay-bridge");

  const workerEndpoint = el("div", "bridge-endpoint");
  const workerRole = el("span", "bridge-role");
  workerRole.textContent = "Worker";
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
  plannerRole.textContent = "Planner";
  const plannerConv = el("span", "bridge-path");
  plannerConv.textContent = card.conversationId ? `conv_${card.conversationId.slice(0, 12)}` : "ChatGPT";
  plannerConv.title = card.conversationUrl ?? "";
  const plannerType = el("span", "bridge-id");
  plannerType.textContent = pair.planner?.browser?.cdpUrl ? "CDP Attached" : "ChatGPT Web";
  plannerEndpoint.append(plannerRole, plannerConv, plannerType);

  bridge.append(workerEndpoint, connector, plannerEndpoint);
  body.push(bridge);

  const compact = el("div", "pair-card-compact");
  const activity = el("span", "pair-activity");
  activity.textContent = `Last activity ${card.lastObservedAt ? formatTime(card.lastObservedAt) : "—"}`;
  compact.appendChild(activity);

  const actions = el("div", "pair-actions");
  if (controls.canStart) {
    actions.appendChild(
      actionButton(state.automation?.mode === "relay" ? "Start relay" : "Start", "btn-sm btn-primary", true, () => startPair(card.pairId, selectedStartPriming(card.pairId, card.hasRelayHistory)))
    );
  }
  if (controls.canResume) {
    actions.appendChild(actionButton("Resume", "btn-sm btn-primary", true, () => resumePair(card.pairId)));
  }
  if (controls.canPause) {
    actions.appendChild(actionButton("Pause", "btn-sm", true, () => pausePair(card.pairId)));
  }
  if (controls.canStop) {
    actions.appendChild(actionButton("Stop", "btn-sm btn-danger", true, () => stopPair(card.pairId)));
  }
  actions.appendChild(actionButton("View Progress", "btn-sm btn-primary-soft", true, () => showProgressModal(card.pairId)));
  actions.appendChild(actionButton("Open worker session", "btn-sm", true, () => openWorkerSession(card.pairId)));
  actions.appendChild(actionButton("View transcript", "btn-sm btn-ghost", true, () => viewWorkerTranscript(card.pairId)));
  actions.appendChild(actionButton("Answer worker question", "btn-sm btn-ghost", true, () => showWorkerQuestions(card.pairId)));
  compact.appendChild(actions);
  body.push(compact);

  if (expanded) {
    body.push(renderPairDetails(card, pair, controls, running, seeded));
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
  running: boolean,
  seeded: boolean
): HTMLElement {
  const details = el("div", "pair-card-details");

  details.appendChild(buildIdentityBlock([
    { label: "OpenCode session", value: card.workerSessionId },
    { label: "Repo", value: card.repoPath },
    { label: "ChatGPT conv", value: card.conversationId },
    { label: "Conversation URL", value: card.conversationUrl },
    { label: "OpenCode endpoint", value: card.openCodeEndpoint ?? "—" },
    { label: "CDP endpoint", value: card.cdpEndpoint ?? "—" }
  ]));

  if (state.automation?.mode === "relay" && !running) {
    const primingRow = el("div", "pair-priming");
    const primingLabel = el("span", "priming-label");
    primingLabel.textContent = "Start by:";
    primingRow.appendChild(primingLabel);
    const selected = selectedStartPriming(card.pairId, card.hasRelayHistory);
    primingRow.appendChild(primingRadio(card.pairId, "resume", "Resume", selected === undefined, true));
    primingRow.appendChild(primingRadio(card.pairId, "from-worker", "OpenCode first", selected === "from-worker", true));
    primingRow.appendChild(primingRadio(card.pairId, "from-planner", "ChatGPT first", selected === "from-planner", true));
    primingRow.appendChild(primingRadio(card.pairId, "from-trigger", "Trigger prompt", selected === "from-trigger", true));
    details.appendChild(primingRow);
  }

  details.appendChild(renderWorkerModelControl(card, running));

  const configActions = el("div", "pair-actions-row");
  configActions.appendChild(actionButton("Validate", "btn-sm", controls.canValidate, () => validatePair(card.pairId)));
  configActions.appendChild(
    actionButton("Launch Chrome", "btn-sm", true, () => launchPlannerForPair(card.pairId, card.cdpEndpoint))
  );
  configActions.appendChild(
    actionButton(seeded ? "Resend kickoff prompt" : "Send kickoff prompt", "btn-sm", !running, () => seedPlanner(card.pairId))
  );
  configActions.appendChild(
    actionButton(
      card.localAgentMode ? "Resend local agent prompt" : "Send local agent prompt",
      "btn-sm",
      !running,
      () => feedLocalAgent(card.pairId)
    )
  );
  configActions.appendChild(
    actionButton("Sync OpenCode Desktop", "btn-sm", !running, () => alignWorkerSessionWithOpenCodeDesktop(card.pairId))
  );
  configActions.appendChild(
    actionButton("Rebind Worker", "btn-sm", !running, () => hooks.openWizard("rebind", card.pairId))
  );
  configActions.appendChild(
    actionButton("New Worker Session", "btn-sm", !running, () => createWorkerSessionForPair(card.pairId))
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

  if (state.automation?.mode === "relay" && !seeded) {
    const note = el("div", "step-readiness result-fail");
    note.textContent = "The first Start Relay sends the latest ChatGPT prompt to the worker. Later starts resume the existing relay state.";
    details.appendChild(note);
  }

  if (card.validation) {
    details.appendChild(renderValidation(card.validation));
  }

  return details;
}

function selectedStartPriming(pairId: string, hasRelayHistory: boolean): PairStartPriming | undefined {
  if (state.automation?.mode !== "relay") {
    return undefined;
  }
  const stored = startPrimingChoice.get(pairId) ?? (hasRelayHistory ? "resume" : "from-planner");
  return stored === "resume" ? undefined : stored;
}

function primingRadio(pairId: string, value: PairStartPriming | "resume", label: string, checked: boolean, enabled: boolean): HTMLElement {
  const wrap = el("label", "priming-choice");
  const input = document.createElement("input");
  input.type = "radio";
  input.name = `start-priming-${pairId}`;
  input.value = value;
  input.checked = checked;
  input.disabled = !enabled;
  input.addEventListener("change", () => {
    if (input.checked) {
      startPrimingChoice.set(pairId, value);
    }
  });
  wrap.appendChild(input);
  const text = el("span");
  text.textContent = label;
  wrap.appendChild(text);
  return wrap;
}

export async function seedPlanner(pairId: string): Promise<void> {
  const promptVersion = state.automation?.universalPromptVersion ?? "current";
  const confirmed = window.confirm(
    `Send universal planner prompt v${promptVersion} to ChatGPT for ${pairId}? This posts a new message to the paired conversation.`
  );
  if (!confirmed) return;
  const result = await runAction(() => window.desktop.seedPlanner(pairId));
  if (result) {
    toast(`Planner seeded with universal prompt v${result.promptVersion}. Start the pair in relay mode.`, "ok");
    await hooks.refreshAll();
  }
}

export async function feedLocalAgent(pairId: string): Promise<void> {
  const confirmed = window.confirm(
    `Feed the local-agent planner prompt to ChatGPT for ${pairId}? This marks the session as local-agent mode and posts a new message to the paired conversation.`
  );
  if (!confirmed) return;
  const result = await runAction(() => window.desktop.feedLocalAgent(pairId));
  if (result) {
    toast(`Local agent prompt v${result.promptVersion} fed; ${pairId} is now local-agent mode.`, "ok");
    await hooks.refreshAll();
  }
}

export async function startPair(pairId: string, priming?: PairStartPriming): Promise<void> {
  const status = await runAction(() => window.desktop.startPair(pairId, priming));
  if (status) {
    setStatuses(status);
    if (hooks.isOpenWorkerOnStart?.() === true) {
      await openWorkerSession(pairId);
    }
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

export async function validatePair(pairId: string): Promise<void> {
  const validation = await runAction(() => window.desktop.validatePair(pairId));
  if (validation) {
    state.validations.set(pairId, validation);
    hooks.rerender();
    toast(`${pairId}: ${validation.status}`, validation.status === "READY" ? "ok" : "error");
  }
}
