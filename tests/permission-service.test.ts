import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPECTED_SCHEMA_VERSION,
  SqliteRelayStore
} from "../src/persistence/index.js";
import { PermissionService, scopeKeysForPair } from "../src/application/permission-service.js";
import { DesktopApplicationError } from "../src/application/desktop-service.js";
import type { SessionPair } from "../src/types.js";
import { createTestDesktopService } from "./helpers.js";

const tempDirs: string[] = [];
const originalApprovedModelsPath = process.env.AGENT_APPROVED_MODELS_PATH;
const originalSettingsPath = process.env.AGENT_SETTINGS_PATH;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  if (originalApprovedModelsPath === undefined) delete process.env.AGENT_APPROVED_MODELS_PATH;
  else process.env.AGENT_APPROVED_MODELS_PATH = originalApprovedModelsPath;
  if (originalSettingsPath === undefined) delete process.env.AGENT_SETTINGS_PATH;
  else process.env.AGENT_SETTINGS_PATH = originalSettingsPath;
});

async function freshStore(): Promise<{ dbPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-perm-"));
  tempDirs.push(directory);
  return { dbPath: join(directory, "agent.sqlite") };
}

const makePair = (pairId: string, overrides: Partial<SessionPair> = {}): SessionPair => ({
  pairId,
  enabled: true,
  worker: {
    type: "opencode",
    sessionId: `ses_worker_${pairId}`,
    repoPath: `/Users/x/${pairId}`,
    server: { baseUrl: "http://127.0.0.1:4096" }
  },
  planner: {
    type: "chatgpt-browser",
    conversationId: `planner-${pairId}`,
    conversationUrl: `https://chatgpt.com/c/planner-${pairId}`
  },
  ...overrides
});

