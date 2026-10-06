import { describe, expect, it } from "vitest";
import { PlannerSeedingService, type PlannerSeedingContext } from "../src/application/planner-seeding-service.js";
import { UNIVERSAL_PLANNER_PROMPT_VERSION } from "../src/application/universal-planner-prompt.js";
import { LOCAL_AGENT_PLANNER_PROMPT_VERSION } from "../src/application/local-agent-planner-prompt.js";
import type { RuntimeAdapterOptions } from "../src/runtime/index.js";
import type { RelayStore } from "../src/persistence/index.js";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import type { SessionPair } from "../src/types.js";
import { makePair } from "./helpers.js";

interface Calls {
  updates: Array<{ pairId: string; edits: Record<string, unknown> }>;
  events: Array<{ type: string; pairId: string | undefined }>;
}

function fakeStore(): RelayStore {
  return {
    listCycles: () => [],
    listRecords: () => [],
    touchSupervisorState: () => undefined
  } as unknown as RelayStore;
}

function makeService(pair: SessionPair): { svc: PlannerSeedingService; calls: Calls } {
  const calls: Calls = { updates: [], events: [] };
  const ctx: PlannerSeedingContext = {
    relay: true,
    getPairDetail: (id) => (id === pair.pairId ? pair : undefined),
    adapterOptions: () => ({} as RuntimeAdapterOptions),
    assertPairStopped: () => undefined,
    ensureBrowserLocks: () => ({ lockFor: () => ({ run: async (fn: () => Promise<void>) => fn() }) }) as never,
    ensureStore: () => fakeStore(),
    recordEvent: (type, pairId) => {
      calls.events.push({ type, pairId });
    },
    updatePairConfig: async (pairId, edits) => {
      calls.updates.push({ pairId, edits });
    }
  };
  return { svc: new PlannerSeedingService(ctx), calls };
}

describe("PlannerSeedingService", () => {
  it("sends the versioned universal prompt and persists the seeded version", async () => {
    const pair = makePair({ pairId: "p1" });
    const { svc, calls } = makeService(pair);
    const result = await svc.seedPlanner("p1");

    expect(result).toMatchObject({ pairId: "p1", promptVersion: UNIVERSAL_PLANNER_PROMPT_VERSION });
    expect(calls.updates[0]).toMatchObject({
      pairId: "p1",
      edits: {
        planner: {
          automation: { promptVersion: UNIVERSAL_PLANNER_PROMPT_VERSION, seededAt: result.sentAt }
        }
      }
    });
    expect(calls.events.map((event) => event.type)).toContain("PLANNER_SEEDED");
  });

  it("marks a pair local-agent mode after feeding the local prompt", async () => {
    const pair = makePair({ pairId: "p2" });
    const { svc, calls } = makeService(pair);
    const result = await svc.feedLocalAgentPrompt("p2");

    expect(result).toMatchObject({ pairId: "p2", promptVersion: LOCAL_AGENT_PLANNER_PROMPT_VERSION, localAgentMode: true });
    expect(calls.updates).toContainEqual({ pairId: "p2", edits: { localAgentMode: true } });
    expect(calls.events.map((event) => event.type)).toContain("LOCAL_AGENT_PROMPT_FED");
  });

  it("refuses to seed an unknown pair", async () => {
    const pair = makePair({ pairId: "p3" });
    const { svc } = makeService(pair);
    await expect(svc.seedPlanner("missing")).rejects.toMatchObject({ code: "UNKNOWN_PAIR" });
  });

  it("requires a handoff for a relay-mode pair with no history", async () => {
    const pair = makePair({ pairId: "p4" });
    const { svc } = makeService(pair);
    expect(svc.requiresInitialPlannerHandoff("p4")).toBe(true);
  });

  it("never requires a handoff outside relay mode or after history exists", async () => {
    const pair = makePair({ pairId: "p5" });
    const { svc } = makeService(pair);
    expect(svc.requiresInitialPlannerHandoff("p5")).toBe(true);

    const other = makePair({ pairId: "p6" });
    const calls: Calls = { updates: [], events: [] };
    const ctx: PlannerSeedingContext = {
      relay: false,
      getPairDetail: (id) => (id === other.pairId ? other : undefined),
      adapterOptions: () => ({}),
      assertPairStopped: () => undefined,
      ensureBrowserLocks: () => ({} as never),
      ensureStore: () => fakeStore(),
      recordEvent: (type, pairId) => void calls.events.push({ type, pairId }),
      updatePairConfig: async () => undefined
    };
    expect(new PlannerSeedingService(ctx).requiresInitialPlannerHandoff("p6")).toBe(false);
  });
});