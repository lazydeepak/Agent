import { actionButton, el, errorMessage, toast } from "./dom.js";
import { runAction } from "./actions.js";
import { state } from "./view-state.js";
import type { PairCardModel } from "./state.js";
interface WorkerSessionDispatch {
  rerender(): void;
  refreshAll(): Promise<void>;
}

let dispatch: WorkerSessionDispatch | undefined;
export function setWorkerSessionDispatch(d: WorkerSessionDispatch): void {
  dispatch = d;
}

export function dispatchRerender(): void {
  requireDispatch().rerender();
}
function requireDispatch(): WorkerSessionDispatch {
  if (!dispatch) throw new Error("WorkerSessionDispatch was not installed by the renderer.");
  return dispatch;
}

export async function openWorkerSession(pairId: string): Promise<void> {
  const result = await runAction(() => window.desktop.openWorkerSession(pairId));
  if (!result) return;
  toast(
    result.foregrounded
      ? `Opened the shared Worker Agent session (${result.sessionId}) — same session the relay uses.`
      : `Bound Worker Agent session is ${result.sessionId}. Select it in the opened agent window if it did not switch automatically.`,
    "ok"
  );
}

export async function alignWorkerSessionWithOpenCodeDesktop(pairId: string): Promise<void> {
  const result = await runAction(() => window.desktop.alignWorkerSessionWithOpenCodeDesktop(pairId));
  if (!result) return;
  toast(result.message, "ok");
  if (result.rebound) {
    await requireDispatch().refreshAll();
  }
}

interface WorkerSessionCreation {
  pairId: string;
  title: string;
  confirmed: boolean;
}
let workerSessionCreation: WorkerSessionCreation | undefined;

export async function createWorkerSessionForPair(pairId: string): Promise<void> {
  const suggestedTitle = await runAction(() => window.desktop.suggestWorkerSessionTitle(pairId));
  if (!suggestedTitle) return;
  workerSessionCreation = { pairId, title: suggestedTitle, confirmed: false };
  renderWorkerSessionModal();
}

export function renderWorkerSessionModal(): void {
  const modal = document.getElementById("worker-session-modal");
  const input = document.getElementById("worker-session-name") as HTMLInputElement | null;
  const field = document.getElementById("worker-session-name-field");
  const confirmation = document.getElementById("worker-session-confirmation");
  const confirm = document.getElementById("worker-session-confirm");
  if (!modal || !input || !field || !confirmation || !confirm) return;
  if (!workerSessionCreation) {
    modal.classList.add("hidden");
    return;
  }
  modal.classList.remove("hidden");
  input.value = workerSessionCreation.title;
  input.disabled = workerSessionCreation.confirmed;
  field.classList.toggle("hidden", workerSessionCreation.confirmed);
  confirmation.classList.toggle("hidden", !workerSessionCreation.confirmed);
  confirmation.textContent = `Create and bind the new Worker Agent session "${workerSessionCreation.title}"?`;
  confirm.textContent = workerSessionCreation.confirmed ? "Create session" : "Continue";
  if (!workerSessionCreation.confirmed) input.focus();
}

export function closeWorkerSessionModal(): void {
  workerSessionCreation = undefined;
  renderWorkerSessionModal();
}

export async function confirmWorkerSessionCreation(): Promise<void> {
  if (!workerSessionCreation) return;
  const input = document.getElementById("worker-session-name") as HTMLInputElement | null;
  if (!input) return;
  if (!workerSessionCreation.confirmed) {
    const title = input.value.trim();
    if (!title) {
      toast("A Worker Agent session name is required.");
      input.focus();
      return;
    }
    workerSessionCreation = { ...workerSessionCreation, title, confirmed: true };
    renderWorkerSessionModal();
    return;
  }
  const { pairId, title } = workerSessionCreation;
  const result = await runAction(() => window.desktop.createWorkerSessionForPair(pairId, { title }));
  if (result) {
    state.workerModels.delete(result.pairId);
    closeWorkerSessionModal();
    toast(`${result.pairId}: bound new Worker Agent session ${result.worker.sessionId}.`, "ok");
    await requireDispatch().refreshAll();
  }
}

const loadingWorkerModels = new Set<string>();
const fallbackRequests = new Set<string>();

