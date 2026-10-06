import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { parsePairsConfig } from "../sessions/pairs.js";
import type { PairsConfig, SessionPair } from "../types.js";

export type PairConfigErrorCode =
  | "CONFIG_UNREADABLE"
  | "CONFIG_INVALID"
  | "CONFIG_UNWRITABLE"
  | "PAIR_NOT_FOUND"
  | "PAIR_ALREADY_EXISTS"
  | "DUPLICATE_OWNERSHIP"
  | "IMMUTABLE_PAIR_ID"
  | "PROJECT_REPO_MISMATCH";

export class PairConfigError extends Error {
  readonly code: PairConfigErrorCode;

  constructor(code: PairConfigErrorCode, message: string) {
    super(message);
    this.name = "PairConfigError";
    this.code = code;
  }
}

export interface PairEdits {
  worker?: Partial<SessionPair["worker"]>;
  planner?: Partial<SessionPair["planner"]>;
  enabled?: boolean;
  localAgentMode?: boolean;
}

/**
 * UI-independent repository over the shared pairs config file.
 *
 * Preserves the exact PairsConfig format shared with the CLI, preserves unrelated
 * pairs, validates before every write, enforces unique pairId / OpenCode sessionId /
 * ChatGPT conversationId ownership, and treats pairId as immutable on edit.
 * Writes use a same-directory temp file + atomic rename so a crash mid-write never
 * corrupts the config. Paths are resolved with node:path so behavior is cross-platform.
 */