describe("SqliteRelayStore — v17 permission_grants", () => {
  it("advances the schema to v17 and creates permission_grants", async () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe(18);
    const { dbPath } = await freshStore();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    const snapshot = store.diagnosticsSnapshot();
    expect(snapshot.schemaVersion).toBe(18);
    const counts = store.tableCounts();
    expect(counts).toHaveProperty("permission_grants", 0);
    store.close();
  });

  it("migrates a v17 database forward to v18 preserving grants", async () => {
    const { dbPath } = await freshStore();
    // Hand-build a v17 database: legacy CHECK constraints, one pair-scoped grant.
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE permission_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('project', 'pair')),
        scope_ref TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('model-switch-outside-approved')),
        mode TEXT NOT NULL CHECK (mode IN ('one-time', 'permanent')),
        granted_by TEXT NOT NULL DEFAULT 'operator',
        granted_at TEXT NOT NULL,
        note TEXT,
        revoked_at TEXT,
        consumed_at TEXT
      );
      CREATE INDEX idx_permission_grants_scope ON permission_grants (scope_type, scope_ref, action);
      INSERT INTO permission_grants (scope_type, scope_ref, action, mode, granted_by, granted_at, note)
        VALUES ('pair', 'kisab-main', 'model-switch-outside-approved', 'one-time', 'operator', '2026-11-14T00:00:00.000Z', 'keep me');
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (17);
    `);
    raw.close();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    const check = new DatabaseSync(dbPath);
    expect((check.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(18);
    check.close();
    expect(store.tableCounts()).toHaveProperty("permission_grants", 1);
    const grants = store.listPermissionGrants();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ scopeRef: "kisab-main", action: "model-switch-outside-approved", note: "keep me" });
    // Widened actions now insert cleanly.
    const created = store.insertPermissionGrant({
      scopeType: "global",
      scopeRef: "shared-opencode",
      action: "shared-service-restart",
      mode: "permanent"
    });
    expect(created.scopeType).toBe("global");
    store.close();
  });

  it("migrates a v16 database forward without losing data", async () => {
    const { dbPath } = await freshStore();
    const first = new SqliteRelayStore(dbPath);
    await first.init();
    first.createRecord({ pairId: "p1", direction: "worker-to-planner", sourceMessageId: "m1", sourceHash: "h1" });
    first.close();
    const second = new SqliteRelayStore(dbPath);
    await second.init();
    expect(second.listRecords("p1")).toHaveLength(1);
    expect(second.tableCounts()).toHaveProperty("permission_grants", 0);
    second.close();
  });

  it("keeps the original required tables for pre-v17 backup compatibility", async () => {
    const { dbPath } = await freshStore();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    expect(store.requiredTablesExist()).toBe(true);
    store.close();
  });

  it("consumes a one-time grant exactly once", async () => {
    const { dbPath } = await freshStore();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    const grant = store.insertPermissionGrant({
      scopeType: "pair",
      scopeRef: "kisab-main",
      action: "model-switch-outside-approved",
      mode: "one-time"
    });
    expect(grant.id).toBeGreaterThan(0);
    expect(store.consumePermissionGrant(grant.id)).toBe(true);
    expect(store.consumePermissionGrant(grant.id)).toBe(false);
    const row = store.getPermissionGrant(grant.id);
    expect(row?.consumedAt).toBeTruthy();
    store.close();
  });

  it("refuses to consume a revoked one-time grant", async () => {
    const { dbPath } = await freshStore();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    const grant = store.insertPermissionGrant({
      scopeType: "pair",
      scopeRef: "kisab-main",
      action: "model-switch-outside-approved",
      mode: "one-time"
    });
    store.revokePermissionGrant(grant.id);
    expect(store.consumePermissionGrant(grant.id)).toBe(false);
    store.close();
  });
});

describe("PermissionService", () => {
  async function makeService(options: { validateProjectScope?: (id: string) => boolean | Promise<boolean> } = {}) {
    const { dbPath } = await freshStore();
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    const events: string[] = [];
    const service = new PermissionService({
      store,
      validateScopeRef: (scopeType, scopeRef) => {
        if (scopeType === "pair") {
          if (scopeRef === "kisab-main" || scopeRef === "b-main") return scopeRef;
          throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${scopeRef}".`);
        }
        if (options.validateProjectScope && options.validateProjectScope(scopeRef)) {
          return scopeRef;
        }
        throw new DesktopApplicationError("UNKNOWN_PROJECT_PAIR", `Unknown project pair "${scopeRef}".`);
      },
      recordEvent: (type) => {
        events.push(type);
      }
    });
    return { service, store, events };
  }

  it("validates scope and action inputs", async () => {
    const { service, store } = await makeService();
    await expect(service.grant({ scopeType: "org" as never, scopeRef: "x", action: "model-switch-outside-approved", mode: "one-time" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.grant({ scopeType: "pair", scopeRef: "nope", action: "model-switch-outside-approved", mode: "one-time" }))
      .rejects.toMatchObject({ code: "UNKNOWN_PAIR" });
    await expect(service.grant({ scopeType: "project", scopeRef: "proj-1", action: "model-switch-outside-approved", mode: "permanent" }))
      .rejects.toMatchObject({ code: "UNKNOWN_PROJECT_PAIR" });
    await expect(service.grant({ scopeType: "pair", scopeRef: "kisab-main", action: "delete-repo" as never, mode: "one-time" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    store.close();
  });

  it("grants pair-scoped one-time permission and reports scope keys for pairs with projectPairId", async () => {
    const pair = makePair("kisab-main", { projectPairId: "proj-1" });
    expect(scopeKeysForPair(pair)).toEqual([
      { scopeType: "project", scopeRef: "proj-1" },
      { scopeType: "pair", scopeRef: "kisab-main" }
    ]);
    const { service, store, events } = await makeService({ validateProjectScope: (id) => id === "proj-1" });
    const pairGrant = await service.grant({ scopeType: "pair", scopeRef: "kisab-main", action: "model-switch-outside-approved", mode: "one-time" });
    const projectGrant = await service.grant({ scopeType: "project", scopeRef: "proj-1", action: "model-switch-outside-approved", mode: "permanent", note: "vendor trial" });
    expect(pairGrant.mode).toBe("one-time");
    expect(projectGrant.scopeType).toBe("project");
    const forPair = service.listForPair(pair);
    expect(forPair.map((grant) => grant.id).sort()).toEqual([pairGrant.id, projectGrant.id].sort());
    expect(events).toContain("PERMISSION_GRANTED");
    store.close();
  });

  it("revocation blocks new admission immediately; one-time grants are consumed on use", async () => {
    const pair = makePair("kisab-main");
    const { service, store, events } = await makeService();
    const grant = await service.grant({ scopeType: "pair", scopeRef: "kisab-main", action: "model-switch-outside-approved", mode: "one-time" });
    expect(service.findActiveGrant(pair, "model-switch-outside-approved")?.id).toBe(grant.id);
    expect(service.consumeForPair(pair, "model-switch-outside-approved", grant.id)).toBe(true);
    // Consumed one-time grants are no longer active.
    expect(service.findActiveGrant(pair, "model-switch-outside-approved")).toBeUndefined();
    expect(service.consumeForPair(pair, "model-switch-outside-approved", grant.id)).toBe(false);

    const permanent = await service.grant({ scopeType: "pair", scopeRef: "kisab-main", action: "model-switch-outside-approved", mode: "permanent" });
    expect(service.findActiveGrant(pair, "model-switch-outside-approved")?.id).toBe(permanent.id);
    expect(service.consumeForPair(pair, "model-switch-outside-approved", permanent.id)).toBe(true);
    // Permanent grants are not consumed by use.
    expect(service.findActiveGrant(pair, "model-switch-outside-approved")?.id).toBe(permanent.id);

    service.revoke(permanent.id);
    expect(service.findActiveGrant(pair, "model-switch-outside-approved")).toBeUndefined();
    expect(service.revoke(permanent.id)); // already-revoked is reported, not an error
    expect(events).toContain("PERMISSION_REVOKED");
    store.close();
  });

  it("never leaks grants across pairs", async () => {
    const { service, store } = await makeService();
    await service.grant({ scopeType: "pair", scopeRef: "kisab-main", action: "model-switch-outside-approved", mode: "permanent" });
    expect(service.findActiveGrant(makePair("b-main"), "model-switch-outside-approved")).toBeUndefined();
    store.close();
  });

  it("authorizes the shared-service restart only via the global grant, consuming one-time grants", async () => {
    const { service, store, events } = await makeService();
    expect(service.authorizeGlobal("shared-service-restart").authorized).toBe(false);

    const permanent = await service.grant({ scopeType: "global", scopeRef: "shared-opencode", action: "shared-service-restart", mode: "permanent" });
    expect(service.authorizeGlobal("shared-service-restart").authorized).toBe(true);
    expect(service.authorizeGlobal("shared-service-restart").authorized).toBe(true);
    service.revoke(permanent.id);
    expect(service.authorizeGlobal("shared-service-restart").authorized).toBe(false);

    const oneTime = await service.grant({ scopeType: "global", scopeRef: "shared-opencode", action: "shared-service-restart", mode: "one-time" });
    expect(service.authorizeGlobal("shared-service-restart").authorized).toBe(true);
    expect(service.authorizeGlobal("shared-service-restart").authorized).toBe(false);
    expect(events).toContain("PERMISSION_CONSUMED");
    store.close();
  });

  it("refuses scope/action combinations that don't match the global rule", async () => {
    const { service, store } = await makeService();
    await expect(service.grant({ scopeType: "pair", scopeRef: "kisab-main", action: "shared-service-restart", mode: "one-time" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.grant({ scopeType: "project", scopeRef: "proj-1", action: "shared-service-restart", mode: "permanent" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.grant({ scopeType: "global", scopeRef: "wrong-ref", action: "shared-service-restart", mode: "one-time" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.grant({ scopeType: "global", scopeRef: "shared-opencode", action: "model-switch-outside-approved", mode: "one-time" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    store.close();
  });

  it("revoke of a nonexistent grant fails with NOT_FOUND", async () => {
    const { service, store } = await makeService();
    expect(() => service.revoke(9999)).toThrow(DesktopApplicationError);
    store.close();
  });
});

describe("switchWorkerModel — §11.5 grant enforcement", () => {
  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function makeContext(pairOverrides: Partial<SessionPair> = {}, options: { validateProjectScope?: (id: string) => boolean } = {}) {
    const directory = await mkdtemp(join(tmpdir(), "agent-perm-svc-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "agent.sqlite");
    const modelsPath = join(directory, "models.local.json");
    await writeFile(configPath, JSON.stringify({ pairs: [makePair("kisab-main", pairOverrides)] }), "utf8");
    await writeFile(modelsPath, JSON.stringify({ models: [{ provider: "ollama", id: "small" }] }), "utf8");
    process.env.AGENT_APPROVED_MODELS_PATH = modelsPath;
    process.env.AGENT_SETTINGS_PATH = join(directory, "settings.local.json");
    const switched: Array<{ path: string }> = [];
    const service = createTestDesktopService({
      configPath,
      dbPath,
      pollIntervalMs: 10,
      ...(options.validateProjectScope ? { validateProjectScope: options.validateProjectScope } : {}),
      opencodeFetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/doc") {
          return jsonResponse({ paths: { "/api/session": {}, "/api/model": {} } });
        }
        if (url.pathname === "/api/model") {
          return jsonResponse({ data: [
            { providerID: "ollama", id: "small", name: "Small", enabled: true },
            { providerID: "openrouter", id: "unlisted", name: "Unlisted", enabled: true }
          ] });
        }
        if (url.pathname === "/api/session/ses_worker_kisab-main/model") {
          switched.push({ path: url.pathname });
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/api/session/ses_worker_kisab-main") {
          return jsonResponse({ data: { id: "ses_worker_kisab-main", model: { providerID: "ollama", id: "small" } } });
        }
        return jsonResponse({}, 404);
      }
    });
    return { service, switched, cleanup: () => rm(directory, { force: true, recursive: true }) };
  }

  it("rejects an out-of-approved-list model with no grant", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      await expect(ctx.service.switchWorkerModel("kisab-main", { providerID: "openrouter", id: "unlisted" }))
        .rejects.toMatchObject({ code: "MODEL_NOT_AUTHORIZED" });
      expect(ctx.switched).toHaveLength(0);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("allows an out-of-approved-list switch with a one-time grant, consumed on success", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      const grant = await ctx.service.grantPermission({
        scopeType: "pair",
        scopeRef: "kisab-main",
        action: "model-switch-outside-approved",
        mode: "one-time"
      });
      await ctx.service.switchWorkerModel("kisab-main", { providerID: "openrouter", id: "unlisted" });
      expect(ctx.switched).toEqual([{ path: "/api/session/ses_worker_kisab-main/model" }]);
      // The one-time grant was consumed — the next switch is rejected again.
      await expect(ctx.service.switchWorkerModel("kisab-main", { providerID: "openrouter", id: "unlisted" }))
        .rejects.toMatchObject({ code: "MODEL_NOT_AUTHORIZED" });
      const grants = ctx.service.listPermissionGrants("kisab-main");
      expect(grants.find((g) => g.id === grant.id)?.consumedAt).toBeTruthy();
      const events = ctx.service.getRecentEvents({ pairId: "kisab-main" }).map((event) => event.type);
      expect(events).toContain("PERMISSION_CONSUMED");
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("permanent grants survive the switch; revocation blocks the next one immediately", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      const grant = await ctx.service.grantPermission({
        scopeType: "pair",
        scopeRef: "kisab-main",
        action: "model-switch-outside-approved",
        mode: "permanent"
      });
      await ctx.service.switchWorkerModel("kisab-main", { providerID: "openrouter", id: "unlisted" });
      await ctx.service.switchWorkerModel("kisab-main", { providerID: "openrouter", id: "unlisted" });
      expect(ctx.switched).toHaveLength(2);
      ctx.service.revokePermission(grant.id);
      await expect(ctx.service.switchWorkerModel("kisab-main", { providerID: "openrouter", id: "unlisted" }))
        .rejects.toMatchObject({ code: "MODEL_NOT_AUTHORIZED" });
      expect(ctx.switched).toHaveLength(2);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("authorizes via a project-scoped grant covering the pair's projectPairId", async () => {
    const ctx = await makeContext({ projectPairId: "proj-1" }, { validateProjectScope: (id) => id === "proj-1" });
    try {
      await ctx.service.init();
      await ctx.service.grantPermission({
        scopeType: "project",
        scopeRef: "proj-1",
        action: "model-switch-outside-approved",
        mode: "permanent"
      });
      await ctx.service.switchWorkerModel("kisab-main", { providerID: "openrouter", id: "unlisted" });
      expect(ctx.switched).toEqual([{ path: "/api/session/ses_worker_kisab-main/model" }]);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("sharedServiceRestartAuthorized enforces the global grant at the service boundary", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      expect(ctx.service.sharedServiceRestartAuthorized()).toBe(false);
      const grant = await ctx.service.grantPermission({
        scopeType: "global",
        scopeRef: "shared-opencode",
        action: "shared-service-restart",
        mode: "one-time"
      });
      expect(ctx.service.sharedServiceRestartAuthorized()).toBe(true);
      // One-time grant consumed — the next check fails closed.
      expect(ctx.service.sharedServiceRestartAuthorized()).toBe(false);
      expect(grant.id).toBeGreaterThan(0);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("refuses project-scoped grants when no project registry is wired (fail closed)", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      await expect(ctx.service.grantPermission({
        scopeType: "project",
        scopeRef: "proj-1",
        action: "model-switch-outside-approved",
        mode: "one-time"
      })).rejects.toMatchObject({ code: "PROJECT_SCOPE_UNVALIDATED" });
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });

  it("approved-list switches never consume permissions", async () => {
    const ctx = await makeContext();
    try {
      await ctx.service.init();
      await ctx.service.switchWorkerModel("kisab-main", { providerID: "ollama", id: "small" });
      expect(ctx.switched).toEqual([{ path: "/api/session/ses_worker_kisab-main/model" }]);
      // No grants needed and none created.
      expect(ctx.service.listPermissionGrants("kisab-main")).toEqual([]);
      await ctx.service.shutdown();
    } finally {
      await ctx.cleanup();
    }
  });
});
