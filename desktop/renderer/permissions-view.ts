/**
 * Agent-relay codebase — module explanation / info.
 * File: desktop/renderer/permissions-view.ts
 * Purpose: v1.1 §11.5 — Settings → Permissions card: list, grant, revoke
 *          project/pair-scoped permission grants. All mutations are operator
 *          clicks through typed IPC; nothing here touches storage directly.
 */
import type { PermissionGrantDto, PermissionGrantMode } from "../../src/contracts/desktop.js";
import { toast } from "./dom.js";

const ACTION_LABELS: Record<string, string> = {
  "model-switch-outside-approved": "Model switch (outside approved list)",
  "shared-service-restart": "Shared-service restart (all pairs)"
};

let currentPairs: Array<{ pairId: string; projectPairId?: string }> = [];

function renderStatus(elementId: string, text: string, ok: boolean): void {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = text;
    el.classList.toggle("ok", ok);
    el.classList.toggle("fail", !ok);
  }
}

function scopeLabel(grant: PermissionGrantDto): string {
  return grant.scopeType === "project"
    ? `Project ${grant.scopeRef}`
    : `Pair ${grant.scopeRef}`;
}

function grantState(grant: PermissionGrantDto): { label: string; tone: "ok" | "muted" | "danger" } {
  if (grant.revokedAt) return { label: "Revoked", tone: "danger" };
  if (grant.mode === "one-time" && grant.consumedAt) return { label: "One-time · used", tone: "muted" };
  return { label: "Active", tone: "ok" };
}

export async function refreshPermissionsCard(): Promise<void> {
  const list = document.getElementById("permissions-list");
  if (!list) return;
  if (typeof window.desktop?.listPermissionGrants !== "function") {
    renderStatus("permission-status", "Permissions are not available in this build.", false);
    return;
  }
  try {
    const grants = await window.desktop.listPermissionGrants();
    list.replaceChildren();
    if (!grants || grants.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-hint";
      empty.textContent = "No permission grants. Baseline authority applies: approved-model allow-list and the pair Stop/Pause controls.";
      list.appendChild(empty);
      return;
    }
    for (const grant of [...grants].sort((a, b) => b.id - a.id)) {
      const row = document.createElement("div");
      row.className = "permission-row";
      const info = document.createElement("div");
      info.className = "permission-row-info";
      const state = grantState(grant);
      const modeLabel = grant.mode === "one-time" ? "One-time" : "Permanent";
      const actionLabel = ACTION_LABELS[grant.action] ?? grant.action;
      info.innerHTML = `<span class="permission-scope">${escapeHtmlC(scopeLabel(grant))}</span>
        <span class="permission-action">${escapeHtmlC(actionLabel)}</span>
        <span class="permission-mode">${modeLabel}</span>
        <span class="permission-state permission-state--${state.tone}">${state.label}</span>`;
      const meta = document.createElement("div");
      meta.className = "permission-row-meta";
      const when = new Date(grant.grantedAt).toLocaleString();
      meta.textContent = `granted ${when}${grant.note ? ` · ${grant.note}` : ""}${grant.revokedAt ? ` · revoked ${new Date(grant.revokedAt).toLocaleString()}` : ""}`;
      info.appendChild(meta);
      row.appendChild(info);
      if (!grant.revokedAt && !(grant.mode === "one-time" && grant.consumedAt)) {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "btn btn-danger btn-sm";
        revoke.textContent = "Revoke";
        revoke.addEventListener("click", async () => {
          revoke.disabled = true;
          try {
            await window.desktop.revokePermission(grant.id);
            toast(`Permission #${grant.id} revoked; new admissions are blocked immediately.`, "ok");
            await refreshPermissionsCard();
          } catch (error) {
            revoke.disabled = false;
            renderStatus("permission-status", `Revoke failed: ${errorMessage(error)}`, false);
          }
        });
        row.appendChild(revoke);
      }
      list.appendChild(row);
    }
  } catch (error) {
    renderStatus("permission-status", `Failed to load permissions: ${errorMessage(error)}`, false);
  }
}

export async function initPermissionsCard(): Promise<void> {
  const pairSelect = document.getElementById("permission-pair-select") as HTMLSelectElement | null;
  const actionSelect = document.getElementById("permission-action-select") as HTMLSelectElement | null;
  const modeSelect = document.getElementById("permission-mode-select") as HTMLSelectElement | null;
  const noteInput = document.getElementById("permission-note-input") as HTMLInputElement | null;
  const grantButton = document.getElementById("permission-grant") as HTMLButtonElement | null;
  if (!pairSelect || !actionSelect || !modeSelect || !grantButton) return;

  // Load pair choices for the grant form. The scope list follows the selected action:
  // restart grants are machine-wide (single global option); model-switch grants are per pair/project.
  try {
    const pairs = typeof window.desktop?.listPairs === "function" ? await window.desktop.listPairs() : [];
    currentPairs = (pairs ?? []).map((pair) => ({
      pairId: pair.pairId,
      projectPairId: pair.projectPairId
    }));
  } catch {
    currentPairs = [];
  }

  const rebuildScopeOptions = (action: string): void => {
    if (action === "shared-service-restart") {
      pairSelect.innerHTML = `<option value="global:shared-opencode">Machine (shared OpenCode) — all pairs</option>`;
      return;
    }
    const options: string[] = [];
    for (const pair of currentPairs) {
      options.push(`<option value="pair:${escapeHtmlC(pair.pairId)}">Pair ${escapeHtmlC(pair.pairId)}</option>`);
      if (pair.projectPairId) {
        options.push(`<option value="project:${escapeHtmlC(pair.projectPairId)}">Project ${escapeHtmlC(pair.projectPairId)}</option>`);
      }
    }
    pairSelect.innerHTML = options.length > 0 ? options.join("") : `<option value="">No pairs configured</option>`;
  };
  actionSelect.addEventListener("change", () => rebuildScopeOptions(actionSelect.value));
  rebuildScopeOptions(actionSelect.value);

  grantButton.addEventListener("click", async () => {
    const choice = pairSelect.value;
    const [scopeTypeRaw, scopeRef] = choice.split(":", 2);
    const scopeType = scopeTypeRaw === "project" ? "project" : scopeTypeRaw === "pair" ? "pair" : undefined;
    if (!scopeType || !scopeRef) {
      renderStatus("permission-status", "Pick a project or pair to grant.", false);
      return;
    }
    const action = actionSelect.value as "model-switch-outside-approved";
    const mode = modeSelect.value as PermissionGrantMode;
    const note = noteInput?.value.trim() ? noteInput.value.trim() : undefined;
    grantButton.disabled = true;
    try {
      if (typeof window.desktop?.grantPermission !== "function") {
        renderStatus("permission-status", "Granting is not available in this build.", false);
        return;
      }
      const grant = await window.desktop.grantPermission({ scopeType, scopeRef, action, mode, note });
      renderStatus("permission-status", `Grant #${grant.id} recorded (${mode}). Revocation is immediate and audit-logged.`, true);
      if (noteInput) noteInput.value = "";
      await refreshPermissionsCard();
    } catch (error) {
      renderStatus("permission-status", `Grant failed: ${errorMessage(error)}`, false);
    } finally {
      grantButton.disabled = false;
    }
  });

  await refreshPermissionsCard();
}

function escapeHtmlC(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
