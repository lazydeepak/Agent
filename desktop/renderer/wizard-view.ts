import { runAction } from "./actions.js";
import { actionButton, el, errorMessage, toast } from "./dom.js";
import { expandedProjectPairs, state } from "./view-state.js";
import {
  candidateFromWizard,
  candidateIssues,
  createWizardDraft,
  rebindSelection,
  stepComplete,
  stepIssues,
  suggestPairId,
  wizardStepLabel,
  wizardSteps,
  wizardTitle,
  type WizardDraft,
  type WizardKind,
  type WizardSession,
  type WizardStep
} from "./wizard.js";
import type { CandidatePairDto, EndpointTestResultDto, OpenCodeSessionInfoDto, ProjectPairDto, UpdatePairDto, ValidationResultDto } from "../../src/contracts/desktop.js";

/** Refresh seam into the owning renderer. */
export interface WizardHooks {
  refresh(): Promise<void>;
}
let hooks: WizardHooks = { refresh: async () => undefined };
export function setWizardHooks(h: WizardHooks): void { hooks = h; }

/** Active wizard session and step cursor (module-local, shared via exports). */
export let wizard: WizardSession | undefined;
export let wizardStepIndex = 0;
export function setWizardStepIndex(value: number): void { wizardStepIndex = value; }


export function openWizard(kind: WizardKind, pairId?: string): void {
  const existing = pairId ? state.pairs.find((pair) => pair.pairId === pairId) : undefined;
  wizard = { kind, draft: createWizardDraft(kind, existing), sessions: [], projects: [] };
  wizardStepIndex = 0;
  showWizardModal(true);
  renderWizard();
  void loadWizardDefaults();
}

export async function loadWizardDefaults(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const [openCodeEndpoint, chatGptEndpoint, projects] = await Promise.all([
    window.desktop.getOpenCodeEndpoint().catch(() => ""),
    window.desktop.getChatGptEndpoint().catch(() => ""),
    window.desktop.listProjectPairs().catch(() => [] as ProjectPairDto[])
  ]);
  if (wizard !== currentWizard) {
    return;
  }
  if (!wizard.draft.workerEndpoint || wizard.draft.workerEndpoint === "http://127.0.0.1:4096") {
    wizard.draft.workerEndpoint = openCodeEndpoint || wizard.draft.workerEndpoint || "http://127.0.0.1:4096";
  }
  if (!wizard.draft.plannerEndpoint) {
    wizard.draft.plannerEndpoint = chatGptEndpoint;
  }
  wizard.projects = projects;
  if (wizard.draft.projectPairId === undefined) {
    if (wizard.kind === "create") {
      const first = projects[0];
      if (first && !wizard.draft.workerRepoPath.trim()) {
        wizard.draft.projectPairId = first.projectPairId;
        wizard.draft.workerRepoPath = first.worker.repoPath;
      }
    } else {
      const match = projects.find(
        (project) => project.worker.repoPath === currentWizard.draft.workerRepoPath.trim()
      );
      if (match) {
        wizard.draft.projectPairId = match.projectPairId;
      }
    }
  }
  renderWizard();
  if (wizard.kind === "create" || wizard.kind === "rebind") {
    void scanDesktopSession(true);
  }
}

export function closeWizard(): void {
  wizard = undefined;
  showWizardModal(false);
}

export function showWizardModal(visible: boolean): void {
  const modal = document.getElementById("wizard-modal");
  modal?.classList.toggle("hidden", !visible);
}

export function currentWizardStep(): WizardStep {
  return wizardSteps(wizard!.kind)[wizardStepIndex];
}

export function renderWizard(): void {
  if (!wizard) {
    return;
  }
  const body = document.getElementById("wizard-body");
  const title = document.getElementById("wizard-title");
  if (!body || !title) {
    return;
  }
  title.textContent = wizardTitle(wizard.kind, wizard.draft);
  body.replaceChildren();
  body.appendChild(wizardStepper());
  const step = currentWizardStep();
  if (step === "worker") {
    renderWorkerStep(body);
  } else if (step === "planner") {
    renderPlannerStep(body);
  } else {
    renderReviewStep(body);
  }
  syncWizardControls();
}

