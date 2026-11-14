/**
 * Agent codebase — module explanation / info.
 * File: src/util/process-lock.ts
 * Purpose: Advisory file-based process lock for one-runner ownership — PID liveness, stale-lock clearing, LockHeldError. Consolidated from TerminalBot/RelayLoop.
 */

import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";

export class LockHeldError extends Error {
  constructor(readonly lockPath: string, readonly ownerPid: number) {
    super(`Lock already held: ${lockPath} (pid ${ownerPid})`);
    this.name = "LockHeldError";
  }
}

export interface ProcessLockOptions {
  /** Override the PID recorded (defaults to process.pid). Useful for tests. */
  pid?: number;
}

export class ProcessLock {
  private readonly lockPath: string;
  private readonly pid: number;
  private held = false;

  constructor(lockPath: string, options: ProcessLockOptions = {}) {
    this.lockPath = lockPath;
    this.pid = options.pid ?? process.pid;
  }

  /** Acquire the lock. Throws LockHeldError if another live process holds it. */
  acquire(): void {
    if (this.held) return;

    // Clear a stale lock left by a dead process.
    if (existsSync(this.lockPath)) {
      const owner = readOwnerPid(this.lockPath);
      if (owner !== undefined && isProcessAlive(owner) && owner !== this.pid) {
        throw new LockHeldError(this.lockPath, owner);
      }
      // Stale or self-owned: remove and recreate.
      try {
        unlinkSync(this.lockPath);
      } catch {
        // ignore
      }
    }

    let fd: number;
    try {
      fd = openSync(this.lockPath, "wx");
    } catch (error) {
      // Race: another process created it in the meantime.
      const owner = existsSync(this.lockPath) ? readOwnerPid(this.lockPath) : undefined;
      if (owner !== undefined && isProcessAlive(owner)) {
        throw new LockHeldError(this.lockPath, owner);
      }
      // Retry once after clearing.
      try {
        if (existsSync(this.lockPath)) unlinkSync(this.lockPath);
      } catch {
        // ignore
      }
      fd = openSync(this.lockPath, "wx");
    }

    try {
      writeFileSync(fd, `${this.pid}\n${Date.now()}\n`);
    } finally {
      closeSync(fd);
    }
    this.held = true;
  }

  /** Release the lock, removing the lock file if we own it. */
  release(): void {
    if (!this.held) return;
    try {
      const owner = readOwnerPid(this.lockPath);
      if (owner === this.pid || owner === undefined) {
        unlinkSync(this.lockPath);
      }
    } catch {
      // ignore
    }
    this.held = false;
  }

  isHeld(): boolean {
    return this.held;
  }
}

function readOwnerPid(lockPath: string): number | undefined {
  try {
    const content = readFileSync(lockPath, "utf8");
    const firstLine = content.split("\n")[0]?.trim();
    if (!firstLine) return undefined;
    const pid = Number(firstLine);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process; EPERM = exists but no permission.
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === "EPERM";
  }
}
