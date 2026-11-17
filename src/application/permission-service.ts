/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/permission-service.ts
 * Purpose: v1.1 §11.5 — least-privilege, project/pair-scoped permission grants with
 *          one-time (consumed on use) or permanent modes. Revocation takes effect at
 *          the next admission boundary because every check reads current rows.
 *
 * Grants are operator-approved additional authority. They never widen by default:
 * a scope with zero grants keeps its baseline (approved-model allow-list, pair Stop/Pause).
 */
import { DesktopApplicationError } from "./desktop-service.js";
import type { RelayStore, PermissionGrantRow } from "../persistence/index.js";
import type {
  PermissionGrantDto,
  PermissionGrantInputDto,
  PermissionGrantAction
} from "../contracts/desktop.js";

/** v1.1 §9 — the only global-scope grant in v1: authorizes restarting the shared OpenCode service. */
export const GLOBAL_SCOPE_REF = "shared-opencode";
import type { SessionPair } from "../types.js";

export interface GlobalAuthorization {
  authorized: boolean;
  consumedGrantId?: number;
}

export interface PermissionServiceContext {
  store: RelayStore;
  /**
   * Validates that a grant scope refers to a real project pair or session pair.
   * Returns the trimmed scopeRef when valid; throws DesktopApplicationError otherwise.
   */
  validateScopeRef(scopeType: "project" | "pair", scopeRef: string): string | Promise<string>;
  recordEvent?(
    type: string,
    pairId: string | undefined,
    extras?: { reason?: string; details?: Record<string, unknown> }
  ): void;
}

/** Scope keys a session pair can be granted against, most specific first. */
export function scopeKeysForPair(pair: SessionPair): Array<{ scopeType: "project" | "pair"; scopeRef: string }> {
  const keys: Array<{ scopeType: "project" | "pair"; scopeRef: string }> = [];
  if (pair.projectPairId && pair.projectPairId.trim().length > 0) {
    keys.push({ scopeType: "project", scopeRef: pair.projectPairId });
  }
  keys.push({ scopeType: "pair", scopeRef: pair.pairId });
  return keys;
}

function isActive(row: PermissionGrantRow): boolean {
  if (row.revokedAt) return false;
  if (row.mode === "one-time" && row.consumedAt) return false;
  return true;
}

export class PermissionService {
  constructor(private readonly ctx: PermissionServiceContext) {}

  listForPair(pair: SessionPair): PermissionGrantDto[] {
    const keys = scopeKeysForPair(pair);
    const seen = new Map<number, PermissionGrantDto>();
    for (const key of keys) {
      for (const row of this.ctx.store.listPermissionGrants({ scopeType: key.scopeType, scopeRef: key.scopeRef })) {
        seen.set(row.id, toDto(row));
      }
    }
    return [...seen.values()].sort((a, b) => a.id - b.id);
  }

  listAll(): PermissionGrantDto[] {
    return this.ctx.store.listPermissionGrants().map(toDto);
  }

  async grant(input: PermissionGrantInputDto): Promise<PermissionGrantDto> {
    const scopeType = input?.scopeType;
    const mode = input?.mode;
    const action = input?.action;
    if (scopeType !== "project" && scopeType !== "pair" && scopeType !== "global") {
      throw new DesktopApplicationError("INVALID_INPUT", "Scope type must be 'project', 'pair' or 'global'.");
    }
    if (action !== "model-switch-outside-approved" && action !== "shared-service-restart") {
      throw new DesktopApplicationError("INVALID_INPUT", `Unknown permission action "${String(action)}".`);
    }
    if (mode !== "one-time" && mode !== "permanent") {
      throw new DesktopApplicationError("INVALID_INPUT", "Mode must be 'one-time' or 'permanent'.");
    }
    const rawScopeRef = String(input.scopeRef ?? "").trim();
    if (scopeType === "global") {
      // Least privilege: global scope exists only for the machine-wide shared-service restart.
      if (action !== "shared-service-restart") {
        throw new DesktopApplicationError("INVALID_INPUT", "Global grants are only valid for shared-service-restart.");
      }
      if (rawScopeRef !== GLOBAL_SCOPE_REF) {
        throw new DesktopApplicationError("INVALID_INPUT", `Global grants must use scopeRef '${GLOBAL_SCOPE_REF}'.`);
      }
    }
    if (action === "shared-service-restart" && scopeType !== "global") {
      // The restart is machine-wide; pair/project-scoped grants must never authorize it.
      throw new DesktopApplicationError("INVALID_INPUT", "shared-service-restart grants must use global scope.");
    }
    const scopeRef = scopeType === "global"
      ? GLOBAL_SCOPE_REF
      : await this.ctx.validateScopeRef(scopeType, rawScopeRef);
    const note = typeof input.note === "string" && input.note.trim().length > 0 ? input.note.trim() : undefined;
    const row = this.ctx.store.insertPermissionGrant({
      scopeType,
      scopeRef,
      action,
      mode,
      note
    });
    this.audit("PERMISSION_GRANTED", row.scopeType === "pair" ? row.scopeRef : undefined, {
      grantId: row.id,
      scopeType: row.scopeType,
      scopeRef: row.scopeRef,
      action: row.action,
      mode: row.mode
    });
    return toDto(row);
  }