export function wizardStepper(): HTMLElement {
  const steps = wizardSteps(wizard!.kind);
  const wrap = el("div", "step-stepper");
  for (let index = 0; index < steps.length; index += 1) {
    const pill = el("div", `step-pill${index === wizardStepIndex ? " active" : ""}`);
    pill.textContent = wizardStepLabel(steps[index]!);
    wrap.appendChild(pill);
  }
  return wrap;
}

export function projectRepoBasename(repoPath: string): string {
  const parts = repoPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

export function selectedProject(): ProjectPairDto | undefined {
  if (!wizard) {
    return undefined;
  }
  const id = wizard.draft.projectPairId;
  if (!id) {
    return undefined;
  }
  return wizard.projects.find((project) => project.projectPairId === id);
}

export function renderProjectPicker(): HTMLElement {
  const draft = wizard!.draft;
  const wrap = el("div", "field");
  const label = el("label");
  label.textContent = "Project";
  label.htmlFor = "wiz-project";
  wrap.appendChild(label);
  const select = document.createElement("select");
  select.id = "wiz-project";
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent =
    wizard!.projects.length > 0 ? "Custom repository…" : "Custom repository… (no projects yet)";
  select.appendChild(custom);
  for (const project of wizard!.projects) {
    const option = document.createElement("option");
    option.value = project.projectPairId;
    option.textContent = `${project.projectPairId} — ${projectRepoBasename(project.worker.repoPath)} ↔ ${project.planner.projectName ?? project.planner.projectSlug}`;
    select.appendChild(option);
  }
  select.value = draft.projectPairId ?? "";
  select.addEventListener("change", () => {
    if (!wizard) {
      return;
    }
    const id = select.value || undefined;
    wizard.draft.projectPairId = id;
    const project = wizard.projects.find((candidate) => candidate.projectPairId === id);
    if (project) {
      wizard.draft.workerRepoPath = project.worker.repoPath;
    }
    wizard.validation = undefined;
    renderWizard();
  });
  wrap.appendChild(select);
  const hint = el("span", "hint");
  const project = selectedProject();
  hint.textContent = project
    ? `Sessions use this project's repository and are assigned to ${project.projectPairId}.`
    : "Pick a project to lock the repository, or enter a custom path.";
  wrap.appendChild(hint);
  return wrap;
}

export function renderWorkerStep(body: HTMLElement): void {
  const draft = wizard!.draft;
  body.appendChild(renderProjectPicker());
  if (wizard!.kind !== "rebind") {
    body.appendChild(
      textField("pair-id", "Automation Session ID", draft.pairId, "Lowercase letters, numbers, and single hyphens.", wizard!.kind === "edit")
    );
  }
  body.appendChild(
    textField("worker-session", "Worker Agent Session ID", draft.workerSessionId, "Choose or create a session below.")
  );
  const repoLocked = draft.projectPairId !== undefined;
  body.appendChild(
    textField(
      "worker-repo",
      "Repo path",
      draft.workerRepoPath,
      repoLocked ? "Locked to the selected project." : "Working directory attached to the session.",
      repoLocked
    )
  );

  body.appendChild(rowNote("1. Select the active Worker Agent Desktop session."));
  const actions = el("div", "field-actions");
  const scanDesktop = el("button", "btn btn-sm");
  scanDesktop.textContent = "Scan Worker Agent Desktop";
  scanDesktop.addEventListener("click", () => {
    void scanDesktopSession(false);
  });
  actions.appendChild(scanDesktop);
  const discover = el("button", "btn btn-sm");
  discover.textContent = "Discover from server";
  discover.addEventListener("click", () => {
    void discoverSessions();
  });
  actions.appendChild(discover);
  if (wizard!.kind !== "rebind") {
    const create = el("button", "btn btn-sm");
    create.textContent = "Create session";
    create.addEventListener("click", () => {
      void createSession();
    });
    actions.appendChild(create);
  }
  body.appendChild(actions);

  const list = el("div", "session-list");
  list.id = "wiz-session-list";
  for (const session of wizard!.sessions) {
    list.appendChild(sessionItem(session, draft.workerSessionId));
  }
  if (wizard!.sessions.length === 0) {
    list.appendChild(rowNote("No sessions loaded yet. Scan Worker Agent Desktop, discover from a server, or enter an ID."));
  }
  body.appendChild(list);

  body.appendChild(rowNote("2. Start the Worker Agent connection for the selected repository."));
  body.appendChild(
    textField("worker-endpoint", "Worker Agent endpoint", draft.workerEndpoint, "Used for discovery and readiness.")
  );
  body.appendChild(apiProtocolField(draft.workerApiProtocol));
  const serverActions = el("div", "field-actions");
  const startServer = el("button", "btn btn-sm");
  startServer.id = "project-pair-repo-start-server";
  startServer.textContent = "Start Worker Agent server";
  startServer.disabled = !draft.workerRepoPath.trim();
  startServer.addEventListener("click", () => void startWorkerServer());
  serverActions.appendChild(startServer);
  const updateOpenCode = el("button", "btn btn-sm");
  updateOpenCode.textContent = "Update Worker Agent command";
  updateOpenCode.addEventListener("click", () => void updateOpenCodeCommand());
  serverActions.appendChild(updateOpenCode);
  serverActions.appendChild(testButton("worker", "Test connection"));
  const workerResult = el("span", "detail");
  workerResult.id = "wiz-worker-result";
  serverActions.appendChild(workerResult);
  body.appendChild(serverActions);
  renderManualCommand(body);
  renderStepReadiness(body, "worker");
}

export function renderPlannerStep(body: HTMLElement): void {
  const draft = wizard!.draft;
  const project = selectedProject();
  if (project) {
    body.appendChild(rowNote(
      `This session will be assigned to project "${project.projectPairId}" (Planner Agent project ${project.planner.projectName ?? project.planner.projectSlug}).`
    ));
  }
  body.appendChild(rowNote("1. Launch the dedicated automation Chrome from Agent Relay."));
  const browserActions = el("div", "field-actions");
  const launch = el("button", "btn btn-sm");
  launch.textContent = "Launch Planner Agent browser";
  launch.addEventListener("click", () => void startPlannerBrowser());
  browserActions.appendChild(launch);
  browserActions.appendChild(testButton("planner", "Test browser connection"));
  const plannerResult = el("span", "detail");
  plannerResult.id = "wiz-planner-result";
  browserActions.appendChild(plannerResult);
  body.appendChild(browserActions);
  body.appendChild(
    textField("planner-endpoint", "Chrome automation (CDP) endpoint", draft.plannerEndpoint, "Managed automation browser endpoint.")
  );

  body.appendChild(rowNote("2. In that Chrome window, sign in and open the Planner Agent conversation, then paste its URL below."));
  body.appendChild(
    textField("planner-url", "Planner Agent conversation URL", draft.parsed?.conversationUrl ?? "", "e.g. https://chatgpt.com/c/<id> or /g/<project>/c/<id>")
  );
  const parseBtn = el("button", "btn btn-sm");
  parseBtn.textContent = "Parse conversation";
  parseBtn.addEventListener("click", () => {
    void parsePlannerUrl();
  });
  body.appendChild(parseBtn);

  if (draft.parsed) {
    const parsed = el("div", "parsed-url");
    parsed.textContent = `conversation ${draft.parsed.conversationId}${draft.parsed.project ? ` · project ${draft.parsed.project}` : ""}`;
    body.appendChild(parsed);
  }
  renderManualCommand(body);
  renderStepReadiness(body, "planner");
}

export function renderReviewStep(body: HTMLElement): void {
  const candidate = candidateFromWizard(wizard!.kind, wizard!.draft);
  const summary = el("div", "parsed-url");
  if (candidate) {
    summary.textContent = `Session "${candidate.pairId}" · session ${candidate.worker.sessionId} · conversation ${candidate.planner.conversationId}`;
  } else {
    summary.textContent = candidateIssues(wizard!.kind, wizard!.draft).join(" ");
  }
  body.appendChild(summary);

  const actions = el("div", "field-actions");
  const validateBtn = el("button", "btn btn-sm");
  validateBtn.textContent = "Validate";
  validateBtn.disabled = !candidate;
  validateBtn.addEventListener("click", () => {
    void validateCandidateFromWizard();
  });
  actions.appendChild(validateBtn);
  body.appendChild(actions);

  const result = el("div", "detail");
  result.id = "wiz-validation-result";
  if (wizard!.validation) {
    result.textContent = `${wizard!.validation.status}: ${wizard!.validation.checks
      .map((check) => `${check.name}=${check.status}`)
      .join(", ")}`;
    result.classList.add(wizard!.validation.status === "READY" ? "result-ok" : "result-fail");
  }
  body.appendChild(result);

  if (wizard!.kind === "edit") {
    const note = el("div", "detail");
    note.textContent = "Editing updates this session. The session must be stopped first.";
    body.appendChild(note);
  }
}

export function sessionItem(session: OpenCodeSessionInfoDto, selected: string): HTMLElement {
  const item = el("div", "session-item");
  if (session.sessionId === selected) {
    item.classList.add("selected");
  }
  const title = el("span", "session-title");
  title.textContent = session.title || session.sessionId;
  const meta = el("span", "session-meta");
  meta.textContent = session.repoPath || "";
  item.appendChild(title);
  item.appendChild(meta);
  item.addEventListener("click", () => {
    if (!wizard) {
      return;
    }
    applyWorkerSession(session);
    wizard.draft.workerEndpointOk = undefined;
    wizard.validation = undefined;
    renderWizard();
  });
  return item;
}

export function applyWorkerSession(session: OpenCodeSessionInfoDto): void {
  if (!wizard) return;
  wizard.draft.workerSessionId = session.sessionId;
  if (wizard.kind !== "rebind" && session.repoPath) {
    wizard.draft.workerRepoPath = session.repoPath;
    wizard.draft.projectPairId = wizard.projects.find(
      (project) => project.worker.repoPath === session.repoPath
    )?.projectPairId;
  }
  if (wizard.kind === "create" && !wizard.draft.pairId.trim()) {
    const base = suggestPairId(session.title, session.repoPath);
    if (base) {
      let available = base;
      let suffix = 2;
      while (state.pairs.some((pair) => pair.pairId === available)) available = `${base}-${suffix++}`;
      wizard.draft.pairId = available;
    }
  }
}

export function renderStepReadiness(body: HTMLElement, step: WizardStep): void {
  const status = el("div", "step-readiness");
  status.id = "wiz-step-readiness";
  updateStepReadiness(status, step);
  body.appendChild(status);
}

export function updateStepReadiness(status: HTMLElement, step: WizardStep): void {
  const issues = stepIssues(wizard!.kind, step, wizard!.draft);
  status.classList.toggle("result-ok", issues.length === 0);
  status.classList.toggle("result-fail", issues.length > 0);
  status.textContent = issues.length === 0
    ? `${step === "worker" ? "Worker Agent setup" : "Planner Agent setup"} is ready. You can continue.`
    : `To continue: ${issues.join(" ")}`;
}

export function renderManualCommand(body: HTMLElement): void {
  const manual = wizard!.manualCommand;
  if (!manual) return;
  const panel = el("div", "manual-command");
  const heading = el("div", "manual-command-title");
  heading.textContent = "Manual terminal step required";
  panel.appendChild(heading);
  panel.appendChild(rowNote("Run this command in Terminal, wait for it to finish, then verify again:"));
  const command = el("code", "manual-command-value");
  command.textContent = manual.command;
  panel.appendChild(command);
  const actions = el("div", "field-actions");
  const copy = el("button", "btn btn-sm");
  copy.textContent = "Copy command";
  copy.addEventListener("click", () => void copyManualCommand(manual.command, copy));
  actions.appendChild(copy);
  const verify = el("button", "btn btn-sm");
  verify.textContent = "I've run it — verify again";
  verify.addEventListener("click", () => {
    wizard!.manualCommand = undefined;
    if (manual.verify === "worker") void runTestWorker();
    else void runTestPlanner();
  });
  actions.appendChild(verify);
  panel.appendChild(actions);
  body.appendChild(panel);
}

export async function copyManualCommand(command: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(command);
    button.textContent = "Copied";
  } catch {
    const input = document.createElement("textarea");
    input.value = command;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    button.textContent = "Copied";
  }
}

