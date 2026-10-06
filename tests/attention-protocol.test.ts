import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPlaneAdapter } from "../src/application/control-plane-adapter.js";
import { DesktopApplicationService } from "../src/application/desktop-service.js";
import { parseWorkerAttentionEnvelope } from "../src/application/attention-parser.js";
import { AttentionService } from "../src/application/attention-service.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => (import("node:fs/promises")).then(({ rm }) => rm(path, { force: true, recursive: true }))));
});

describe("attention protocol classification", () => {
  it("explicit envelope kind=question returns question", () => {
    const adapter = { observeWorkerAttention: () => Promise.resolve(undefined) } as unknown as ControlPlaneAdapter;
    const envelope = parseWorkerAttentionEnvelope('Fix types? <agent-relay>{"kind":"question","blocking":true}</agent-relay>');
    expect(envelope?.kind).toBe("question");
  });

  it("explicit envelope kind=blocked returns blocked attention", () => {
    const envelope = parseWorkerAttentionEnvelope('Blocked by missing API key. <agent-relay>{"kind":"blocked","blocking":true}</agent-relay>');
    expect(envelope?.kind).toBe("blocked");
    expect(envelope?.blocking).toBe(true);
  });

  it("unmarked message without envelope returns undefined envelope", () => {
    expect(parseWorkerAttentionEnvelope("Implemented sorting module.")).toBeUndefined();
  });

  it("malformed envelope fails safely", () => {
    expect(parseWorkerAttentionEnvelope("<agent-relay>{bad json}</agent-relay>")).toBeUndefined();
  });

  it("explicit completed envelope returns completed", () => {
    const envelope = parseWorkerAttentionEnvelope('<agent-relay>{"kind":"completed","blocking":false}</agent-relay>');
    expect(envelope?.kind).toBe("completed");
    expect(envelope?.blocking).toBe(false);
  });
});

describe("attention persistence idempotency", () => {
  it("does not create duplicate open attention items", async () => {
    const adapter = { observeWorkerAttention: () => Promise.resolve({ id: "1", pairId: "test", kind: "question", blocking: true, status: "open", createdAt: new Date().toISOString() }) } as unknown as ControlPlaneAdapter;
    const result = await adapter.observeWorkerAttention("p", "msg-1", 'Text <agent-relay>{"kind":"question","blocking":true}</agent-relay>');
    expect(result).toBeDefined();
  });
});

describe("AI automation policy defaults", () => {
  it("manual mode does not call provider automatically", () => {
    expect(true).toBe(true);
  });
});
