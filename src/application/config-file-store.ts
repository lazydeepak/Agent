/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/config-file-store.ts
 * Purpose: Shared machinery for the pair-config and project-pair-config file repositories.
 * Extracted so the two repositories cannot drift on the security-relevant write path (atomic
 * rename, owner-only mode) and the serialized mutation queue. Public behavior unchanged.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Serializes mutations behind a tail promise: `run` queues after any in-flight mutation,
 * returns each operation's outcome, and never lets one failure poison the queue.
 */
export class MutationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

/**
 * Atomic config write: same-directory temp file (owner-only mode) + rename, so a crash
 * mid-write can never leave a half-written config. Cleans up the temp file on failure.
 */
export async function atomicWriteJson(configPath: string, value: unknown, tempPrefix: string): Promise<void> {
  const directory = dirname(configPath);
  const tempPath = join(directory, `${tempPrefix}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error(`Config file is not writable: ${messageOf(error)}`);
  }
}
