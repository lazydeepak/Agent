import { el, errorMessage, formatTime, toast } from "./dom.js";
import { state } from "./view-state.js";

/**
 * Recovery dashboard (v1.1 §12.1).
 *
 * Groups recovery-related incidents into four ordered groups — Requires Attention → Active → Queued → Resolved —
 * newest first within each. Never loads from SQLite directly; reads the merged event timeline via `window.desktop.getTimeline`
 * plus the current pair statuses via `getStatus()`. Cancel/pause semantics reuse pair-level controls (v1.1 §12.2).
 */

export interface RecoveryEvent {
  time: string;
  type: string;
  pairId?: string;
  projectPairId?: string;
  state?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

const MAX_RECOVERY_EVENTS = 400;

const ATTENTION_TYPES = new Set([
  "INTERVENTION_REQUIRED",
  "RECOVERY_EXHAUSTED",
  "RECOVERY_FAILED",
  "RECOVERY_SUSPENDED",
  "AMBIGUOUS_DELIVERY_BLOCKED",
  "STOP_ALL_REQUESTED"
]);

const ACTIVE_TYPES = new Set([
  "RECOVERY_STARTED",
  "RECOVERY_RETRY",
  "PEER_DISCONNECTED",
  "WORKER_SESSION_DISCONNECTED",
  "PLANNER_SESSION_DISCONNECTED"
]);

const RESOLVED_TYPES = new Set([
  "RECOVERY_SUCCEEDED",
  "PAIR_RUNTIME_RECOVERED",
  "AMBIGUOUS_DELIVERY_RECONCILED",
  "RECOVERY_SUSPENSION_RELEASED",
  "RECOVERY_EXHAUSTED",
  "SESSION_RECONNECTED"
]);

let events: RecoveryEvent[] = [];
let loading = false;
let loaded = false;

function isEvent(value: unknown): value is RecoveryEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RecoveryEvent).time === "string" &&
    typeof (value as RecoveryEvent).type === "string"
  );
}

function newest(filtered: RecoveryEvent[]): RecoveryEvent[] {
  return [...filtered].sort((a, b) => b.time.localeCompare(a.time));
}

function pairShort(pairId: string | undefined): string {
  if (!pairId) return "app";
  return pairId.length > 18 ? `${pairId.slice(0, 18)}…` : pairId;
}

function eventTypeLabel(type: string): string {
  if (type === "INTERVENTION_REQUIRED") return "NEEDS OPERATOR";
  if (type === "RECOVERY_SUSPENDED") return "SUSPENDED";
  if (type === "RECOVERY_FAILED") return "FAILED";
  if (type === "RECOVERY_EXHAUSTED") return "RETRY EXHAUSTED";
  if (type === "AMBIGUOUS_DELIVERY_BLOCKED") return "DELIVERY BLOCKED";
  if (type === "STOP_ALL_REQUESTED") return "STOP ALL";
  if (type === "RECOVERY_STARTED") return "RECOVERING";
  if (type === "RECOVERY_RETRY") return "RETRY";
  if (type === "RECOVERY_SUCCEEDED") return "RECOVERED";
  if (type === "PAIR_RUNTIME_RECOVERED") return "RECOVERED";
  if (type === "AMBIGUOUS_DELIVERY_RECONCILED") return "DELIVERY RECONCILED";
  if (type === "RECOVERY_SUSPENSION_RELEASED") return "SUSPENSION RELEASED";
  if (type === "SESSION_RECONNECTED") return "RECONNECTED";
  return type.replace(/_/g, " ");
}

function severity(type: string): "attention" | "active" | "resolved" {
  if (ATTENTION_TYPES.has(type)) return "attention";
  if (ACTIVE_TYPES.has(type)) return "active";
  return "resolved";
}

function emptySection(message: string): HTMLElement {
  const div = el("div", "recovery-empty");
  div.textContent = message;
  return div;
}

