import { el, errorMessage, formatTime, toast } from "./dom.js";
import { state } from "./view-state.js";

/**
 * Activity Log view.
 *
 * A read-only browser over the durable timeline that core already exposes through
 * `window.desktop.getTimeline`. The renderer never touches the log file or SQLite itself —
 * it only reads the merged (NDJSON + in-memory) event stream and re-renders.
 */

/** Shape returned by `getTimeline`; mirrors `EventRecord` plus supervisor state transitions. */
export interface ActivityEvent {
  time: string;
  type: string;
  pairId?: string;
  projectPairId?: string;
  state?: string;
  previousState?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

type ActivityLevel = "all" | "problems" | "errors";
type ActivitySeverity = "error" | "warn" | "ok" | "info";

/** Cap on retained rows. Mirrors the core event ring buffer so the view stays bounded. */
const MAX_ACTIVITY_EVENTS = 500;

/** Event types that indicate a genuine failure but do not carry a FAILED/ERROR substring. */
const ERROR_TYPES = new Set([
  "STUCK_DETECTED",
  "INTERVENTION_REQUIRED",
  "AMBIGUOUS_DELIVERY",
  "AMBIGUOUS_DELIVERY_BLOCKED",
  "PEER_DISCONNECTED",
  "OPENCODE_SERVER_UNREACHABLE",
  "CHATGPT_RATE_LIMITED",
  "WORKER_SESSION_DISCONNECTED",
  "PLANNER_SESSION_DISCONNECTED"
]);

/** Event types that indicate degraded-but-handled operation. */
const WARN_TYPES = new Set([
  "AMBIGUOUS_DELIVERY_RECONCILED",
  "DUPLICATE_SKIPPED",
  "RELAY_BLOCKED",
  "CHATGPT_SUBMISSION_HELD",
  "PAUSED",
  "WORKER_ATTENTION_OPENED"
]);

let events: ActivityEvent[] = [];
let level: ActivityLevel = "all";
let scope = "";
let query = "";
let follow = true;
let loaded = false;
let loading = false;

/** Live-appended events are rendered newest-first; this tracks what is already on screen. */
function isEvent(value: unknown): value is ActivityEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ActivityEvent).time === "string" &&
    typeof (value as ActivityEvent).type === "string"
  );
}

/** Mirrors the dashboard Error Log predicate so both views agree on what counts as an error. */
export function isErrorEvent(event: ActivityEvent): boolean {
  const type = event.type;
  return (
    type.includes("ERROR") ||
    type.includes("FAILED") ||
    type === "FAIL" ||
    type === "VALIDATION_FAILED" ||
    ERROR_TYPES.has(type)
  );
}

function severityOf(event: ActivityEvent): ActivitySeverity {
  if (isErrorEvent(event)) {
    return "error";
  }
  if (
    WARN_TYPES.has(event.type) ||
    event.type.startsWith("RECOVERY_") ||
    event.type.startsWith("PROJECT_LIFECYCLE_")
  ) {
    return "warn";
  }
  if (
    event.type.includes("RELAYED") ||
    event.type.includes("VALIDATED") ||
    event.type.includes("SUCCEEDED") ||
    event.type.includes("CONNECTED") ||
    event.type.endsWith("SEEDED") ||
    event.type.endsWith("STARTED") ||
    event.type.endsWith("PRIMED") ||
    event.type.endsWith("GENERATING")
  ) {
    return "ok";
  }
  return "info";
}

const SEVERITY_BADGE: Record<ActivitySeverity, string> = {
  error: "badge-failed",
  warn: "badge-degraded",
  ok: "badge-ok",
  info: "badge-neutral"
};

/** Shortens `WORKER_MESSAGE_RELAYED` to `W_MSG_RELAYED` so badges stay a readable width. */
function compactType(type: string): string {
  return type
    .replace(/^WORKER_/, "W_")
    .replace(/^PLANNER_/, "P_")
    .replace(/^PROJECT_/, "PROJ_")
    .replace(/^RECOVERY_/, "REC_");
}

/** `formatTime` drops the date; keep it visible when the event is not from today. */
function activityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = formatTime(iso);
  return sameDay ? time : `${date.toLocaleDateString()} ${time}`;
}

