import type {
  WorkerProgressDto,
  WorkerProgressTimelineEntry,
  WorkerProgressTodo,
  WorkerProgressFileChange
} from "../shared/worker-progress.js";
import { el, escapeHtml } from "./dom.js";
import { state } from "./view-state.js";

let currentProgressTab = "live" as "live" | "plan" | "changes" | "history";
const progressRequestGenerations = new Map<string, number>();

export function showProgressModal(pairId: string): void {
  state.activeProgressPair = pairId;
  document.getElementById("progress-modal")?.classList.remove("hidden");
  const pair = state.pairs.find((p) => p.pairId === pairId);
  const title = document.getElementById("progress-title");
  if (title) {
    title.textContent = pair ? `Worker Progress — ${pairId}` : `Worker Progress — ${pairId}`;
  }
  void refreshWorkerProgress(pairId);
}

export function closeProgressModal(): void {
  state.activeProgressPair = undefined;
  document.getElementById("progress-modal")?.classList.add("hidden");
  renderProgressContent();
}

export async function refreshWorkerProgress(pairId: string, forceRefresh = false): Promise<void> {
  const generation = (progressRequestGenerations.get(pairId) ?? 0) + 1;
  progressRequestGenerations.set(pairId, generation);
  try {
    const dto = await window.desktop.getWorkerProgress(pairId, forceRefresh);
    const currentSessionId = state.pairs.find((pair) => pair.pairId === pairId)?.worker.sessionId;
    if (progressRequestGenerations.get(pairId) !== generation || dto.sessionId !== currentSessionId) {
      return;
    }
    state.workerProgress.set(pairId, dto);
    if (state.activeProgressPair === pairId) {
      renderProgressContent();
    }
  } catch {
    if (progressRequestGenerations.get(pairId) !== generation) {
      return;
    }
    state.workerProgress.delete(pairId);
    renderProgressContent();
  }
}

export function renderProgressContent(): void {
  const content = document.getElementById("progress-tab-content");
  if (!content) return;

  const pairId = state.activeProgressPair;
  if (!pairId) {
    content.innerHTML = '<div class="empty-state">No session selected</div>';
    return;
  }

  const dto = state.workerProgress.get(pairId);
  if (!dto) {
    content.innerHTML = '<div class="empty-state">Loading...</div>';
    return;
  }

  if (currentProgressTab === "live") {
    renderProgressLive(content, dto);
  } else if (currentProgressTab === "plan") {
    renderProgressPlan(content, dto);
  } else if (currentProgressTab === "changes") {
    renderProgressChanges(content, dto);
  } else if (currentProgressTab === "history") {
    renderProgressHistory(content, dto);
  }
}

function renderProgressLive(container: HTMLElement, dto: WorkerProgressDto): void {
  const live = dto.live;
  if (!live) {
    container.innerHTML = '<div class="empty-state">Worker not started yet</div>';
    return;
  }

  let statusColor = "var(--muted)";
  let statusLabel: string = live.state;
  if (live.state === "working") {
    statusColor = "var(--warn)";
    statusLabel = "Working";
  } else if (live.state === "idle") {
    statusColor = "var(--ok)";
    statusLabel = "Idle";
  } else if (live.state === "failed") {
    statusColor = "var(--danger)";
    statusLabel = "Failed";
  } else if (live.state === "disconnected") {
    statusColor = "var(--danger)";
    statusLabel = "Disconnected";
  } else if (live.state === "reconnecting") {
    statusColor = "var(--warn)";
    statusLabel = "Reconnecting";
  } else if (live.state === "waiting") {
    statusColor = "var(--accent)";
    statusLabel = "Waiting";
  } else if (live.state === "completed") {
    statusColor = "var(--ok)";
    statusLabel = "Completed";
  }

  const elapsedStr = live.elapsedMs ? formatElapsed(live.elapsedMs) : "—";
  const taskHtml = live.currentTask
    ? `<div class="progress-live-summary">${escapeHtml(live.currentTask)}</div>`
    : "";
  const staleHtml = live.stale ? '<div class="badge badge-warn">Stale</div>' : "";
  const errorHtml = live.providerError
    ? `<div class="badge badge-danger">${escapeHtml(live.providerError)}</div>`
    : "";
  const inputHtml = live.inputRequired
    ? `<div class="badge badge-accent">${escapeHtml(live.inputRequired)}</div>`
    : "";
  const transportLabel = live.connectionStatus === "connected"
    ? "Connected"
    : live.connectionStatus === "degraded"
      ? "Degraded"
      : "Disconnected";

  container.innerHTML = `
    <div class="progress-live">
      <div class="progress-live-header">
        <span class="progress-status-dot" style="background:${statusColor}"></span>
        <span class="progress-status-label">${statusLabel}</span>
        ${staleHtml}
        ${errorHtml}
        ${inputHtml}
      </div>
      <div class="progress-live-meta">
        <span>Elapsed: ${elapsedStr}</span>
        <span>Tool: ${live.currentTool ? escapeHtml(live.currentTool) : "—"}</span>
        <span>File: ${live.currentFile ? escapeHtml(live.currentFile) : "—"}</span>
        <span>Transport: ${transportLabel}</span>
      </div>
      ${taskHtml}
      ${live.latestResponse ? `<div class="progress-live-response">${escapeHtml(live.latestResponse)}</div>` : ""}
      ${live.latestResponseTruncated ? '<span class="badge badge-neutral">Response truncated</span>' : ""}
    </div>
  `;
}

