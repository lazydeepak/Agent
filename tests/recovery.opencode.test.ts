import { describe, expect, it, vi } from "vitest";
import { recoverOpenCode } from "../src/recovery/index.js";
import { ControllableWorker, makePair, noopSleep } from "./helpers.js";
import type { BackoffPolicy } from "../src/recovery/index.js";

const INSTANT_BACKOFF: BackoffPolicy = { delaysMs: [1, 1, 1] };

describe("recoverOpenCode", () => {
  it("starts once, retries health within the bound, and verifies only the exact bound session without replay", async () => {
    const worker = new ControllableWorker();
    worker.setUnreachable();
    const health = vi.spyOn(worker, "checkServer");
    const session = vi.spyOn(worker, "getSession");
    const forbidden = [vi.spyOn(worker, "createSession"), vi.spyOn(worker, "bindSession"),
      vi.spyOn(worker, "listSessions"), vi.spyOn(worker, "sendPlannerMessage")];
    const start = vi.fn(async () => {
      worker.reachable = true;
      worker.failHealthNext(2);
      return { endpoint: "http://127.0.0.1:4096", alreadyRunning: false };
    });
    const result = await recoverOpenCode({ worker, sessionId: "bound-not-latest", expectedRepoPath: makePair().worker.repoPath,
      baseUrl: "http://127.0.0.1:4096", startServerLauncher: start, maxAttempts: 3, sleep: noopSleep });
    expect(result.recovered).toBe(true);
    expect(start).toHaveBeenCalledExactlyOnceWith(makePair().worker.repoPath, "http://127.0.0.1:4096");
    expect(health).toHaveBeenCalledTimes(3);
    expect(session).toHaveBeenCalledExactlyOnceWith("bound-not-latest");
    for (const spy of forbidden) expect(spy).not.toHaveBeenCalled();
  });

  it("bounds failed startup/reconnect without session lookup, rebinding, or prompt send", async () => {
    const worker = new ControllableWorker();
    worker.setUnreachable();
    const health = vi.spyOn(worker, "checkServer");
    const session = vi.spyOn(worker, "getSession");
    const start = vi.fn(async () => { throw new Error("start failed"); });
    const startError = vi.fn();
    const sleep = vi.fn(noopSleep);
    const result = await recoverOpenCode({ worker, sessionId: "bound-not-latest", expectedRepoPath: makePair().worker.repoPath,
      baseUrl: "http://127.0.0.1:4096", startServerLauncher: start, onStartError: startError, maxAttempts: 3, sleep });
    expect(result).toMatchObject({ recovered: false, code: "OPENCODE_UNREACHABLE" });
    expect(start).toHaveBeenCalledTimes(1);
    expect(startError).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(session).not.toHaveBeenCalled();
    expect(worker.sentPlannerMessages).toHaveLength(0);
  });

  it("rejects a replacement session returned for the bound ID", async () => {
    const worker = new ControllableWorker();
    vi.spyOn(worker, "getSession").mockResolvedValue({ sessionId: "replacement", repoPath: makePair().worker.repoPath });
    await expect(recoverOpenCode({ worker, sessionId: "bound-not-latest", expectedRepoPath: makePair().worker.repoPath }))
      .resolves.toMatchObject({ recovered: false, code: "OPENCODE_SESSION_MISSING" });
    expect(worker.sentPlannerMessages).toHaveLength(0);
  });

  it("reconnects after a temporary disconnect and re-verifies the configured session", async () => {
    const worker = new ControllableWorker();
    worker.failHealthNext(2);
    const retries: number[] = [];

    const outcome = await recoverOpenCode({
      worker,
      sessionId: makePair().worker.sessionId,
      expectedRepoPath: makePair().worker.repoPath,
      maxAttempts: 5,
      backoff: INSTANT_BACKOFF,
      sleep: noopSleep,
      onRetry: (attempt, delayMs) => {
        retries.push(attempt);
        expect(delayMs).toBe(1);
      }
    });

    expect(retries).toEqual([1, 2]);
    expect(outcome).toEqual({ recovered: true, action: "reobserve-session" });
  });

  it("fails with OPENCODE_UNREACHABLE when health never recovers", async () => {
    const worker = new ControllableWorker();
    worker.setUnreachable();
    const retries: number[] = [];

    const outcome = await recoverOpenCode({
      worker,
      sessionId: makePair().worker.sessionId,
      expectedRepoPath: makePair().worker.repoPath,
      maxAttempts: 3,
      backoff: INSTANT_BACKOFF,
      sleep: noopSleep,
      onRetry: (attempt) => retries.push(attempt)
    });

    expect(retries).toEqual([1, 2]);
    expect(outcome.recovered).toBe(false);
    if (!outcome.recovered) {
      expect(outcome.code).toBe("OPENCODE_UNREACHABLE");
    }
  });

  it("rejects when the configured session no longer exists, without rebinding", async () => {
    const worker = new ControllableWorker();
    worker.setSessionMissing();

    const outcome = await recoverOpenCode({
      worker,
      sessionId: makePair().worker.sessionId,
      expectedRepoPath: makePair().worker.repoPath,
      backoff: INSTANT_BACKOFF,
      sleep: noopSleep
    });

    expect(outcome).toMatchObject({
      recovered: false,
      code: "OPENCODE_SESSION_MISSING"
    });
    if (!outcome.recovered) {
      expect(outcome.reason).toContain("no longer exists");
    }
  });

  it("rejects when the re-read session path differs from the configured repo", async () => {
    const worker = new ControllableWorker();
    worker.setRepoMismatch();

    const outcome = await recoverOpenCode({
      worker,
      sessionId: makePair().worker.sessionId,
      expectedRepoPath: makePair().worker.repoPath,
      backoff: INSTANT_BACKOFF,
      sleep: noopSleep
    });

    expect(outcome).toMatchObject({
      recovered: false,
      code: "OPENCODE_REPO_MISMATCH"
    });
    // No silence: a mismatched repo must be surfaced, not silently re-observed.
    if (!outcome.recovered) {
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });

  it("stops retrying immediately when the abort signal fires", async () => {
    const worker = new ControllableWorker();
    worker.setUnreachable();
    const controller = new AbortController();
    controller.abort();

    const outcome = await recoverOpenCode({
      worker,
      sessionId: makePair().worker.sessionId,
      expectedRepoPath: makePair().worker.repoPath,
      maxAttempts: 10,
      backoff: INSTANT_BACKOFF,
      sleep: noopSleep,
      signal: controller.signal
    });

    expect(outcome.recovered).toBe(false);
    if (!outcome.recovered) {
      expect(outcome.code).toBe("OPENCODE_UNREACHABLE");
    }
  });

  it("uses the default bounded backoff when no policy is supplied", async () => {
    const delay = (await import("../src/recovery/index.js")).delayForAttempt;
    expect(delay(1)).toBe(1000);
  });
});
