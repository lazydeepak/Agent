import { runAction } from "./actions.js";
import { el } from "./dom.js";
import type {
  EndpointTestResultDto,
  OpenCodeSessionInfoDto,
  ToolActionResultDto,
  ToolLaunchResultDto
} from "../../src/contracts/desktop.js";

export interface WorkerEndpointInput {
  baseUrl?: string;
  sessionId?: string;
  repoPath?: string;
}

export interface WorkerServerInput {
  baseUrl?: string;
  repoPath: string;
  sessionId?: string;
}

/** Verify the configured Worker API endpoint and its session/project context. */
export function verifyWorkerEndpoint(
  input: WorkerEndpointInput
): Promise<EndpointTestResultDto | undefined> {
  return runAction(() => window.desktop.testWorkerEndpoint(input));
}

/** Start or attach to the Worker API endpoint for the selected project. */
export function startWorkerManagementServer(
  input: WorkerServerInput
): Promise<ToolLaunchResultDto | undefined> {
  return runAction(() => window.desktop.startWorkerServer(input));
}

export function createWorkerManagementSession(
  input: WorkerServerInput & { title?: string }
): Promise<OpenCodeSessionInfoDto | undefined> {
  return runAction(() => window.desktop.createWorkerSession(input));
}

export function updateWorkerManagementCommand(): Promise<ToolActionResultDto | undefined> {
  return runAction(() => window.desktop.updateOpenCode());
}

export function renderWorkerApiProtocolField(
  value: "auto" | "legacy" | "v2",
  onChange: (value: "auto" | "legacy" | "v2") => void
): HTMLElement {
  const wrap = el("div", "field");
  const label = el("label");
  label.textContent = "API protocol";
  const select = document.createElement("select");
  select.id = "worker-api-protocol";
  const options: Array<{ value: "auto" | "legacy" | "v2"; label: string }> = [
    { value: "auto", label: "Auto-detect (Recommended for OpenCode 2.0.22)" },
    { value: "legacy", label: "Legacy (OpenCode 1.x compatible)" },
    { value: "v2", label: "v2 (OpenCode 2.0.22 / 2.0.x)" }
  ];
  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    optionEl.selected = option.value === value;
    select.appendChild(optionEl);
  }
  select.addEventListener("change", () => {
    onChange(select.value as "auto" | "legacy" | "v2");
  });
  const hint = el("span", "hint");
  hint.textContent =
    'Auto-detect or v2 is recommended for OpenCode 2.0.22. Pin "Legacy" if this session is also opened in OpenCode 1.x Desktop.';
  wrap.append(label, select, hint);
  return wrap;
}
