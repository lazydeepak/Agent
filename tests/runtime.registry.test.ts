import { describe, expect, it } from "vitest";
import { PairRegistry, RegistryError } from "../src/runtime/registry.js";
import { makePair } from "./helpers.js";

const threePairs = () => [
  makePair(),
  makePair({
    pairId: "susankhya-main",
    worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
    planner: {
      type: "chatgpt-browser",
      conversationId: "planner-conversation-2",
      conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
    }
  }),
  makePair({
    pairId: "faminity-main",
    worker: { type: "opencode", sessionId: "ses_worker_3", repoPath: "/Users/lazydeepak/dev/faminity" },
    planner: {
      type: "chatgpt-browser",
      conversationId: "planner-conversation-3",
      conversationUrl: "https://chatgpt.com/c/planner-conversation-3"
    }
  })
];

describe("PairRegistry", () => {
  it("accepts three unique enabled pairs", () => {
    const registry = new PairRegistry(threePairs());
    expect(registry.size).toBe(3);
    expect(registry.enabled()).toHaveLength(3);
    expect(registry.list().map((pair) => pair.pairId)).toEqual([
      "faminity-main",
      "kisab-main",
      "susankhya-main"
    ]);
  });

  it("filters disabled pairs from enabled()", () => {
    const registry = new PairRegistry([
      makePair(),
      makePair({
        pairId: "disabled",
        enabled: false,
        worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/other" },
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-2",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
        }
      })
    ]);
    expect(registry.size).toBe(2);
    expect(registry.enabled()).toHaveLength(1);
  });

  it("rejects a duplicate OpenCode session ownership at runtime", () => {
    const registry = new PairRegistry([makePair()]);
    expect(() =>
      registry.add(
        makePair({
          pairId: "susankhya-main",
          worker: { type: "opencode", sessionId: "ses_worker_1", repoPath: "/Users/lazydeepak/dev/susankhya" }
        })
      )
    ).toThrow(RegistryError);
  });

  it("rejects a duplicate ChatGPT conversation ownership at runtime", () => {
    const registry = new PairRegistry([makePair()]);
    expect(() =>
      registry.add(
        makePair({
          pairId: "susankhya-main",
          worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" }
        })
      )
    ).toThrow(/Duplicate ChatGPT conversation ownership/);
  });

  it("allows shared OpenCode server endpoints", () => {
    expect(() =>
      new PairRegistry([
        makePair({
          worker: {
            type: "opencode",
            sessionId: "ses_worker_1",
            repoPath: "/Users/lazydeepak/dev/kisab",
            server: { baseUrl: "https://opencode.example.test" }
          }
        }),
        makePair({
          pairId: "susankhya-main",
          worker: {
            type: "opencode",
            sessionId: "ses_worker_2",
            repoPath: "/Users/lazydeepak/dev/susankhya",
            server: { baseUrl: "https://opencode.example.test" }
          },
          planner: {
            type: "chatgpt-browser",
            conversationId: "planner-conversation-2",
            conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
          }
        })
      ])
    ).not.toThrow();
  });

  it("allows shared CDP browser endpoints across pairs", () => {
    expect(() =>
      new PairRegistry([
        makePair({
          planner: {
            type: "chatgpt-browser",
            conversationId: "planner-conversation-1",
            conversationUrl: "https://chatgpt.com/c/planner-conversation-1",
            browser: { cdpUrl: "http://127.0.0.1:9222" }
          }
        }),
        makePair({
          pairId: "susankhya-main",
          worker: { type: "opencode", sessionId: "ses_worker_2", repoPath: "/Users/lazydeepak/dev/susankhya" },
          planner: {
            type: "chatgpt-browser",
            conversationId: "planner-conversation-2",
            conversationUrl: "https://chatgpt.com/c/planner-conversation-2",
            browser: { cdpUrl: "http://127.0.0.1:9222" }
          }
        })
      ])
    ).not.toThrow();
  });

  it("supports removal without disturbing the remaining pairs", () => {
    const registry = new PairRegistry(threePairs());
    expect(registry.remove("susankhya-main")?.pairId).toBe("susankhya-main");
    expect(registry.has("susankhya-main")).toBe(false);
    expect(registry.get("kisab-main")?.pairId).toBe("kisab-main");
  });
});