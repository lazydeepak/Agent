import { describe, expect, it } from "vitest";
import type { ChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import { FakeChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import type { OpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { FakeOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import type { PlannerIdentity, ReadinessCheck, WorkerIdentity } from "../src/types.js";
import { validatePair } from "../src/validator/readiness.js";
import { makePair } from "./helpers.js";

const fakeAdapters = {
  worker: new FakeOpenCodeAdapter(),
  planner: new FakeChatGPTBrowserAdapter()
};

describe("validatePair", () => {
  it("marks a valid pair READY when every mandatory check passes", async () => {
    const report = await validatePair(makePair(), fakeAdapters, new Date("2026-08-29T00:00:00.000Z"));

    expect(report).toMatchObject({
      pairId: "kisab-main",
      status: "READY",
      validatedAt: "2026-08-29T00:00:00.000Z"
    });
    expect(report.checks.map((check) => check.name)).toEqual([
      "worker.serverReachable",
      "worker.sessionExists",
      "worker.repoMatches",
      "worker.acceptsInput",
      "planner.browserReachable",
      "planner.authenticated",
      "planner.conversationReachable",
      "planner.composerAvailable",
      "planner.notGenerating",
      "pair.exclusiveOwnership",
      "pair.stateConsistent"
    ]);
  });

  it("marks a pair NOT_READY when one worker check fails", async () => {
    const report = await validatePair(
      makePair({
        worker: {
          type: "opencode",
          sessionId: "ses_worker_1",
          repoPath: "/Users/lazydeepak/dev/kisab",
          readiness: {
            "worker.repoMatches": "OpenCode session is attached to a different repo."
          }
        }
      }),
      fakeAdapters
    );

    expect(report.status).toBe("NOT_READY");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker.repoMatches",
        status: "FAIL",
        reason: "OpenCode session is attached to a different repo."
      })
    );
  });

  it("marks a pair NOT_READY when one planner check fails", async () => {
    const report = await validatePair(
      makePair({
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-1",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-1",
          readiness: {
            "planner.composerAvailable": "ChatGPT composer was not available."
          }
        }
      }),
      fakeAdapters
    );

    expect(report.status).toBe("NOT_READY");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "planner.composerAvailable",
        status: "FAIL",
        reason: "ChatGPT composer was not available."
      })
    );
  });

  it("converts adapter exceptions into failed readiness checks with useful reasons", async () => {
    const explodingWorker: OpenCodeAdapter = {
      async checkReadiness(_worker: WorkerIdentity): Promise<ReadinessCheck[]> {
        throw new Error("socket closed before session lookup");
      }
    };
    const planner: ChatGPTBrowserAdapter = {
      async checkReadiness(_planner: PlannerIdentity): Promise<ReadinessCheck[]> {
        return [];
      },
      async getLatestPlannerMessage() {
        return undefined;
      },
      async sendWorkerMessage() {
        throw new Error("sendWorkerMessage should not be called by readiness validation.");
      }
    };

    const report = await validatePair(makePair(), {
      worker: explodingWorker,
      planner
    });

    expect(report.status).toBe("NOT_READY");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker.adapterAvailable",
        status: "FAIL",
        reason: "Worker adapter failed during readiness checks: socket closed before session lookup"
      })
    );
  });

  it("marks mixed validate-all reports READY and NOT_READY deterministically", async () => {
    const pairs = [
      makePair(),
      makePair({
        pairId: "kisab-secondary",
        worker: {
          type: "opencode",
          sessionId: "ses_worker_2",
          repoPath: "/Users/lazydeepak/dev/other"
        },
        planner: {
          type: "chatgpt-browser",
          conversationId: "planner-conversation-2",
          conversationUrl: "https://chatgpt.com/c/planner-conversation-2",
          readiness: {
            "planner.notGenerating": "ChatGPT is still generating a response."
          }
        }
      })
    ];

    const reports = await Promise.all(pairs.map((pair) => validatePair(pair, fakeAdapters)));

    expect(reports.map((report) => [report.pairId, report.status])).toEqual([
      ["kisab-main", "READY"],
      ["kisab-secondary", "NOT_READY"]
    ]);
  });
});
