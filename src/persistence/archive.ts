import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type {
  PairRelayState,
  RelayCycle,
  RelayRecord,
  RuntimeMetadata,
  SupervisorContinuity
} from "../types.js";

export interface ArchivedConfigSnapshot {
  pairId: string;
  enabled: boolean;
  projectPairId?: string;
  worker: {
    type: string;
    sessionId: string;
    repoPath: string;
    server?: { baseUrl?: string };
  };
  planner: {
    type: string;
    conversationId: string;
    conversationUrl: string;
    browser?: { cdpUrl?: string };
  };
}

export interface ArchivedPairPayload {
  pairId: string;
  archivedAt: string;
  config: ArchivedConfigSnapshot;
  records: RelayRecord[];
  cycles: RelayCycle[];
  state: {
    pair?: PairRelayState;
    supervisor?: SupervisorContinuity;
    runtime?: RuntimeMetadata;
  };
}

export interface ArchivedPairSummary {
  ref: string;
  pairId: string;
  archivedAt: string;
  recordCount: number;
  cycleCount: number;
  hasState: boolean;
}

export interface ArchiveStore {
  init(): Promise<void>;
  archive(payload: ArchivedPairPayload): Promise<string>;
  list(): Promise<ArchivedPairSummary[]>;
  read(ref: string): Promise<ArchivedPairPayload>;
  remove(ref: string): Promise<void>;
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

const EXTENSION = ".json";

/**
 * Filesystem-backed archive. Deleted pair data is moved here as a single JSON
 * artifact per pair. The archive has no index: listing scans the folder, and
 * deleting the file directly on disk (or via the UI) is all that is needed to
 * remove an entry, so a manually deleted artifact leaves no pollution behind.
 */
export class PairArchive implements ArchiveStore {
  private readonly archiveDir: string;
  private initialized = false;

  constructor(archiveDir: string) {
    this.archiveDir = archiveDir;
  }

  async init(): Promise<void> {
    await mkdir(this.archiveDir, { recursive: true });
    this.initialized = true;
  }

  async archive(payload: ArchivedPairPayload): Promise<string> {
    this.assertInitialized();
    const ref = `${artifactRef(payload.pairId, payload.archivedAt)}${EXTENSION}`;
    await writeFile(join(this.archiveDir, ref), JSON.stringify(payload, null, 2), "utf8");
    return ref;
  }

  async list(): Promise<ArchivedPairSummary[]> {
    this.assertInitialized();
    let entries: string[];
    try {
      entries = await readdir(this.archiveDir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
    const summaries: ArchivedPairSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(EXTENSION)) {
        continue;
      }
      const target = this.safeFilePath(entry);
      let text: string;
      try {
        text = await readFile(target, "utf8");
      } catch (error) {
        // The artifact may have been deleted from the folder while scanning.
        // A missing or unreadable file contributes nothing to the listing.
        if (isNotFound(error)) {
          continue;
        }
        throw error;
      }
      let payload: ArchivedPairPayload;
      try {
        payload = JSON.parse(text) as ArchivedPairPayload;
      } catch {
        continue;
      }
      if (!payload || typeof payload !== "object" || typeof payload.pairId !== "string") {
        continue;
      }
      summaries.push(toSummary(entry, payload));
    }
    summaries.sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));
    return summaries;
  }

  async read(ref: string): Promise<ArchivedPairPayload> {
    this.assertInitialized();
    const target = this.safeFilePath(ref);
    let text: string;
    try {
      text = await readFile(target, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        throw new ArchiveError(`Archived pair "${ref}" was not found.`);
      }
      throw error;
    }
    try {
      return JSON.parse(text) as ArchivedPairPayload;
    } catch {
      throw new ArchiveError(`Archived pair "${ref}" is corrupt or not valid JSON.`);
    }
  }

  async remove(ref: string): Promise<void> {
    this.assertInitialized();
    const target = this.safeFilePath(ref);
    // Deleting an archive artifact is idempotent: removing the file directly in
    // the folder first, or having it already deleted, is treated the same.
    await rm(target, { force: true });
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new ArchiveError("Archive directory is not initialized.");
    }
  }

  private safeFilePath(ref: string): string {
    if (typeof ref !== "string" || ref.length === 0 || ref.length > 300) {
      throw new ArchiveError("Invalid archive reference.");
    }
    if (ref !== basename(ref) || !ref.endsWith(EXTENSION)) {
      throw new ArchiveError("Archive reference may not contain path separators.");
    }
    const root = resolve(this.archiveDir);
    const target = resolve(root, ref);
    if (!target.startsWith(root + sep)) {
      throw new ArchiveError("Archive reference escapes the archive directory.");
    }
    return target;
  }
}

function artifactRef(pairId: string, archivedAt: string): string {
  const safePair = pairId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const safeTime = archivedAt.replace(/[:Z]/g, "-").replace(/[^\dT.-]/g, "");
  return `${safePair || "pair"}-${safeTime}`;
}

function toSummary(ref: string, payload: ArchivedPairPayload): ArchivedPairSummary {
  return {
    ref,
    pairId: payload.pairId,
    archivedAt: typeof payload.archivedAt === "string" ? payload.archivedAt : new Date(0).toISOString(),
    recordCount: Array.isArray(payload.records) ? payload.records.length : 0,
    cycleCount: Array.isArray(payload.cycles) ? payload.cycles.length : 0,
    hasState: !!(payload.state && (payload.state.pair || payload.state.supervisor || payload.state.runtime))
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}