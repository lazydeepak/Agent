import { describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { StaticOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { extractModelInstruction, relayPlannerToWorker, relayWorkerToPlanner } from "../src/relay/index.js";
import { makePair } from "./helpers.js";

describe("relayWorkerToPlanner", () => {
  it("delivers the latest worker assistant message to the planner adapter", async () => {
    const worker = new StaticOpenCodeAdapter([
      {
        id: "msg_older",
        source: "worker",
        role: "assistant",
        text: "Earlier result"
      },
      {
        id: "msg_latest",
        source: "worker",
        role: "assistant",
        text: "Final worker result"
      }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    const result = await relayWorkerToPlanner(makePair(), { worker, planner });

    expect(result).toMatchObject({
      pairId: "kisab-main",
      status: "DELIVERED",
      sourceMessage: {
        id: "msg_latest",
        text: "Final worker result"
      },
      receipt: {
        pairId: "kisab-main",
        sourceMessageId: "msg_latest",
        targetId: "planner-conversation-1",
        delivered: true,
        transport: "fake-chatgpt-browser"
      }
    });
    expect(planner.sentMessages[0]?.message.text).toBe("Final worker result");
  });

  it("returns NOOP when the worker session has no assistant message", async () => {
    const result = await relayWorkerToPlanner(makePair(), {
      worker: new StaticOpenCodeAdapter(),
      planner: new FakeChatGPTBrowserAdapter()
    });

    expect(result).toMatchObject({
      pairId: "kisab-main",
      status: "NOOP",
      reason: "No relayable assistant message was found in the OpenCode session."
    });
  });

  it("does not deliver when readiness fails", async () => {
    const planner = new FakeChatGPTBrowserAdapter();
    const result = await relayWorkerToPlanner(
      makePair({
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-1",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-1",
          readiness: {
            "planner.notGenerating": "ChatGPT is still generating."
          }
        }
      }),
      {
        worker: new StaticOpenCodeAdapter([
          {
            id: "msg_latest",
            source: "worker",
            role: "assistant",
            text: "Final worker result"
          }
        ]),
        planner
      }
    );

    expect(result.status).toBe("NOT_READY");
    expect(planner.sentMessages).toHaveLength(0);
  });
});

describe("relayPlannerToWorker", () => {
  it("switches a dedicated model directive and removes it before worker delivery", async () => {
    const worker = new StaticOpenCodeAdapter();
    const switched: unknown[] = [];
    worker.switchSessionModel = async (_worker, model) => { switched.push(model); };
    const planner = new FakeChatGPTBrowserAdapter([{
      id: "planner-model",
      source: "planner",
      role: "user",
      text: "RELAY_MODEL: ollama/qwen3-coder:30b\n\nInspect the repository status."
    }]);

    await expect(relayPlannerToWorker(makePair(), { worker, planner })).resolves.toMatchObject({ status: "DELIVERED" });
    expect(switched).toEqual([{ providerID: "ollama", id: "qwen3-coder:30b" }]);
    expect(worker.sentPlannerMessages[0]?.message.text).toBe("Inspect the repository status.");
  });

  it("recognizes only a first-line exact model directive", () => {
    expect(extractModelInstruction("RELAY_MODEL: ollama/qwen3-coder:30b\nTask")).toEqual({
      model: { providerID: "ollama", id: "qwen3-coder:30b" }, task: "Task"
    });
    expect(extractModelInstruction("Use RELAY_MODEL: ollama/qwen3-coder:30b")).toBeUndefined();
  });

  it("delivers the latest mocked planner message to the worker adapter", async () => {
    const worker = new StaticOpenCodeAdapter();
    const planner = new FakeChatGPTBrowserAdapter([
      {
        id: "planner_older",
        source: "planner",
        role: "user",
        text: "Earlier planner instruction"
      },
      {
        id: "planner_latest",
        source: "planner",
        role: "user",
        text: "Build the next slice"
      }
    ]);

    const result = await relayPlannerToWorker(makePair(), { worker, planner });

    expect(result).toMatchObject({
      pairId: "kisab-main",
      status: "DELIVERED",
      sourceMessage: {
        id: "planner_latest",
        text: "Build the next slice"
      },
      receipt: {
        pairId: "kisab-main",
        sourceMessageId: "planner_latest",
        targetId: "ses_worker_1",
        delivered: true,
        transport: "static-opencode"
      }
    });
    expect(worker.sentPlannerMessages[0]?.message.text).toBe("Build the next slice");
  });

  it("returns NOOP when there is no mocked planner message", async () => {
    const result = await relayPlannerToWorker(makePair(), {
      worker: new StaticOpenCodeAdapter(),
      planner: new FakeChatGPTBrowserAdapter()
    });

    expect(result).toMatchObject({
      pairId: "kisab-main",
      status: "NOOP",
      reason: "No relayable planner message was found."
    });
  });

  it("does not send to OpenCode when readiness fails", async () => {
    const worker = new StaticOpenCodeAdapter();
    const result = await relayPlannerToWorker(
      makePair({
        worker: {
          type: "opencode",
          sessionId: "ses_worker_1",
          repoPath: "/Users/lazydeepak/dev/kisab",
          readiness: {
            "worker.acceptsInput": "OpenCode is busy."
          }
        }
      }),
      {
        worker,
        planner: new FakeChatGPTBrowserAdapter([
          {
            id: "planner_latest",
            source: "planner",
            role: "user",
            text: "Build the next slice"
          }
        ])
      }
    );

    expect(result.status).toBe("NOT_READY");
    expect(worker.sentPlannerMessages).toHaveLength(0);
  });
});

describe("worker message payload protections", () => {
  it("truncates an oversized worker message to 9999 chars plus the 16-char marker", async () => {
    const oversized = "A".repeat(10001);
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_big", source: "worker", role: "assistant", text: oversized }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    const result = await relayWorkerToPlanner(makePair(), { worker, planner });

    expect(result.status).toBe("DELIVERED");
    expect(planner.sentMessages).toHaveLength(1);
    const sent = planner.sentMessages[0]!.message.text;
    expect(sent.length).toBe(10015);
    expect(sent.endsWith("\uFFFDLIMIT_TRUNCATED")).toBe(true);
    expect(sent.startsWith("A".repeat(9999))).toBe(true);
  });

  it("does not truncate a message within the 10,000 character limit", async () => {
    const exact = "B".repeat(10000);
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_exact", source: "worker", role: "assistant", text: exact }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    await relayWorkerToPlanner(makePair(), { worker, planner });

    expect(planner.sentMessages[0]!.message.text).toBe(exact);
  });

  it("strips control characters (0x00-0x1F, 0x7F) including newlines and tabs", async () => {
    const withControlChars = "Line one\x00\x01\x1F\x7F\nLine two\ttabbed\x02end";
    const worker = new StaticOpenCodeAdapter([
      { id: "msg_ctrl", source: "worker", role: "assistant", text: withControlChars }
    ]);
    const planner = new FakeChatGPTBrowserAdapter();

    await relayWorkerToPlanner(makePair(), { worker, planner });

    const sent = planner.sentMessages[0]!.message.text;
    expect(sent).toBe("Line oneLine twotabbedend");
    expect(sent).not.toContain("\x00");
    expect(sent).not.toContain("\x01");
    expect(sent).not.toContain("\x1F");
    expect(sent).not.toContain("\x7F");
    expect(sent).not.toContain("\x02");
    expect(sent).not.toContain("\n");
    expect(sent).not.toContain("\t");
  });

  it("classifies a worker question correctly before sanitization truncates it", async () => {
    const questionWithNoise = "Should I fix\x00 the types.ts\x01 file?";
    const sourceMessage = { id: "msg_q", source: "worker" as const, role: "assistant" as const, text: questionWithNoise };
    const worker = new StaticOpenCodeAdapter([sourceMessage]);
    const planner = new FakeChatGPTBrowserAdapter();

    const result = await relayWorkerToPlanner(makePair(), { worker, planner }, { sourceMessage });

    expect(result.status).toBe("DELIVERED");
    expect(result.classification).toBe("question");
    expect(planner.sentMessages[0]!.message.text).toBe("Should I fix the types.ts file?");
  });
});
