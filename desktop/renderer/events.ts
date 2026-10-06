import { el } from "./dom.js";
import { filterEvents, peerStatusLabel, validationSummaryClass } from "./state.js";
import type { EventRecordDto, ValidationResultDto } from "../shared/dto.js";
import { state } from "./view-state.js";

/** Events and validation diagnostic views. Extracted from the renderer; depends only on leaves. */

export function renderValidation(validation: ValidationResultDto): HTMLElement {
  const box = el("div", "validation-box");
  const summary = el("div", "validation-summary");
  const dot = el("span", `state-dot ${validation.status === "READY" ? "dot-ok" : "dot-warn"}`);
  const label = el("span", validationSummaryClass(validation.status));
  label.textContent = validation.status;
  summary.appendChild(dot);
  summary.appendChild(label);
  box.appendChild(summary);
  const checks = el("div", "validation-checks");
  for (const check of validation.checks) {
    const line = el("div", "check-line");
    const name = el("span", "check-name");
    name.textContent = check.name;
    const result = el("span", check.status === "PASS" ? "check-pass" : "check-fail");
    result.textContent = check.status;
    line.appendChild(name);
    line.appendChild(result);
    checks.appendChild(line);
  }
  box.appendChild(checks);
  return box;
}

export function renderEvents(): void {
  const list = document.getElementById("events-list");
  const count = document.getElementById("event-count");
  const navCount = document.getElementById("nav-event-count");
  if (!list) return;
  if (count) count.textContent = `${state.events.length} events`;
  if (navCount) navCount.textContent = String(state.events.length);
  const fragment = document.createDocumentFragment();
  for (const event of filterEvents(state.events)) fragment.appendChild(renderEvent(event));
  list.replaceChildren(fragment);
}

export function renderEvent(event: EventRecordDto): HTMLElement {
  const row = el("div", `event-row ${event.type}`);
  const time = el("span", "event-time");
  time.textContent = formatTime(event.time);
  const pair = el("span", "event-pair");
  pair.textContent = event.pairId ?? event.projectPairId ?? "runtime";
  const type = el("span", "event-type");
  type.textContent = event.type;
  const reason = el("span", "event-reason");
  reason.textContent = event.reason ?? "";
  row.appendChild(time);
  row.appendChild(pair);
  row.appendChild(type);
  row.appendChild(reason);
  return row;
}

export function humanizePeer(
  label: string,
  health: string,
  activity: "idle" | "working" | undefined,
  recovering: boolean,
  failureReason?: "transport" | "session"
): string {
  if (health === "unknown") {
    return "—";
  }
  return `${label}: ${peerStatusLabel(health, activity, recovering, failureReason)}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