export function rowNote(text: string): HTMLElement {
  const note = el("div", "detail");
  note.textContent = text;
  return note;
}

export function textField(key: string, label: string, value: string, hint: string, readOnly?: boolean): HTMLElement {
  return field(label, hint, (input) => {
    input.id = key;
    input.value = value;
    input.readOnly = Boolean(readOnly);
    input.addEventListener("input", () => {
      if (!wizard) {
        return;
      }
      const draft = wizard.draft;
      switch (key) {
        case "pair-id":
          draft.pairId = input.value;
          break;
        case "worker-session":
          draft.workerSessionId = input.value;
          draft.workerEndpointOk = undefined;
          break;
        case "worker-repo":
          draft.workerRepoPath = input.value;
          draft.workerEndpointOk = undefined;
          break;
        case "worker-endpoint":
          draft.workerEndpoint = input.value;
          draft.workerEndpointOk = undefined;
          break;
        case "planner-url":
          draft.parsed = undefined;
          break;
        case "planner-endpoint":
          draft.plannerEndpoint = input.value;
          draft.plannerEndpointOk = undefined;
          break;
      }
      wizard.validation = undefined;
      const step = currentWizardStep();
      if (wizard.kind === "edit" && key === "pair-id") {
        // pairId is immutable; keep the original value in a hints badge via toast note
        toast("Automation Session ID cannot be changed after creation.", "error");
      }
      syncWizardControls();
    });
    return input;
  });
}

