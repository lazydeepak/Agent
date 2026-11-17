/**
 * Agent-relay codebase — module explanation / info.
 * File: src/recovery/opencode.ts
 * Purpose: Source module for opencode.ts.
 */
import { resolve } from "node:path";
import type { OpenCodeSessionManager } from "../adapters/opencode/index.js";
import type { RecoveryErrorCode } from "../types.js";
import { delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js";

export type OpenCodeServerLauncher = (repoPath: string, baseUrl: string) => Promise<{ endpoint: string; alreadyRunning: boolean }>;

export interface OpenCodeRecoveryInput {
  worker: OpenCodeSessionManager;
  sessionId: string;
  expectedRepoPath: string;
  maxAttempts?: number;
  backoff?: BackoffPolicy;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
  onStartError?: (error: Error) => void;
  startServerLauncher?: OpenCodeServerLauncher;
  onStartAttempt?: (attempt: number) => void;
  baseUrl?: string;
  /** Recovery Agent repair hook for OpenCode outages. Returns true if Recovery Agent authorized an intervention. */
  masterWorkerRepair?: (error: Error) => Promise<boolean>;
  /**
   * v1.1 §9 — verify EVERY potentially affected Worker is idle (busy/unreachable/unobservable is NOT idle).
   * Returns true only when a shared OpenCode restart is verified safe; false means hold with operator notification.
   */
  verifyAllAffectedWorkersIdle?: () => Promise<boolean>;
  /** Optional hook receiving the unsafe-to-restart reason; used to persist the hold + notify. */
  onRestartUnsafeHold?: (reason: string) => void;
  /** Rule 5 step 5 — terminate the OpenCode desktop app (exact image name). Only called when no other worker responds. */
  terminateOpenCodeDesktop?: () => Promise<void>;
  /** Rule 5 step 5 — reopen the OpenCode desktop app after termination. */
  relaunchOpenCodeDesktop?: () => Promise<void>;
  /** How long to wait after relaunch before probing the server again. */
  relaunchSettleMs?: number;
  /** v1.1 §9.3 — a shared restart may not consume more than this long (default 60_000 ms). */
  sharedRestartDeadlineMs?: number;
  /** v1.1 §9.3 — temporarily pause affected pairs before touching shared OpenCode. */
  pauseAffectedPairs?: () => Promise<void>;
  /** v1.1 §9.3 — restore exactly the pairs paused by pauseAffectedPairs, after verified restoration. */
  restoreAffectedPairs?: () => Promise<void>;
  /**
   * v1.1 §9 — authorization to restart the SHARED OpenCode service. When absent or returning
   * false, the restart is refused with a hold + operator notification; it never proceeds.
   * One-time grants are consumed at authorization time by the caller.
   */
  sharedServiceRestartAuthorized?: () => Promise<boolean>;
}

export interface OpenCodeStartOutcome {
  attempted: boolean;
  started: boolean;
  alreadyRunning: boolean;
}

export type OpenCodeRecoveryOutcome =
  | { recovered: true; action: "reconnect-transport" | "reobserve-session" }
  | { recovered: false; code: RecoveryErrorCode; reason: string };

export async function recoverOpenCode(
  input: OpenCodeRecoveryInput
): Promise<OpenCodeRecoveryOutcome> {
  const maxAttempts = input.maxAttempts ?? 3;
  const backoff = input.backoff;
  const sleep = input.sleep ?? interruptibleSleep;

  const healthOk = await recoverTransport({
    worker: input.worker,
    maxAttempts,
    backoff,
    sleep,
    signal: input.signal,
    onRetry: input.onRetry,
    onStartError: input.onStartError,
    startServerLauncher: input.startServerLauncher,
    onStartAttempt: input.onStartAttempt,
    baseUrl: input.baseUrl,
    expectedRepoPath: input.expectedRepoPath,
    masterWorkerRepair: input.masterWorkerRepair,
    verifyAllAffectedWorkersIdle: input.verifyAllAffectedWorkersIdle,
    onRestartUnsafeHold: input.onRestartUnsafeHold,
    terminateOpenCodeDesktop: input.terminateOpenCodeDesktop,
    relaunchOpenCodeDesktop: input.relaunchOpenCodeDesktop,
    relaunchSettleMs: input.relaunchSettleMs,
    sharedRestartDeadlineMs: input.sharedRestartDeadlineMs,
    pauseAffectedPairs: input.pauseAffectedPairs,
    restoreAffectedPairs: input.restoreAffectedPairs,
    sharedServiceRestartAuthorized: input.sharedServiceRestartAuthorized
  });
  if (healthOk !== true) {
    return {
      recovered: false,
      code: "OPENCODE_UNREACHABLE",
      reason: healthOk.message
    };
  }

  let session;
  try {
    session = await input.worker.getSession(input.sessionId);
  } catch (error) {
    return {
      recovered: false,
      code: "OPENCODE_UNREACHABLE",
      reason: `OpenCode session could not be re-read after reconnect: ${readableError(error)}`
    };
  }

  if (session === undefined) {
    return {
      recovered: false,
      code: "OPENCODE_SESSION_MISSING",
      reason: `Configured OpenCode session ${input.sessionId} no longer exists. Agent refuses to rebind to a replacement session.`
    };
  }

  if (session.sessionId !== input.sessionId) {
    return {
      recovered: false,
      code: "OPENCODE_SESSION_MISSING",
      reason: `OpenCode returned session ${session.sessionId}, not the configured ${input.sessionId}.`
    };
  }

  if (session.repoPath && !sameRepoPath(session.repoPath, input.expectedRepoPath)) {
    return {
      recovered: false,
      code: "OPENCODE_REPO_MISMATCH",
      reason: `Configured session is attached to ${session.repoPath}, not ${resolve(input.expectedRepoPath)}.`
    };
  }

  return { recovered: true, action: "reobserve-session" };
}

interface TransportInput {
  worker: OpenCodeSessionManager;
  maxAttempts: number;
  backoff?: BackoffPolicy;
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
  onStartError?: (error: Error) => void;
  startServerLauncher?: OpenCodeServerLauncher;
  onStartAttempt?: (attempt: number) => void;
  baseUrl?: string;
  expectedRepoPath: string;
  masterWorkerRepair?: (error: Error) => Promise<boolean>;
  verifyAllAffectedWorkersIdle?: () => Promise<boolean>;
  onRestartUnsafeHold?: (reason: string) => void;
  terminateOpenCodeDesktop?: () => Promise<void>;
  relaunchOpenCodeDesktop?: () => Promise<void>;
  relaunchSettleMs?: number;
  /** v1.1 §9.3 — a shared restart may not consume more than this long (default 60_000 ms). */
  sharedRestartDeadlineMs?: number;
  /** v1.1 §9.3 — temporarily pause affected pairs before touching shared OpenCode. */
  pauseAffectedPairs?: () => Promise<void>;
  /** v1.1 §9.3 — restore exactly the pairs paused by pauseAffectedPairs, after verified restoration. */
  restoreAffectedPairs?: () => Promise<void>;
  /**
   * v1.1 §9 — authorization to restart the SHARED OpenCode service. When absent or returning
   * false, the restart is refused with a hold + operator notification; it never proceeds.
   * One-time grants are consumed at authorization time by the caller.
   */
  sharedServiceRestartAuthorized?: () => Promise<boolean>;
}

async function recoverTransport(input: TransportInput): Promise<true | { message: string }> {
  let lastError: unknown;
  if (input.signal?.aborted) return { message: "Recovery attempt was cancelled." };
  await tryStartServer(input);

  // Rule 5 retry sequence: attempt once, wait 10 minutes, attempt again.
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    if (input.signal?.aborted) return { message: "Recovery attempt was cancelled." };
    try {
      await input.worker.checkServer();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < input.maxAttempts) {
        const delayMs = delayForAttempt(attempt, input.backoff);
        input.onRetry?.(attempt, delayMs, error instanceof Error ? error : new Error(String(error)));
        try {
          await input.sleep(delayMs, input.signal);
        } catch {
          return { message: "Recovery attempt was cancelled." };
        }
      }
    }
  }

  // Still unreachable — Rule 5: request Recovery Agent before any destructive action.
  if (input.masterWorkerRepair) {
    const approved = await input.masterWorkerRepair(
      lastError instanceof Error ? lastError : new Error(String(lastError))
    );
    if (approved) {
      try {
        await input.worker.checkServer();
        return true;
      } catch (error) {
        lastError = error;
      }
    }
  }

  const baseMessage = `OpenCode server did not become reachable after ${input.maxAttempts} attempts: ${readableError(lastError)}`;

  // v1.1 §9 — authorize BEFORE verifying idle: if the operator has not granted a shared-service
  // restart (or the grant was consumed), hold with an operator notification; the shared service
  // is never restarted and no affected pair is paused. Fail closed.
  if (input.terminateOpenCodeDesktop && input.relaunchOpenCodeDesktop) {
    let authorized = false;
    if (input.sharedServiceRestartAuthorized) {
      try {
        authorized = await input.sharedServiceRestartAuthorized();
      } catch {
        authorized = false;
      }
    }
    if (!authorized) {
      const holdReason = `Awaiting Operator — Shared-Service Restart Not Authorized: no active 'shared-service-restart' permission grant is on file (or it was consumed). OpenCode was NOT restarted and no pair was paused. Grant one-time or permanent permission in Settings → Permissions.`;
      input.onRestartUnsafeHold?.(holdReason);
      return { message: holdReason };
    }
  }

  // v1.1 §9 — terminate/reopen OpenCode ONLY after EVERY potentially affected Worker is verified idle.
  // Active, unreachable, or unobservable is NOT idle. If any affected pair is not idle (or the
  // verification cannot run), the shared service is never restarted — hold and notify the operator.
  let allAffectedIdle = false; // fail closed
  if (input.verifyAllAffectedWorkersIdle) {
    try {
      allAffectedIdle = await input.verifyAllAffectedWorkersIdle();
    } catch {
      allAffectedIdle = false; // unverifiable → never terminate shared OpenCode
    }
  } else {
    allAffectedIdle = false; // no verified-idle probe wired → never terminate
  }
  if (!allAffectedIdle) {
    const holdReason = `Awaiting Operator — Shared-Service Restart Unsafe: not all potentially affected Workers are verified idle (${input.maxAttempts} attempt(s), ${baseMessage}). Shared OpenCode was NOT restarted; unrelated safe work may continue.`;
    input.onRestartUnsafeHold?.(holdReason);
    return {
      message: holdReason
    };
  }

  if (input.terminateOpenCodeDesktop && input.relaunchOpenCodeDesktop) {
    const deadlineMs = input.sharedRestartDeadlineMs ?? 60_000;
    const deadline = Date.now() + deadlineMs;
    input.onRetry?.(
      input.maxAttempts,
      0,
      new Error("No other active pair has a responding Worker; terminating and reopening OpenCode Desktop (Rule 5 step 5).")
    );

    // v1.1 §9.3 — temporarily pause the affected pairs before touching shared OpenCode.
    try {
      await input.pauseAffectedPairs?.();
    } catch {
      // Best-effort: pairs that cannot be paused are left alone; the shared-service decision below still holds the operator notification path.
    }
    if (Date.now() > deadline) {
      const message = `Awaiting Operator — Shared-Service Restart Unsafe: the restart sequence exceeded its configured deadline (${deadlineMs}ms) before termination; OpenCode was NOT restarted. Unrelated safe work may continue.`;
      input.onRestartUnsafeHold?.(message);
      return { message };
    }
    try {
      await input.terminateOpenCodeDesktop();
    } catch (error) {
      await input.restoreAffectedPairs?.().catch(() => undefined);
      return {
        message: `${baseMessage} — OpenCode Desktop termination failed: ${readableError(error)}`
      };
    }
    try {
      await input.relaunchOpenCodeDesktop();
    } catch (error) {
      await input.restoreAffectedPairs?.().catch(() => undefined);
      return {
        message: `${baseMessage} — OpenCode Desktop relaunch failed: ${readableError(error)}`
      };
    }
    try {
      await input.sleep(Math.min(input.relaunchSettleMs ?? 4000, Math.max(0, deadline - Date.now())), input.signal);
    } catch {
      return { message: "Recovery attempt was cancelled." };
    }
    if (Date.now() > deadline) {
      const message = `Awaiting Operator — Shared-Service Restart Unsafe: the relaunched OpenCode did not settle and verify within the configured deadline (${deadlineMs}ms); the affected pairs remain paused and need the operator.`;
      input.onRestartUnsafeHold?.(message);
      return { message };
    }
    try {
      await input.worker.checkServer();
      // v1.1 §9.3 — restore exactly the pairs that were running before the restart.
      await input.restoreAffectedPairs?.().catch(() => undefined);
      return true;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      const message = `Awaiting Operator — Shared-Service Restart Unsafe: the relaunched OpenCode did not verify within the configured deadline (${deadlineMs}ms). The affected pairs remain paused; operator intervention required.`;
      input.onRestartUnsafeHold?.(message);
      return { message };
    }
    return {
      message: `${baseMessage} — all affected Workers were verified idle and OpenCode Desktop was restarted, but the server/Worker session is still unreachable. The affected pair remains visibly paused; operator intervention required.`
    };
  }

  return {
    message: `${baseMessage} — all affected Workers were verified idle, but no OpenCode Desktop control was wired; not terminating processes (v1.1 §9).${
      input.startServerLauncher ? ' (server start attempted)' : ''
    }`
  };
}

async function tryStartServer(
  input: TransportInput
): Promise<OpenCodeStartOutcome | undefined> {
  if (input.startServerLauncher === undefined) {
    return undefined;
  }
  try {
    if (!input.baseUrl) throw new Error("OpenCode recovery requires the configured server endpoint.");
    input.onStartAttempt?.(1);
    const result = await input.startServerLauncher(input.expectedRepoPath, input.baseUrl);
    return { attempted: true, started: result.alreadyRunning === false, alreadyRunning: result.alreadyRunning };
  } catch (error) {
    input.onStartError?.(error instanceof Error ? error : new Error(String(error)));
    return { attempted: true, started: false, alreadyRunning: false };
  }
}

function sameRepoPath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
