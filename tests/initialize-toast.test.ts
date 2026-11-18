import { describe, expect, it } from "vitest";
import { initOutcome } from "../desktop/renderer/initialize-toast.js";

describe("initOutcome", () => {
  it("reports a ready pair as ok", () => {
    expect(initOutcome("ipm001", { status: "READY", checks: [] })).toEqual({
      tone: "ok",
      message: 'Pair "ipm001" initialized: ready for relay.'
    });
  });

  it("lists every non-PASS check with its reason when not ready", () => {
    const outcome = initOutcome("ipm001", {
      status: "NOT_READY",
      checks: [
        { name: "worker.serverReachable", status: "FAIL", reason: 'server requires authentication — run "Connect OpenCode…" in Agent Settings' },
        { name: "worker.sessionExists", status: "FAIL", reason: "session was not found" },
        { name: "planner.browser", status: "PASS", reason: "cdp connected" }
      ]
    });
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toContain("2 checks need attention");
    expect(outcome.message).toContain("worker.serverReachable");
    expect(outcome.message).toContain("Connect OpenCode");
    expect(outcome.message).toContain("worker.sessionExists");
    expect(outcome.message).not.toContain("planner.browser");
  });

  it("never hides a non-READY status with no failing evidence", () => {
    const outcome = initOutcome("ipm001", { status: "NOT_READY", checks: [{ name: "planner.browser", status: "PASS", reason: "cdp connected" }] });
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toContain('status "NOT_READY"');
    expect(outcome.message).not.toBe('Pair "ipm001" initialized with warnings.');
  });

  it("handles a missing or malformed report without pretending success", () => {
    const outcome = initOutcome("ipm001", undefined);
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toContain('status "unknown"');
    const empty = initOutcome("ipm001", {});
    expect(empty.tone).toBe("error");
    expect(empty.message).toContain('status "unknown"');
  });
});
