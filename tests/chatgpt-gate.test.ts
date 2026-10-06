import { describe, expect, it } from "vitest";
import { ChatGptSubmissionGate } from "../src/relay/chatgpt-gate.js";

describe("ChatGptSubmissionGate", () => {
  it("allows the first submission for a new pair", () => {
    const gate = new ChatGptSubmissionGate({ minIntervalMs: 1000, now: () => 0, sleep: async () => {} });
    const decision = gate.decide("pair1");
    expect(decision.allowed).toBe(true);
    expect(decision.rateLimited).toBe(false);
  });

  it("holds subsequent submissions within minIntervalMs", () => {
    let now = 0;
    const gate = new ChatGptSubmissionGate({ minIntervalMs: 1000, now: () => now, sleep: async () => {} });
    gate.recordSuccess("pair1");
    now = 500;
    const decision = gate.decide("pair1");
    expect(decision.allowed).toBe(false);
    expect(decision.rateLimited).toBe(false);
    expect(decision.retryAt).toBe(1000);
  });

  it("allows submissions after minIntervalMs elapses", () => {
    let now = 0;
    const gate = new ChatGptSubmissionGate({ minIntervalMs: 1000, now: () => now, sleep: async () => {} });
    gate.recordSuccess("pair1");
    now = 1000;
    const decision = gate.decide("pair1");
    expect(decision.allowed).toBe(true);
    expect(decision.rateLimited).toBe(false);
  });
});