export function field(label: string, hint: string, buildInput: (input: HTMLInputElement) => HTMLInputElement): HTMLElement {
  const wrap = el("div", "field");
  const labelEl = el("label");
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  buildInput(input);
  const hintEl = el("span", "hint");
  hintEl.textContent = hint;
  wrap.appendChild(labelEl);
  wrap.appendChild(input);
  wrap.appendChild(hintEl);
  return wrap;
}

export function apiProtocolField(value: "auto" | "legacy" | "v2"): HTMLElement {
  const wrap = el("div", "field");
  const labelEl = el("label");
  labelEl.textContent = "API protocol";
  const select = document.createElement("select");
  select.id = "worker-api-protocol";
  const options: Array<{ value: "auto" | "legacy" | "v2"; label: string }> = [
    { value: "auto", label: "Auto-detect" },
    { value: "legacy", label: "Legacy (Worker Agent Desktop compatible)" },
    { value: "v2", label: "v2" }
  ];
  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    optionEl.selected = option.value === value;
    select.appendChild(optionEl);
  }
  select.addEventListener("change", () => {
    if (!wizard) return;
    wizard.draft.workerApiProtocol = select.value as "auto" | "legacy" | "v2";
    wizard.validation = undefined;
    syncWizardControls();
  });
  const hintEl = el("span", "hint");
  hintEl.textContent =
    "Pin \"Legacy\" if this session is also opened in Worker Agent Desktop, so both sides read and write the same history.";
  wrap.appendChild(labelEl);
  wrap.appendChild(select);
  wrap.appendChild(hintEl);
  return wrap;
}