function scopeOf(event: ActivityEvent): string {
  return event.pairId ?? event.projectPairId ?? "System";
}

function matchesLevel(event: ActivityEvent): boolean {
  if (level === "all") {
    return true;
  }
  if (level === "errors") {
    return isErrorEvent(event);
  }
  return severityOf(event) === "error" || severityOf(event) === "warn";
}

function matchesQuery(event: ActivityEvent): boolean {
  if (!query) {
    return true;
  }
  return (
    event.type.toLowerCase().includes(query) ||
    (event.reason ?? "").toLowerCase().includes(query) ||
    scopeOf(event).toLowerCase().includes(query)
  );
}

function matchesScope(event: ActivityEvent): boolean {
  if (!scope) {
    return true;
  }
  const separator = scope.indexOf(":");
  const kind = scope.slice(0, separator);
  const id = scope.slice(separator + 1);
  if (kind === "pair") {
    return event.pairId === id;
  }
  return event.projectPairId === id;
}

function visibleEvents(): ActivityEvent[] {
  return events
    .filter((event) => matchesScope(event) && matchesLevel(event) && matchesQuery(event))
    .slice()
    .reverse();
}

/**
 * Rebuilding the list is the only expensive part of this view, and pushed events can be
 * frequent during a relay cycle. While the panel is hidden we still buffer events and keep
 * the sidebar counter current, but skip the DOM rebuild until the view is opened.
 */
function isActivityVisible(): boolean {
  const panel = document.getElementById("activity-panel");
  return panel !== null && !panel.classList.contains("hidden");
}

function renderSummary(shown: number): void {
  const summary = document.getElementById("activity-summary");
  if (!summary) {
    return;
  }
  const errorCount = events.filter(isErrorEvent).length;
  const parts = [
    `${shown} shown`,
    `${events.length} loaded`,
    `${errorCount} error${errorCount === 1 ? "" : "s"}`
  ];
  if (loading) {
    parts.push("loading…");
  }
  summary.textContent = parts.join(" · ");
  const navCount = document.getElementById("nav-activity-count");
  if (navCount) {
    navCount.textContent = String(errorCount);
    navCount.classList.toggle("sidebar-count-alert", errorCount > 0);
  }
}

function renderRow(event: ActivityEvent): HTMLElement {
  const severity = severityOf(event);
  const entry = el("div", "activity-entry");

  const row = el("div", `history-item activity-row activity-row--${severity}`);

  const time = el("span", "history-time");
  time.textContent = activityTime(event.time);
  time.title = event.time;

  const type = el("span", `history-type badge ${SEVERITY_BADGE[severity]}`);
  type.textContent = compactType(event.type);
  type.title = event.type;

  const label = el("span", "history-label activity-scope");
  label.textContent = scopeOf(event);
  label.title = scopeOf(event);

  row.append(time, type, label);

  if (event.state || event.previousState) {
    const transition = el("span", "activity-transition");
    transition.textContent = `${event.previousState ?? "∅"} → ${event.state ?? "∅"}`;
    row.append(transition);
  }

  const reason = el("span", "history-reason");
  reason.textContent = event.reason || "—";
  reason.title = event.reason ?? "";

  row.append(reason);

  if (event.details && Object.keys(event.details).length > 0) {
    const details = el("pre", "activity-details hidden");
    details.textContent = JSON.stringify(event.details, null, 2);

    const toggle = el("button", "btn btn-ghost btn-sm activity-details-toggle");
    toggle.textContent = "Details";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const expanded = details.classList.toggle("hidden");
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.textContent = expanded ? "Details" : "Hide";
    });
    row.append(toggle);
    entry.append(row, details);
    return entry;
  }

  entry.append(row);
  return entry;
}

function render(): void {
  const list = document.getElementById("activity-list");
  if (!list) {
    return;
  }
  const visible = visibleEvents();
  renderSummary(visible.length);

  if (!isActivityVisible()) {
    return;
  }

  if (visible.length === 0) {
    const empty = el("div", "empty-state");
    empty.textContent = events.length === 0
      ? "No activity recorded yet."
      : "No events match the current filters.";
    list.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of visible) {
    fragment.append(renderRow(event));
  }
  list.replaceChildren(fragment);
}

