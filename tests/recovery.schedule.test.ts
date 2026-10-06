import { describe, expect, it } from "vitest";
import {
  abortError,
  delayForAttempt,
  interruptibleSleep,
  DEFAULT_BACKOFF_POLICY
} from "../src/recovery/index.js";

describe("recovery backoff schedule", () => {
  it("uses the bounded 1s/2s/5s/10s/30s sequence and caps at the max delay", () => {
    expect(DEFAULT_BACKOFF_POLICY.delaysMs).toEqual([1000, 2000, 5000, 10000, 30000]);

    expect(delayForAttempt(1)).toBe(1000);
    expect(delayForAttempt(2)).toBe(2000);
    expect(delayForAttempt(3)).toBe(5000);
    expect(delayForAttempt(4)).toBe(10000);
    expect(delayForAttempt(5)).toBe(30000);
    expect(delayForAttempt(6)).toBe(30000);
    expect(delayForAttempt(99)).toBe(30000);
  });

  it("honors a custom max delay", () => {
    expect(delayForAttempt(6, { delaysMs: [100, 200, 400], maxDelayMs: 2000 })).toBe(400);
    expect(delayForAttempt(40, { delaysMs: [100, 200, 400], maxDelayMs: 250 })).toBe(250);
  });

  it("aborts an in-flight interruptible sleep when the signal fires", async () => {
    const controller = new AbortController();
    const pending = interruptibleSleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(abortError().message);
  });

  it("resolves an interruptible sleep normally when not aborted", async () => {
    await expect(interruptibleSleep(1)).resolves.toBeUndefined();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(interruptibleSleep(1, controller.signal)).rejects.toThrow(/cancelled/i);
  });
});