export function testButton(prefix: "worker" | "planner", label: string): HTMLButtonElement {
  const button = el("button", "btn btn-sm");
  button.textContent = label;
  button.addEventListener("click", () => {
    if (prefix === "worker") void runTestWorker();
    else void runTestPlanner();
  });
  return button;
}

export async function discoverSessions(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const sessions = await runAction(() =>
    window.desktop.discoverWorkerSessions({ baseUrl: currentWizard.draft.workerEndpoint })
  );
  if (sessions && wizard === currentWizard) {
    wizard.sessions = sessions;
    renderWizard();
    if (sessions.length === 0) {
      toast("No Worker Agent sessions found on that endpoint.", "error");
    }
  }
}

export async function scanDesktopSession(silentFailure: boolean): Promise<void> {
  if (!wizard) return;
  const currentWizard = wizard;
  if (silentFailure && currentWizard.draft.workerSessionId.trim()) return;
  try {
    const session = await window.desktop.scanDesktopWorkerSession();
    if (wizard !== currentWizard) return;
    applyWorkerSession(session);
    wizard.sessions = [session, ...wizard.sessions.filter((item) => item.sessionId !== session.sessionId)];
    wizard.validation = undefined;
    wizard.draft.workerEndpointOk = undefined;
    renderWizard();
    toast(`Detected active Worker Agent session ${session.sessionId}.`, "ok");
  } catch (error) {
    if (!silentFailure && wizard === currentWizard) {
      toast(errorMessage(error));
    }
  }
}

