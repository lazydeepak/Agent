import { describe, expect, it } from "vitest";
import {
  ChatGPTTemporaryLimitError,
  LiveChatGPTBrowserAdapter,
  type ChatGPTBrowserDriver,
  type ChatGPTReadinessProbe
} from "../src/adapters/chatgpt/index.js";
import type { PlannerIdentity, RelayableMessage } from "../src/types.js";

describe("LiveChatGPTBrowserAdapter", () => {
  it("preserves a temporary access limit separately from authentication failure", async () => {
    const retryAt = Date.now() + 60_000;
    const adapter = new LiveChatGPTBrowserAdapter({ probe: { snapshot: async () => { throw new ChatGPTTemporaryLimitError(retryAt); } } });
    expect(await adapter.observePlannerConversation(planner())).toMatchObject({ rateLimitedUntil: retryAt });
  });
  it("marks ChatGPT READY checks as passing when the live probe sees the conversation composer", async () => {
    const adapter = new LiveChatGPTBrowserAdapter({
      probe: probe({
        browserReachable: true,
        authenticated: true,
        conversationReachable: true,
        composerAvailable: true,
        notGenerating: true,
        url: "https://chatgpt.com/c/planner-conversation-1"
      })
    });

    const checks = await adapter.checkReadiness(planner());

    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["planner.browserReachable", "PASS"],
      ["planner.authenticated", "PASS"],
      ["planner.conversationReachable", "PASS"],
      ["planner.composerAvailable", "PASS"],
      ["planner.notGenerating", "PASS"]
    ]);
  });

  it("reports signed-out and unavailable composer states without throwing", async () => {
    const adapter = new LiveChatGPTBrowserAdapter({
      probe: probe({
        browserReachable: true,
        authenticated: false,
        conversationReachable: false,
        composerAvailable: false,
        notGenerating: true,
        url: "https://chatgpt.com/auth/login"
      })
    });

    const checks = await adapter.checkReadiness(planner());

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "planner.authenticated",
        status: "FAIL",
        reason: "ChatGPT browser session appears signed out."
      })
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "planner.composerAvailable",
        status: "FAIL"
      })
    );
  });

  it("turns probe errors into failed readiness checks", async () => {
    const adapter = new LiveChatGPTBrowserAdapter({
      probe: {
        async snapshot() {
          throw new Error("CDP connection refused");
        }
      }
    });

    const checks = await adapter.checkReadiness(planner());

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "planner.browserReachable",
        status: "FAIL",
        reason: "ChatGPT browser was not reachable: CDP connection refused"
      })
    );
  });

  it("reads the latest planner message through the live browser driver", async () => {
    const adapter = new LiveChatGPTBrowserAdapter({
      driver: driver({
        latestMessage: {
          id: "chatgpt-assistant-planner-conversation-1-2",
          source: "planner",
          role: "assistant",
          text: "Continue with the next implementation slice"
        }
      })
    });

    await expect(adapter.getLatestPlannerMessage(planner())).resolves.toMatchObject({
      id: "chatgpt-assistant-planner-conversation-1-2",
      source: "planner",
      role: "assistant",
      text: "Continue with the next implementation slice"
    });
  });

  it("uses one combined browser operation for a planner observation when supported", async () => {
    let combinedCalls = 0;
    const adapter = new LiveChatGPTBrowserAdapter({
      driver: {
        ...driver(),
        async observe() {
          combinedCalls += 1;
          return {
            snapshot: {
              browserReachable: true,
              authenticated: true,
              conversationReachable: true,
              composerAvailable: true,
              notGenerating: true
            },
            latest: {
              id: "assistant-1",
              source: "planner",
              role: "assistant",
              text: "Implement the next bounded task"
            }
          };
        }
      }
    });

    await expect(adapter.observePlannerConversation(planner())).resolves.toMatchObject({
      reachable: true,
      latestPlannerMessageId: "assistant-1"
    });
    expect(combinedCalls).toBe(1);
  });

  it("sends worker messages through the live browser driver and returns a receipt", async () => {
    const sentMessages: RelayableMessage[] = [];
    const adapter = new LiveChatGPTBrowserAdapter({
      driver: driver({ sentMessages })
    });

    const receipt = await adapter.sendWorkerMessage(planner(), {
      id: "worker-msg-1",
      source: "worker",
      role: "assistant",
      text: "Implemented the next slice"
    });

    expect(sentMessages).toHaveLength(1);
    expect(receipt).toMatchObject({
      pairId: "",
      sourceMessageId: "worker-msg-1",
      targetId: "planner-conversation-1",
      delivered: true,
      transport: "chatgpt-browser"
    });
    expect(receipt.deliveredAt).toEqual(expect.any(String));
  });

  it("forwards completed-message events from the browser driver", async () => {
    const adapter = new LiveChatGPTBrowserAdapter({
      driver: {
        ...driver(),
        async *subscribeEvents() {
          yield { type: "planner.message.completed", observedAt: "2026-09-03T00:00:00.000Z", messageId: "assistant-new" };
        }
      }
    });
    const abort = new AbortController();
    const iterator = adapter.subscribePlannerEvents!(planner(), abort.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "planner.message.completed", observedAt: "2026-09-03T00:00:00.000Z", messageId: "assistant-new" }
    });
  });
});

function planner(): PlannerIdentity {
  return {
    type: "chatgpt-browser",
    conversationId: "planner-conversation-1",
    conversationUrl: "https://chatgpt.com/c/planner-conversation-1"
  };
}

function probe(snapshot: Awaited<ReturnType<ChatGPTReadinessProbe["snapshot"]>>): ChatGPTReadinessProbe {
  return {
    async snapshot() {
      return snapshot;
    }
  };
}

function driver(options: {
  latestMessage?: RelayableMessage;
  sentMessages?: RelayableMessage[];
} = {}): ChatGPTBrowserDriver {
  return {
    async snapshot() {
      return {
        browserReachable: true,
        authenticated: true,
        conversationReachable: true,
        composerAvailable: true,
        notGenerating: true,
        url: "https://chatgpt.com/c/planner-conversation-1"
      };
    },
    async latestPlannerMessage() {
      return options.latestMessage;
    },
    async sendMessage(_planner, message) {
      options.sentMessages?.push(message);
    }
  };
}
