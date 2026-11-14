/**
 * Rule 12 — deterministic delivery verification in the RelayVerifier.
 * planner-to-worker: identity-based lookup in the worker session (exact target id / content hash).
 * worker-to-planner: adapter attestation (fake/test adapter) or honest "unverified" (live adapter).
 */
import { describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { StaticOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { RelayVerifier } from "../src/relay/verifier.js";
import { hashText } from "../src/util/canonical.js";
import { makePair } from "./helpers.js";
import type { RelayableMessage } from "../src/types.js";

function record(overrides: Partial<{
  direction: "planner-to-worker" | "worker-to-planner";
  sourceMessageId: string;
  sourceHash: string;
  targetId: string | undefined;
}> = {}) {
  return {
    id: 1,
    pairId: "kisab-main",
    direction: overrides.direction ?? "planner-to-worker",
    sourceMessageId: overrides.sourceMessageId ?? "msg-1",
    sourceHash: overrides.sourceHash ?? hashText("Deliver this"),
    status: "DELIVERING" as const,
    firstSeenAt: new Date().toISOString(),
    attemptCount: 1,
    verifyAttemptCount: 1,
    ...(overrides.targetId !== undefined ? { targetId: overrides.targetId } : {})
  };
}

const userMessage: RelayableMessage = {
  id: "user-1",
  source: "planner",
  role: "user",
  text: "Deliver this\n\n⟦relay:22222222-2222-2222-2222-222222222222 20260831T100000Z⟧",
  createdAt: Date.now()
};

describe("RelayVerifier (Rule 12)", () => {
  it("verifies planner-to-worker delivery by exact target id", async () => {
    const worker = new StaticOpenCodeAdapter([userMessage]);
    const planner = new FakeChatGPTBrowserAdapter();
    const verifier = new RelayVerifier({ worker, planner });
    const result = await verifier.verify(makePair(), record({ targetId: "user-1", sourceHash: hashText("anything else") }));
    expect(result).toEqual({ verified: true, targetId: "user-1" });
  });

  it("verifies planner-to-worker delivery by content hash with the watermark stripped", async () => {
    const worker = new StaticOpenCodeAdapter([userMessage]);
    const planner = new FakeChatGPTBrowserAdapter();
    const verifier = new RelayVerifier({ worker, planner });
    const result = await verifier.verify(makePair(), record({ sourceHash: hashText("Deliver this") }));
    expect(result).toEqual({ verified: true, targetId: "user-1" });
  });

  it("reports unverified when the worker session has no matching user message", async () => {
    const worker = new StaticOpenCodeAdapter([{ id: "assistant-1", source: "worker", role: "assistant", text: "unrelated" }]);
    const planner = new FakeChatGPTBrowserAdapter();
    const verifier = new RelayVerifier({ worker, planner });
    const result = await verifier.verify(makePair(), record({}));
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("No user message matching");
  });

  it("attests worker-to-planner delivery via the adapter and reports unverified without evidence", async () => {
    const planner = new FakeChatGPTBrowserAdapter();
    await planner.sendWorkerMessage(makePair().planner, {
      id: "rep-1",
      source: "worker",
      role: "assistant",
      text: "Worker report",
      createdAt: Date.now()
    });
    const worker = new StaticOpenCodeAdapter();
    const verifier = new RelayVerifier({ worker, planner });
    const ok = await verifier.verify(makePair(), record({ direction: "worker-to-planner", sourceHash: hashText("Worker report") }));
    expect(ok.verified).toBe(true);
    const missing = await verifier.verify(makePair(), record({ direction: "worker-to-planner", sourceHash: hashText("Different report") }));
    expect(missing.verified).toBe(false);
  });
});
