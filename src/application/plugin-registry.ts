/**
 * Agent codebase — module explanation / info.
 * File: src/application/plugin-registry.ts
 * Purpose: Declarative plugin registry: validate manifests, install/config/persist, disabled-by-default, incompatible on entrypoint. Consolidated from Bot (relay-beacon).
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  permissions?: string[];
  entrypoint?: string;
}

export type PluginState = "installed-disabled" | "installed-enabled" | "incompatible";

export interface PluginRecord {
  manifest: PluginManifest;
  state: PluginState;
  installedAt: string;
  config?: Record<string, unknown>;
}

export interface PluginRegistryStore {
  load(): PluginRecord[];
  save(records: PluginRecord[]): void;
}

export class PluginRegistry {
  private records: PluginRecord[] = [];

  constructor(private readonly store: PluginRegistryStore) {
    this.records = this.store.load();
  }

  validate(manifest: unknown): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!manifest || typeof manifest !== "object") errors.push("manifest must be an object");
    const m = manifest as Partial<PluginManifest>;
    if (!m.id || typeof m.id !== "string") errors.push("id is required");
    if (!m.name || typeof m.name !== "string") errors.push("name is required");
    if (!m.version || typeof m.version !== "string") errors.push("version is required");
    return { ok: errors.length === 0, errors };
  }

  install(manifest: PluginManifest): PluginRecord {
    const validation = this.validate(manifest);
    if (!validation.ok) throw new Error(`Invalid manifest: ${validation.errors.join(", ")}`);
    const existing = this.records.find((r) => r.manifest.id === manifest.id);
    if (existing) throw new Error(`Plugin already installed: ${manifest.id}`);
    const record: PluginRecord = {
      manifest,
      state: manifest.entrypoint ? "incompatible" : "installed-disabled",
      installedAt: new Date().toISOString()
    };
    this.records.push(record);
    this.persist();
    return record;
  }

  enable(id: string): PluginRecord {
    const record = this.records.find((r) => r.manifest.id === id);
    if (!record) throw new Error(`Unknown plugin: ${id}`);
    if (record.state === "incompatible") throw new Error(`Plugin is incompatible: ${id}`);
    record.state = "installed-enabled";
    this.persist();
    return record;
  }

  disable(id: string): PluginRecord {
    const record = this.records.find((r) => r.manifest.id === id);
    if (!record) throw new Error(`Unknown plugin: ${id}`);
    if (record.state !== "incompatible") record.state = "installed-disabled";
    this.persist();
    return record;
  }

  list(): PluginRecord[] {
    return [...this.records];
  }

  get(id: string): PluginRecord | undefined {
    return this.records.find((r) => r.manifest.id === id);
  }

  private persist(): void {
    this.store.save(this.records);
  }
}