export async function createSession(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const repoPath = currentWizard.draft.workerRepoPath.trim();
  if (!repoPath) {
    toast("Enter a repo path before creating a Worker Agent session.", "error");
    return;
  }
  const session = await runAction(() =>
    window.desktop.createWorkerSession({
      baseUrl: currentWizard.draft.workerEndpoint,
      repoPath,
      ...(currentWizard.draft.pairId.trim() ? { title: currentWizard.draft.pairId.trim() } : {})
    })
  );
  if (session && wizard === currentWizard) {
    applyWorkerSession({ ...session, repoPath: session.repoPath || repoPath });
    wizard.sessions = [session, ...wizard.sessions.filter((item) => item.sessionId !== session.sessionId)];
    wizard.validation = undefined;
    wizard.draft.workerEndpointOk = undefined;
    renderWizard();
    toast(`Created Worker Agent session ${session.sessionId}.`, "ok");
  }
}

export async function startWorkerServer(): Promise<void> {
  if (!wizard) return;
  const currentWizard = wizard;
  const repoPath = currentWizard.draft.workerRepoPath.trim();
  if (!repoPath) {
    toast("Select a Worker Agent session first.");
    return;
  }
  const result = await runAction(() => window.desktop.startWorkerServer({
    baseUrl: currentWizard.draft.workerEndpoint,
    repoPath,
    sessionId: currentWizard.draft.workerSessionId
  }));
  if (!result || wizard !== currentWizard) return;
  wizard.draft.workerEndpoint = result.endpoint;
  renderWizard();
  toast(result.message, "ok");
  await runTestWorker();
}

export async function startPlannerBrowser(): Promise<void> {
  if (!wizard) return;
  const currentWizard = wizard;
  const result = await runAction(() => window.desktop.startPlannerBrowser({
    cdpUrl: currentWizard.draft.plannerEndpoint
  }));
  if (!result || wizard !== currentWizard) return;
  wizard.draft.plannerEndpoint = result.endpoint;
  renderWizard();
  toast(result.message, "ok");
  await runTestPlanner();
}

export async function updateOpenCodeCommand(): Promise<void> {
  const result = await runAction(() => window.desktop.updateOpenCode());
  if (result) toast(result.message, "ok");
}

export async function parsePlannerUrl(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const url = readRawInput("planner-url");
  const parsed = await runAction(() => window.desktop.parsePlannerUrl({ url }));
  if (parsed && wizard === currentWizard) {
    wizard.draft.parsed = {
      conversationId: parsed.conversationId,
      conversationUrl: parsed.conversationUrl,
      ...(parsed.project ? { project: parsed.project } : {})
    };
    wizard.validation = undefined;
    renderWizard();
  }
}

export async function runTestWorker(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const result = await runAction(() =>
    window.desktop.testWorkerEndpoint({
      baseUrl: currentWizard.draft.workerEndpoint,
      sessionId: currentWizard.draft.workerSessionId,
      repoPath: currentWizard.draft.workerRepoPath
    })
  );
  if (wizard !== currentWizard) {
    return;
  }
  reflectTestResult("worker", result);
  if (result) {
    wizard.draft.workerEndpointOk = result.ok;
    if (result.ok) wizard.manualCommand = undefined;
    syncWizardControls();
  }
}

export async function runTestPlanner(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const conversationUrl = currentWizard.draft.parsed?.conversationUrl;
  const result = await runAction(() =>
    window.desktop.testPlannerEndpoint({ cdpUrl: currentWizard.draft.plannerEndpoint, conversationUrl })
  );
  if (wizard !== currentWizard) {
    return;
  }
  reflectTestResult("planner", result);
  if (result) {
    wizard.draft.plannerEndpointOk = result.ok;
    if (result.ok) wizard.manualCommand = undefined;
    syncWizardControls();
  }
}

export function reflectTestResult(prefix: "worker" | "planner", result: EndpointTestResultDto | undefined): void {
  const node = document.getElementById(`wiz-${prefix}-result`);
  if (!node) {
    return;
  }
  if (!result) {
    node.textContent = "";
    return;
  }
  node.textContent = result.message;
  node.classList.add(result.ok ? "result-ok" : "result-fail");
}