function renderProgressPlan(container: HTMLElement, dto: WorkerProgressDto): void {
  const plan = dto.plan;
  if (!plan || plan.length === 0) {
    container.innerHTML = '<div class="empty-state">No plan items detected</div>';
    return;
  }

  const todoItems = plan.map((todo) => {
    let statusIcon = "○";
    let statusClass = "progress-todo-pending";
    if (todo.status === "in_progress") {
      statusIcon = "◉";
      statusClass = "progress-todo-active";
    } else if (todo.status === "completed") {
      statusIcon = "✓";
      statusClass = "progress-todo-done";
    } else if (todo.status === "blocked") {
      statusIcon = "⊘";
      statusClass = "progress-todo-failed";
    }
    return `
      <div class="progress-todo-item ${statusClass}">
        <span class="progress-todo-icon">${statusIcon}</span>
        <div class="progress-todo-body">
          <span class="progress-todo-title">${escapeHtml(todo.content)}</span>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = `<div class="progress-plan">${todoItems}</div>`;
}

function renderProgressChanges(container: HTMLElement, dto: WorkerProgressDto): void {
  const changes = dto.changes;
  if (!changes || !changes.files || changes.files.length === 0) {
    container.innerHTML = '<div class="empty-state">No file changes detected</div>';
    return;
  }

  const changeItems = changes.files.map((change) => {
    let changeTypeClass = "progress-change-modified";
    let changeTypeLabel = "Modified";
    if (change.status === "added") {
      changeTypeClass = "progress-change-added";
      changeTypeLabel = "Added";
    } else if (change.status === "deleted") {
      changeTypeClass = "progress-change-deleted";
      changeTypeLabel = "Deleted";
    } else if (change.status === "renamed") {
      changeTypeClass = "progress-change-renamed";
      changeTypeLabel = "Renamed";
    }
    return `
      <div class="progress-change-item ${changeTypeClass}">
        <span class="progress-change-type">${changeTypeLabel}</span>
        <span class="progress-change-path">${escapeHtml(change.path)}</span>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="progress-changes-summary">
      <span>${changes.totalAdditions} additions</span>
      <span>${changes.totalDeletions} deletions</span>
      ${changes.sessionStartedAt ? `<span>Session started ${formatRelative(changes.sessionStartedAt)}</span>` : ""}
    </div>
    <div class="progress-changes">${changeItems}</div>
  `;
}

function renderProgressHistory(container: HTMLElement, dto: WorkerProgressDto): void {
  const timeline = dto.history;
  if (!timeline || timeline.length === 0) {
    container.innerHTML = '<div class="empty-state">No history yet</div>';
    return;
  }

  const entries = timeline.map((entry) => {
    let typeLabel: string = entry.type;
    let typeClass = "progress-timeline-entry";
    if (entry.type === "user_message") {
      typeClass += " progress-timeline-message";
      typeLabel = "User Message";
    } else if (entry.type === "assistant_response") {
      typeClass += " progress-timeline-message";
      typeLabel = "Assistant";
    } else if (entry.type === "tool_call" || entry.type === "tool_result") {
      typeClass += " progress-timeline-tool";
      typeLabel = "Tool";
    } else if (entry.type === "prompt_dispatched") {
      typeClass += " progress-timeline-cycle";
      typeLabel = "Prompt";
    } else if (entry.type === "worker_completed" || entry.type === "delivery_completed") {
      typeClass += " progress-timeline-event";
      typeLabel = "Completed";
    } else if (entry.type === "delivery_failed" || entry.type === "provider_error") {
      typeClass += " progress-timeline-event";
      typeLabel = "Error";
    } else if (entry.type === "input_required") {
      typeClass += " progress-timeline-tool";
      typeLabel = "Input Required";
    }
    const summaryHtml = entry.summary ? `<div class="progress-timeline-summary">${escapeHtml(entry.summary)}</div>` : "";
    const toolHtml = entry.toolName ? `<span class="progress-change-tool">${escapeHtml(entry.toolName)}</span>` : "";
    const errorBadge = entry.isError ? '<span class="badge badge-danger">Error</span>' : "";
    return `
      <div class="${typeClass}">
        <div class="progress-timeline-header">
          <span class="progress-timeline-type">${escapeHtml(typeLabel)} ${toolHtml} ${errorBadge}</span>
          <span class="progress-timeline-time">${formatRelative(entry.timestamp)}</span>
        </div>
        ${summaryHtml}
      </div>
    `;
  }).join("");

  container.innerHTML = `<div class="progress-history">${entries}</div>`;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatRelative(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return "just now";
    const diffSeconds = Math.floor(diffMs / 1000);
    if (diffSeconds < 60) return "just now";
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return timestamp;
  }
}

export function initProgressTabs(): void {
  document.querySelectorAll<HTMLButtonElement>(".progress-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      currentProgressTab = (tab.dataset.tab as "live" | "plan" | "changes" | "history") || "live";
      document.querySelectorAll<HTMLButtonElement>(".progress-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderProgressContent();
    });
  });

  document.getElementById("progress-close")?.addEventListener("click", closeProgressModal);
  document.getElementById("progress-close-footer")?.addEventListener("click", closeProgressModal);
  document.getElementById("progress-refresh")?.addEventListener("click", () => {
    if (state.activeProgressPair) {
      void refreshWorkerProgress(state.activeProgressPair, true);
    }
  });
}