/** Rebuilds the scope dropdown from the projects/sessions currently loaded in view state. */
function renderScopeOptions(): void {
  const select = document.getElementById("activity-scope") as HTMLSelectElement | null;
  if (!select) {
    return;
  }
  const fragment = document.createDocumentFragment();

  const all = el("option");
  all.value = "";
  all.textContent = "All projects and sessions";
  fragment.append(all);

  for (const project of state.projectPairs) {
    const option = el("option");
    option.value = `project:${project.projectPairId}`;
    option.textContent = `Project · ${project.projectPairId}`;
    fragment.append(option);
  }

  for (const pair of state.pairs) {
    const option = el("option");
    option.value = `pair:${pair.pairId}`;
    option.textContent = `Session · ${pair.pairId}`;
    fragment.append(option);
  }

  select.replaceChildren(fragment);
  // Preserve the active scope when it still refers to a known project/session.
  select.value = Array.from(select.options).some((option) => option.value === scope) ? scope : "";
  if (!select.value) {
    scope = "";
  }
}

function setFollow(enabled: boolean): void {
  follow = enabled;
  const button = document.getElementById("activity-follow");
  if (button) {
    button.textContent = enabled ? "Following" : "Follow";
    button.setAttribute("aria-pressed", String(enabled));
    button.title = enabled
      ? "Scroll to newest event as it arrives"
      : "New events are not scrolled into view";
  }
}

/** Loads the durable timeline. Safe to call repeatedly; concurrent loads are collapsed. */
export async function refreshActivity(): Promise<void> {
  const list = document.getElementById("activity-list");
  if (!list) {
    return;
  }
  if (loading) {
    return;
  }
  loading = true;
  renderSummary(visibleEvents().length);
  try {
    const timeline = await window.desktop.getTimeline(undefined, MAX_ACTIVITY_EVENTS);
    events = timeline.filter(isEvent);
    loaded = true;
    render();
  } catch (error) {
    const fail = el("div", "result-fail");
    fail.textContent = `Failed to load activity: ${errorMessage(error)}`;
    list.replaceChildren(fail);
  } finally {
    loading = false;
    renderSummary(visibleEvents().length);
  }
}

/** Entry point when the sidebar switches to the Activity view. */
export async function openActivityView(): Promise<void> {
  renderScopeOptions();
  if (!loaded) {
    await refreshActivity();
    return;
  }
  render();
}

/**
 * Appends a pushed event to the live tail. Called from the renderer's global event
 * subscription so the view stays current without polling.
 */
export function noteActivityEvent(event: ActivityEvent): void {
  if (!isEvent(event)) {
    return;
  }
  const last = events[events.length - 1];
  if (last && last.time === event.time && last.type === event.type && scopeOf(last) === scopeOf(event)) {
    return;
  }
  events.push(event);
  if (events.length > MAX_ACTIVITY_EVENTS) {
    events.splice(0, events.length - MAX_ACTIVITY_EVENTS);
  }
  loaded = true;
  render();
  if (follow) {
    const list = document.getElementById("activity-list");
    list?.scrollTo({ top: 0 });
  }
}

/** Wires the panel controls. Called once from the renderer's DOMContentLoaded handler. */
export function wireActivityView(): void {
  document.getElementById("activity-refresh")?.addEventListener("click", () => {
    void refreshActivity();
  });

  document.getElementById("activity-follow")?.addEventListener("click", () => {
    setFollow(!follow);
    if (follow) {
      document.getElementById("activity-list")?.scrollTo({ top: 0 });
    }
  });

  document.getElementById("activity-clear")?.addEventListener("click", () => {
    void (async () => {
      await window.desktop.clearTimeline();
      events = [];
      loaded = true;
      render();
      toast("Activity log cleared.");
    })();
  });

  document.getElementById("activity-scope")?.addEventListener("change", (event) => {
    scope = (event.target as HTMLSelectElement).value;
    render();
  });

  document.getElementById("activity-level")?.addEventListener("change", (event) => {
    level = (event.target as HTMLSelectElement).value as ActivityLevel;
    render();
  });

  document.getElementById("activity-search")?.addEventListener("input", (event) => {
    query = (event.target as HTMLInputElement).value.toLowerCase().trim();
    render();
  });

  setFollow(follow);
}