export async function validateCandidateFromWizard(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const candidate = candidateFromWizard(currentWizard.kind, currentWizard.draft);
  if (!candidate) {
    toast(candidateIssues(currentWizard.kind, currentWizard.draft).join(" "), "error");
    return;
  }
  const validation = await runAction(() => window.desktop.validateCandidate(candidate));
  if (validation && wizard === currentWizard) {
    wizard.validation = validation;
    renderWizard();
  }
}

export async function doSave(): Promise<void> {
  if (!wizard) {
    return;
  }
  const currentWizard = wizard;
  const candidate = candidateFromWizard(currentWizard.kind, currentWizard.draft);
  if (!candidate) {
    toast(candidateIssues(currentWizard.kind, currentWizard.draft).join(" "), "error");
    return;
  }
  const saved =
    currentWizard.kind === "edit"
      ? await runAction(() => window.desktop.updatePair(currentWizard.draft.targetPairId ?? candidate.pairId, toUpdatePair(candidate)))
      : await runAction(() => window.desktop.createPair(candidate));
  if (saved) {
    const assigned = state.projectPairs.find(
      (project) => project.worker.repoPath === candidate.worker.repoPath
    );
    if (assigned) {
      expandedProjectPairs.add(assigned.projectPairId);
    }
    if (wizard === currentWizard) {
      toast(currentWizard.kind === "edit" ? "Session updated." : "Session added.", "ok");
      closeWizard();
    }
    await hooks.refresh();
  }
}

export function toUpdatePair(candidate: CandidatePairDto): UpdatePairDto {
  return {
    worker: { sessionId: candidate.worker.sessionId, repoPath: candidate.worker.repoPath, server: candidate.worker.server },
    planner: {
      conversationId: candidate.planner.conversationId,
      conversationUrl: candidate.planner.conversationUrl,
      browser: candidate.planner.browser
    },
    ...(candidate.projectPairId ? { projectPairId: candidate.projectPairId } : {})
  };
}

export async function doRebind(): Promise<void> {
  if (!wizard || wizard.kind !== "rebind") {
    return;
  }
  const currentWizard = wizard;
  const sessionId = rebindSelection(currentWizard.draft);
  const target = currentWizard.draft.targetPairId;
  if (!sessionId || !target) {
    toast("Choose or type a Worker Agent session to rebind to.", "error");
    return;
  }
  const saved = await runAction(() => window.desktop.rebindWorker(target, sessionId));
  if (saved) {
    if (wizard === currentWizard) {
      toast(`Rebound to ${sessionId}.`, "ok");
      closeWizard();
    }
    await hooks.refresh();
  }
}

export async function removePair(pairId: string): Promise<void> {
  const confirmed = window.confirm(
    `Remove pair "${pairId}"?\n\nThis does NOT delete the Worker Agent session, the Planner Agent conversation, the browser profile, or relay history.`
  );
  if (!confirmed) {
    return;
  }
  const result = await runAction(() => window.desktop.removePair(pairId));
  if (result) {
    toast(`Removed ${pairId}.`, "ok");
    await hooks.refresh();
  }
}

export function readRawInput(id: string): string {
  const node = document.getElementById(id);
  if (node instanceof HTMLInputElement) {
    return node.value;
  }
  return "";
}

export function syncWizardControls(): void {
  if (!wizard) {
    return;
  }
  const back = document.getElementById("wizard-back") as HTMLButtonElement | null;
  const next = document.getElementById("wizard-next") as HTMLButtonElement | null;
  if (!back || !next) {
    return;
  }
  const steps = wizardSteps(wizard.kind);
  const last = steps.length - 1;
  back.disabled = wizardStepIndex === 0;
  const step = steps[wizardStepIndex]!;
  const startServer = document.getElementById("project-pair-repo-start-server") as HTMLButtonElement | null;
  if (startServer) {
    startServer.disabled = !wizard.draft.workerRepoPath.trim();
  }
  const readiness = document.getElementById("wiz-step-readiness");
  if (readiness) updateStepReadiness(readiness, step);
  if (wizardStepIndex === last) {
    next.textContent = wizard.kind === "rebind" ? "Rebind" : "Save";
    next.disabled = !stepComplete(wizard.kind, step, wizard.draft);
  } else {
    next.textContent = "Next";
    next.disabled = !stepComplete(wizard.kind, step, wizard.draft);
  }
}
