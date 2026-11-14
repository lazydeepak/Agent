/**
 * Agent codebase — module explanation / info.
 * File: src/application/approved-models.ts
 * Purpose: Restrict worker model switching to the operator-approved allow list in
 * `config/models.local.json`. Models outside the list require explicit operator approval.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ApprovedModelEntry {
  provider: string;
  id: string;
  name?: string;
  free?: boolean;
}

export function loadApprovedModels(): ApprovedModelEntry[] {
  const path = process.env.AGENT_APPROVED_MODELS_PATH ?? resolve("config", "models.local.json");
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { models?: ApprovedModelEntry[] };
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch {
    return [];
  }
}

export function isModelApproved(providerId: string, modelId: string): boolean {
  const provider = (providerId ?? "").trim().toLowerCase();
  const id = (modelId ?? "").trim().toLowerCase();
  if (!provider || !id) return false;
  return loadApprovedModels().some((entry) => {
    const eProvider = String(entry.provider ?? "").trim().toLowerCase();
    const eId = String(entry.id ?? "").trim().toLowerCase();
    return eProvider === provider && (eId === id || id.startsWith(eId) || eId.startsWith(id));
  });
}