function incidentRow(event: RecoveryEvent, callbacks: { onPause: (pairId: string) => void; onRelease: (pairId: string) => void }): HTMLElement {
  const row = el("div", `recovery-row recovery-row-${severity(event.type)}`);

  const meta = el("div", "recovery-row-meta");
  const pair = el("span", "recovery-pair");
  pair.textContent = pairShort(event.pairId);
  pair.title = event.pairId ?? "";
  const type = el("span", `badge ${severity(event.type) === "attention" ? "badge-danger" : severity(event.type) === "resolved" ? "badge-ok" : "badge-neutral"}`);
  type.textContent = eventTypeLabel(event.type);
  const time = el("span", "recovery-time");
  time.textContent = formatTime(event.time);
  meta.append(pair, type, time);

  const reason = el("div", "recovery-reason");
  reason.textContent = event.reason ?? "";
  reason.title = event.reason ?? "";

  const actions = el("div", "recovery-actions");
  if (event.pairId && severity(event.type) !== "resolved") {
    const pause = el("button", "btn btn-sm btn-ghost");
    pause.textContent = "Pause";
    pause.title = "Gracefully pause this pair before the next dispatch";
    pause.addEventListener("click", () => callbacks.onPause(event.pairId!));
    actions.appendChild(pause);
  }
  if (event.pairId && event.type === "RECOVERY_SUSPENDED") {
    const release = el("button", "btn btn-sm btn-primary");
    release.textContent = "Release suspension";
    release.title = "Operator-only release — automated recovery retries after this";
    release.addEventListener("click", () => callbacks.onRelease(event.pairId!));
    actions.appendChild(release);
  }

  row.append(meta, reason, actions);
  return row;
}

function groupSection(title: string, rows: HTMLElement[], emptyMessage: string): HTMLElement {
  const section = el("section", "recovery-group");
  const header = el("div", "recovery-group-title");
  const label = el("span", "recovery-group-name");
  label.textContent = title;
  const count = el("span", "recovery-group-count");
  count.textContent = String(rows.length);
  header.append(label, count);
  section.appendChild(header);
  if (rows.length === 0) {
    section.appendChild(emptySection(emptyMessage));
    return section;
  }
  const list = el("div", "recovery-list");
  for (const row of rows) {
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

export async function refreshRecoveryPanel(): Promise<void> {
  const container = document.getElementById("recovery-panel-content");
  if (!container || loading) {
    return;
  }
  loading = true;
  try {
    const [timeline, status] = await Promise.all([
      window.desktop.getTimeline(undefined, MAX_RECOVERY_EVENTS),
      window.desktop.getStatus().catch(() => ({ pairs: [] as Array<{ pairId: string; supervisorState?: string; recovering?: boolean }> }))
    ]);
    const raw = Array.isArray(timeline) ? timeline.filter(isEvent) : [];
    events = newest(raw);

    const attention = newest(events.filter((event) => ATTENTION_TYPES.has(event.type)));
    const active = newest(events.filter((event) => ACTIVE_TYPES.has(event.type) || event.type.startsWith("RECOVERY_STARTED")));
    const queuedEvents = newest(events.filter((event) =>
      (status.pairs as Array<{ pairId: string; supervisorState?: string; recovering?: boolean }>).some((p) =>
        (p.pairId === event.pairId) && (p.supervisorState === "STUCK" || p.supervisorState === "FAILED")
      ) || event.type === "STUCK_DETECTED" || (event.state === "STUCK" || event.state === "FAILED")
    ));
    const resolved = newest(events.filter((event) => RESOLVED_TYPES.has(event.type)));

    const callbacks = {
      onPause: (pairId: string) => {
        void window.desktop?.pausePair?.(pairId).then(() => refreshRecoveryPanel());
      },
      onRelease: (pairId: string) => {
        void (async () => {
          try {
            if (typeof window.desktop?.releaseRecoverySuspension === "function") {
              await window.desktop.releaseRecoverySuspension(pairId);
              toast(`Recovery suspension released for ${pairId}.`, "ok");
            }
          } catch (error) {
            toast(errorMessage(error), "error");
          }
          void refreshRecoveryPanel();
        })();
      }
    };

    const attentionRows = attention.map((event) => incidentRow(event, callbacks));
    const activeRows = active.map((event) => incidentRow(event, callbacks));
    const queuedRows = queuedEvents.slice(0, 50).map((event) => incidentRow(event, callbacks));
    const resolvedRows = resolved.slice(0, 50).map((event) => incidentRow(event, callbacks));

    container.replaceChildren(
      groupSection("Requires Attention", attentionRows, "Nothing needs operator attention."),
      groupSection("Active", activeRows, "No recovery is in progress."),
      groupSection("Queued", queuedRows, "No pairs are queued or stuck."),
      groupSection("Resolved", resolvedRows, "No recent resolutions.")
    );
    setBadge(attentionRows.length);
    loaded = true;
  } catch (error) {
    const fail = el("div", "result-fail");
    fail.textContent = `Failed to load recovery incidents: ${errorMessage(error)}`;
    container.replaceChildren(fail);
    setBadge(0);
  } finally {
    loading = false;
  }
}

export function initRecoveryPanel(): void {
  document.getElementById("recovery-refresh")?.addEventListener("click", () => {
    void refreshRecoveryPanel();
  });
}

function setBadge(count: number): void {
  const badge = document.getElementById("nav-recovery-count");
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
  }
}