export function renderWorkerModelControl(card: PairCardModel, running: boolean): HTMLElement {
  running = running || fallbackRequests.has(card.pairId);
  const row = el("div", "pair-priming");
  const label = el("label", "priming-label");
  label.textContent = "Worker Agent model:";
  row.appendChild(label);
  const models = state.workerModels.get(card.pairId);
  if (!models) {
    const loading = el("span", "detail");
    loading.textContent = loadingWorkerModels.has(card.pairId) ? "Loading models..." : "No models available";
    row.appendChild(loading);
    void loadWorkerModels(card.pairId);
    return row;
  }
  const select = document.createElement("select");
  select.className = "field select";
  // Allow selection even when running; Apply takes effect from the next prompt.
  select.disabled = models.length === 0;
  if (models.length === 0) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No models available";
    none.disabled = true;
    none.selected = true;
    select.appendChild(none);
  } else if (!models.some((model) => model.current)) {
    const unknown = document.createElement("option");
    unknown.value = "";
    unknown.textContent = "Choose a model (current model unavailable)";
    unknown.disabled = true;
    unknown.selected = true;
    select.appendChild(unknown);
  }
  for (const model of models) {
    const option = document.createElement("option");
    option.value = JSON.stringify([model.providerId, model.modelId]);
    option.textContent = model.name;
    option.selected = model.current;
    select.appendChild(option);
  }
  row.appendChild(select);
  row.appendChild(
    actionButton("Refresh", "btn-sm btn-ghost", models.length > 0, () => {
      state.workerModels.delete(card.pairId);
      void loadWorkerModels(card.pairId);
    })
  );
  const notify = document.createElement("input");
  notify.type = "checkbox";
  notify.disabled = models.length === 0;
  const notifyLabel = el("label", "priming-choice");
  notifyLabel.appendChild(notify);
  const notifyText = el("span");
  notifyText.textContent = "Notify Planner Agent";
  notifyLabel.appendChild(notifyText);
  row.appendChild(notifyLabel);
  row.appendChild(actionButton("Apply", "btn-sm", models.length > 0, () => {
    if (!select.value) return;
    const [providerId, modelId] = JSON.parse(select.value) as [string, string];
    void switchWorkerModel(card.pairId, providerId, modelId, notify.checked);
  }));
  const fallback = actionButton("Use model & continue", "btn-sm", models.length > 0, () => {
    if (!select.value) return;
    const [providerId, modelId] = JSON.parse(select.value) as [string, string];
    void resumeWithFallbackModel(card.pairId, providerId, modelId);
  });
  fallback.title = "Switch model and immediately send one continue prompt (relay stays stopped). Different from Apply.";
  row.appendChild(fallback);
  return row;
}

export async function resumeWithFallbackModel(pairId: string, providerId: string, modelId: string): Promise<void> {
  if (fallbackRequests.has(pairId)) return;
  if (!window.confirm(`Switch ${pairId} to ${providerId}/${modelId} and send one "continue" prompt to its Worker Agent? This can resume project work. The relay will remain stopped. No Planner Agent notification is sent.`)) return;
  fallbackRequests.add(pairId);
  requireDispatch().rerender();
  try {
    const result = await runAction(() => window.desktop.resumeWithFallbackModel(pairId, { providerId, modelId }));
    if (result) toast(`${pairId}: model changed and continue prompt sent. Relay remains stopped.`, "ok");
  } finally {
    fallbackRequests.delete(pairId);
    state.workerModels.delete(pairId);
    await requireDispatch().refreshAll();
  }
}

export async function loadWorkerModels(pairId: string): Promise<void> {
  if (state.workerModels.has(pairId) || loadingWorkerModels.has(pairId)) return;
  loadingWorkerModels.add(pairId);
  try {
    state.workerModels.set(pairId, await window.desktop.listWorkerModels(pairId));
  } catch (error) {
    toast(errorMessage(error));
    state.workerModels.delete(pairId);
  } finally {
    loadingWorkerModels.delete(pairId);
    requireDispatch().rerender();
  }
}

export async function switchWorkerModel(pairId: string, providerId: string, modelId: string, notifyPlanner: boolean): Promise<void> {
  const notification = notifyPlanner ? " Agent Relay will also post a model-change notice to the paired Planner Agent conversation." : "";
  const confirmed = window.confirm(`Switch ${pairId} Worker Agent to ${providerId}/${modelId}? This applies from the next worker turn (subsequent prompts).${notification}`);
  if (!confirmed) return;
  const result = await runAction(() => window.desktop.switchWorkerModel(pairId, { providerId, modelId, notifyPlanner }));
  state.workerModels.delete(pairId);
  if (result) {
    toast(`${pairId}: Worker Agent model switched to ${result.name ?? `${result.providerId}/${result.modelId}`}.`, "ok");
  }
  await requireDispatch().refreshAll();
}
