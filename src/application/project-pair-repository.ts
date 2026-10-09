/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/project-pair-repository.ts
 * Purpose: Project-pair identity / ownership service.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { parseProjectPairsConfig } from "../sessions/project-pairs.js";
import type { ProjectPair, ProjectPairsConfig } from "../types.js";

export type ProjectPairConfigErrorCode =
  | "CONFIG_UNREADABLE"
  | "CONFIG_INVALID"
  | "CONFIG_UNWRITABLE"
  | "PROJECT_PAIR_NOT_FOUND"
  | "PROJECT_PAIR_ALREADY_EXISTS"
  | "DUPLICATE_OWNERSHIP";

export class ProjectPairRepositoryError extends Error {
  readonly code: ProjectPairConfigErrorCode;

  constructor(code: ProjectPairConfigErrorCode, message: string) {
    super(message);
    this.name = "ProjectPairRepositoryError";
    this.code = code;
  }
}

/**
 * UI-independent repository over the project pairs config file.
 *
 * Mirrors PairConfigRepository: preserves unrelated project pairs, validates
 * before every write, enforces unique projectPairId / OpenCode repoPath /
 * ChatGPT projectSlug ownership. Writes use a same-directory temp file +
 * atomic rename so a crash mid-write never corrupts the config.
 */
export class ProjectPairRepository {
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
      throw new ProjectPairRepositoryError(
        "CONFIG_UNREADABLE",
        `Project pairs config file is not readable: ${messageOf(error)}`
      );
    }
  }

  async load(): Promise<ProjectPairsConfig> {
    let raw: string;
    try {
      raw = await readFile(this.configPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { projectPairs: [] };
      }
      throw new ProjectPairRepositoryError(
        "CONFIG_UNREADABLE",
        `Project pairs config file is not readable: ${messageOf(error)}`
      );
    }

    try {
      return parseProjectPairsConfig(JSON.parse(raw));
    } catch (error) {
      throw new ProjectPairRepositoryError(
        "CONFIG_INVALID",
        `Project pairs config file is invalid: ${messageOf(error)}`
      );
    }
  }

  async addProjectPair(pair: ProjectPair): Promise<ProjectPairsConfig> {
    return this.mutate(async () => {
      const current = await this.load();
      if (current.projectPairs.some((existing) => existing.projectPairId === pair.projectPairId)) {
        throw new ProjectPairRepositoryError(
          "PROJECT_PAIR_ALREADY_EXISTS",
          `Project pair "${pair.projectPairId}" already exists.`
        );
      }
      const next = { projectPairs: [...current.projectPairs, pair] };
      this.assertNoOwnershipConflict(next.projectPairs, pair);
      await this.save(next.projectPairs);
      return next;
    });
  }

  async updateProjectPair(
    projectPairId: string,
    edits: {
      worker?: { repoPath?: string; projectId?: string };
      planner?: { projectSlug?: string; projectName?: string };
    }
  ): Promise<ProjectPairsConfig> {
    return this.mutate(async () => {
      const current = await this.load();
      const existing = current.projectPairs.find((pair) => pair.projectPairId === projectPairId);
      if (!existing) {
        throw new ProjectPairRepositoryError(
          "PROJECT_PAIR_NOT_FOUND",
          `Project pair "${projectPairId}" does not exist.`
        );
      }
      const worker = edits.worker
        ? {
            ...existing.worker,
            ...(edits.worker.repoPath !== undefined ? { repoPath: edits.worker.repoPath } : {}),
            ...(edits.worker.projectId !== undefined ? { projectId: edits.worker.projectId } : {})
          }
        : existing.worker;
      const planner = edits.planner
        ? {
            ...existing.planner,
            ...(edits.planner.projectSlug !== undefined ? { projectSlug: edits.planner.projectSlug } : {}),
            ...(edits.planner.projectName !== undefined ? { projectName: edits.planner.projectName } : {})
          }
        : existing.planner;
      const updated: ProjectPair = { projectPairId: existing.projectPairId, worker, planner };
      const next = {
        projectPairs: current.projectPairs.map((pair) => (pair.projectPairId === projectPairId ? updated : pair))
      };
      this.assertNoOwnershipConflict(next.projectPairs, updated);
      await this.save(next.projectPairs);
      return next;
    });
  }

  async removeProjectPair(projectPairId: string): Promise<ProjectPairsConfig> {
    return this.mutate(async () => {
      const current = await this.load();
      if (!current.projectPairs.some((pair) => pair.projectPairId === projectPairId)) {
        throw new ProjectPairRepositoryError(
          "PROJECT_PAIR_NOT_FOUND",
          `Project pair "${projectPairId}" does not exist.`
        );
      }
      const next = { projectPairs: current.projectPairs.filter((pair) => pair.projectPairId !== projectPairId) };
      await this.save(next.projectPairs);
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

  private assertNoOwnershipConflict(pairs: ProjectPair[], candidate: ProjectPair): void {
    const conflicts: string[] = [];
    for (const other of pairs) {
      if (other.projectPairId === candidate.projectPairId) {
        continue;
      }
      if (other.worker.repoPath === candidate.worker.repoPath) {
        conflicts.push(
          `OpenCode project "${candidate.worker.repoPath}" is already paired to "${other.projectPairId}".`
        );
      }
      if (other.planner.projectSlug === candidate.planner.projectSlug) {
        conflicts.push(
          `ChatGPT project "${candidate.planner.projectSlug}" is already paired to "${other.projectPairId}".`
        );
      }
    }
    if (conflicts.length > 0) {
      throw new ProjectPairRepositoryError("DUPLICATE_OWNERSHIP", conflicts.join(" "));
    }
  }

  private async save(pairs: ProjectPair[]): Promise<void> {
    const config: ProjectPairsConfig = { projectPairs: pairs };
    try {
      parseProjectPairsConfig(config);
    } catch (error) {
      throw new ProjectPairRepositoryError(
        "CONFIG_INVALID",
        `Refusing to write invalid config: ${messageOf(error)}`
      );
    }

    const directory = dirname(this.configPath);
    const tempPath = join(directory, `.project-pairs.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      // Owner-only: project pairs reference repositories and worker endpoints (mode is a no-op on Windows).
      await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.configPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw new ProjectPairRepositoryError(
        "CONFIG_UNWRITABLE",
        `Project pairs config file is not writable: ${messageOf(error)}`
      );
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