export class PairConfigRepository {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly configPath: string) {}

  get path(): string {
    return this.configPath;
  }

  async exists(): Promise<boolean> {
    try {
      await readFile(this.configPath, "utf8");
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }
      throw new PairConfigError("CONFIG_UNREADABLE", `Config file is not readable: ${messageOf(error)}`);
    }
  }

  async load(): Promise<PairsConfig> {
    let raw: string;
    try {
      raw = await readFile(this.configPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { pairs: [] };
      }
      throw new PairConfigError("CONFIG_UNREADABLE", `Config file is not readable: ${messageOf(error)}`);
    }

    try {
      return parsePairsConfig(JSON.parse(raw));
    } catch (error) {
      throw new PairConfigError("CONFIG_INVALID", `Config file is invalid: ${messageOf(error)}`);
    }
  }

  async addPair(pair: SessionPair): Promise<PairsConfig> {
    return this.mutate(async () => {
      const current = await this.load();
      if (current.pairs.some((existing) => existing.pairId === pair.pairId)) {
        throw new PairConfigError("PAIR_ALREADY_EXISTS", `Pair "${pair.pairId}" already exists.`);
      }
      const repoPath = pair.worker.repoPath?.trim();
      if (pair.projectPairId && repoPath) {
        const companionPath = join(dirname(this.configPath), "projects.local.json");
        try {
          const { readFile } = await import("node:fs/promises");
          const raw = await readFile(companionPath, "utf8");
          const parsed = JSON.parse(raw) as { projectPairs?: Array<{ projectPairId: string; opencode: { repoPath: string } }> };
          const projected = parsed.projectPairs?.find((p) => p.projectPairId === pair.projectPairId);
          if (projected) {
            const projectRepo = resolve(projected.opencode.repoPath);
            const resolvedRepo = resolve(repoPath);
            if (resolvedRepo !== projectRepo) {
              throw new PairConfigError(
                "PROJECT_REPO_MISMATCH",
                `Pair "${pair.pairId}" project identity "${pair.projectPairId}" expects repo "${projectRepo}" but repoPath is "${resolvedRepo}". Correct either the repository or the project context.`
              );
            }
          }
        } catch (throwable) {
          if (throwable instanceof PairConfigError) throw throwable;
        }
      }
      const next = { pairs: [...current.pairs, pair] };
      this.assertNoOwnershipConflict(next.pairs, pair, pair.pairId);
      await this.save(next.pairs);
      return next;
    });
  }

  async updatePair(pairId: string, edits: PairEdits): Promise<PairsConfig> {
    if ("pairId" in edits && edits.pairId !== undefined && edits.pairId !== pairId) {
      throw new PairConfigError(
        "IMMUTABLE_PAIR_ID",
        "pairId is immutable after creation because persistence is keyed by pairId."
      );
    }
    return this.mutate(async () => {
      const current = await this.load();
      const existing = current.pairs.find((pair) => pair.pairId === pairId);
      if (!existing) {
        throw new PairConfigError("PAIR_NOT_FOUND", `Pair "${pairId}" does not exist.`);
      }
      const newRepoPath = edits.worker?.repoPath?.trim();
      if (newRepoPath && newRepoPath !== existing.worker.repoPath && existing.projectPairId) {
        const resolvedRepo = resolve(newRepoPath);
        const existingRepo = resolve(existing.worker.repoPath ?? "");
        if (resolvedRepo !== existingRepo) {
          const companionPath = join(dirname(this.configPath), "projects.local.json");
          try {
            const { readFile } = await import("node:fs/promises");
            const raw = await readFile(companionPath, "utf8");
            const parsed = JSON.parse(raw) as { projectPairs?: Array<{ projectPairId: string; opencode: { repoPath: string } }> };
            const projected = parsed.projectPairs?.find((p) => p.projectPairId === existing.projectPairId);
            if (projected) {
              const projectRepo = resolve(projected.opencode.repoPath);
              if (resolvedRepo !== projectRepo) {
                throw new PairConfigError(
                  "PROJECT_REPO_MISMATCH",
                  `Changing repository from "${existingRepo}" to "${resolvedRepo}" conflicts with project identity "${existing.projectPairId}" (expected repo: "${projectRepo}"). Reassign the project or correct the repository first.`
                );
              }
            }
          } catch (throwable) {
            if (throwable instanceof PairConfigError) throw throwable;
            // If companion config unreadable, allow edit (operator must correct explicitly)
          }
        }
      }
      const worker = edits.worker
        ? {
            ...existing.worker,
            ...edits.worker,
            ...(edits.worker.server
              ? { server: { ...existing.worker.server, ...edits.worker.server } }
              : {})
          }
        : existing.worker;
      const planner = edits.planner
        ? {
            ...existing.planner,
            ...edits.planner,
            ...(edits.planner.browser
              ? { browser: { ...existing.planner.browser, ...edits.planner.browser } }
              : {})
          }
        : existing.planner;
      const updated: SessionPair = {
        pairId: existing.pairId,
        enabled: edits.enabled ?? existing.enabled,
        worker,
        planner,
        localAgentMode: edits.localAgentMode ?? existing.localAgentMode,
        projectPairId: existing.projectPairId
      };
      const next = { pairs: current.pairs.map((pair) => (pair.pairId === pairId ? updated : pair)) };
      this.assertNoOwnershipConflict(next.pairs, updated, pairId);
      await this.save(next.pairs);
      return next;
    });
  }

  async removePair(pairId: string): Promise<PairsConfig> {
    return this.mutate(async () => {
      const current = await this.load();
      if (!current.pairs.some((pair) => pair.pairId === pairId)) {
        throw new PairConfigError("PAIR_NOT_FOUND", `Pair "${pairId}" does not exist.`);
      }
      const next = { pairs: current.pairs.filter((pair) => pair.pairId !== pairId) };
      await this.save(next.pairs);
      return next;
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private assertNoOwnershipConflict(pairs: SessionPair[], candidate: SessionPair, excludePairId?: string): void {
    const conflicts: string[] = [];
    for (const other of pairs) {
      if (excludePairId && other.pairId === excludePairId) {
        continue;
      }
      if (other.worker.sessionId === candidate.worker.sessionId) {
        conflicts.push(
          `OpenCode session "${candidate.worker.sessionId}" is already paired to "${other.pairId}".`
        );
      }
      if (other.planner.conversationId === candidate.planner.conversationId) {
        conflicts.push(
          `ChatGPT conversation "${candidate.planner.conversationId}" is already paired to "${other.pairId}".`
        );
      }
    }
    if (conflicts.length > 0) {
      throw new PairConfigError("DUPLICATE_OWNERSHIP", conflicts.join(" "));
    }
  }

  private async save(pairs: SessionPair[]): Promise<void> {
    const config: PairsConfig = { pairs };
    try {
      parsePairsConfig(config);
    } catch (error) {
      throw new PairConfigError("CONFIG_INVALID", `Refusing to write invalid config: ${messageOf(error)}`);
    }

    const directory = dirname(this.configPath);
    const tempPath = join(directory, `.pairs.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      // Pair config can carry server passwords: keep it owner-only (mode is a no-op on Windows).
      await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.configPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw new PairConfigError("CONFIG_UNWRITABLE", `Config file is not writable: ${messageOf(error)}`);
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