  revoke(id: number): PermissionGrantDto {
    if (!Number.isInteger(id) || id <= 0) {
      throw new DesktopApplicationError("INVALID_INPUT", "Grant id must be a positive integer.");
    }
    const existing = this.ctx.store.getPermissionGrant(id);
    if (!existing) {
      throw new DesktopApplicationError("NOT_FOUND", `Permission grant ${id} does not exist.`);
    }
    const pairId = existing.scopeType === "pair" ? existing.scopeRef : undefined;
    if (existing.revokedAt) {
      this.audit("PERMISSION_REVOKE_NOOP", pairId, {
        grantId: existing.id,
        scopeType: existing.scopeType,
        scopeRef: existing.scopeRef,
        reason: "already-revoked"
      });
      return toDto(existing);
    }
    const row = this.ctx.store.revokePermissionGrant(id);
    if (!row) {
      throw new DesktopApplicationError("NOT_FOUND", `Permission grant ${id} does not exist.`);
    }
    this.audit("PERMISSION_REVOKED", pairId, {
      grantId: row.id,
      scopeType: row.scopeType,
      scopeRef: row.scopeRef,
      action: row.action,
      mode: row.mode
    });
    return toDto(row);
  }

  /**
   * Finds the most specific active grant for the pair's scopes. Does NOT consume a
   * one-time grant — call consumeForPair() after the authorized action succeeds.
   */
  findActiveGrant(pair: SessionPair, action: PermissionGrantAction): PermissionGrantRow | undefined {
    for (const key of scopeKeysForPair(pair)) {
      const rows = this.ctx.store.listPermissionGrants({ scopeType: key.scopeType, scopeRef: key.scopeRef, action });
      const hit = rows.find(isActive);
      if (hit) return hit;
    }
    return undefined;
  }

  /**
   * v1.1 §9 — authorization for restarting the SHARED OpenCode service.
   * Checks the global 'shared-service-restart' grant; a one-time grant is consumed at
   * authorization time (the grant authorizes the disruption; the outcome is evidence, not authority).
   */
  authorizeGlobal(action: PermissionGrantAction): GlobalAuthorization {
    const rows = this.ctx.store.listPermissionGrants({ scopeType: "global", scopeRef: GLOBAL_SCOPE_REF, action });
    const active = rows.find(isActive);
    if (!active) {
      return { authorized: false };
    }
    if (active.mode === "permanent") {
      return { authorized: true };
    }
    const consumed = this.ctx.store.consumePermissionGrant(active.id);
    if (!consumed) {
      // Lost the race against a concurrent consumer — fail closed.
      return { authorized: false };
    }
    this.audit("PERMISSION_CONSUMED", undefined, {
      grantId: active.id,
      scopeType: "global",
      scopeRef: GLOBAL_SCOPE_REF,
      action,
      mode: "one-time",
      reason: "shared-service-restart authorization"
    });
    return { authorized: true, consumedGrantId: active.id };
  }

  /** Atomically consumes a one-time grant. Permanent grants are left intact. */
  consumeForPair(pair: SessionPair, action: PermissionGrantAction, grantId: number): boolean {
    const row = this.ctx.store.getPermissionGrant(grantId);
    if (!row || row.action !== action) return false;
    if (row.mode === "permanent") return true;
    return this.ctx.store.consumePermissionGrant(grantId);
  }

  private audit(type: string, pairId: string | undefined, details: Record<string, unknown>): void {
    try {
      this.ctx.recordEvent?.(type, pairId, { reason: "permission audit (append-only)", details });
    } catch {
      // The grant/revoke itself already hit durable storage; the event is advisory.
    }
  }
}

function toDto(row: PermissionGrantRow): PermissionGrantDto {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeRef: row.scopeRef,
    action: row.action,
    mode: row.mode,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt,
    note: row.note,
    revokedAt: row.revokedAt,
    consumedAt: row.consumedAt
  };
}
