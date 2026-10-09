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
    expectedRepoPath: input.expectedRepoPath
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
}

async function recoverTransport(input: TransportInput): Promise<true | { message: string }> {
  let lastError: unknown;
  if (input.signal?.aborted) return { message: "Recovery attempt was cancelled." };
  await tryStartServer(input);

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

  return {
    message: `OpenCode server did not become reachable after ${input.maxAttempts} attempts: ${readableError(lastError)}${
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
