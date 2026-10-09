import { describe, expect, it } from "vitest";
import { ALLOWED_INVOKE_CHANNELS, EVENT_CHANNEL, IPC_CHANNELS } from "../desktop/shared/ipc-channels.js";
import { isValidError } from "../desktop/renderer/state.js";
import type { DesktopErrorDto, EventRecordDto, PairIdentityDto, ValidationResultDto } from "../src/contracts/desktop.js";

const invokeChannelNames = [
  "listPairs",
  "status",
  "pairStatus",
  "pairDetail",
  "pausePair",
  "resumePair",
  "startPair",
  "stopPair",
  "startAll",
  "stopAll",
  "validatePair",
  "getValidation",
  "getRecentEvents",
  "getAutomationInfo",
  "seedPlanner",
  "feedLocalAgent",
  "listOpenCodeSessions",
  "createPair",
  "updatePair",
  "removePair",
  "rebindWorker",
  "suggestWorkerSessionTitle",
  "createWorkerSessionForPair",
  "openWorkerSession",
  "listWorkerQuestions",
  "getWorkerTranscript",
  "answerWorkerQuestion",
  "listWorkerModels",
  "switchWorkerModel",
  "resumeWithFallbackModel",
  "getWorkerProgress",
  "validateCandidate",
  "discoverWorkerSessions",
  "scanDesktopWorkerSession",
  "alignWorkerSessionWithOpenCodeDesktop",
  "startWorkerServer",
  "updateOpenCode",
  "createWorkerSession",
  "testWorkerEndpoint",
  "getOpenCodeEndpoint",
  "parsePlannerUrl",
  "testPlannerEndpoint",
  "startPlannerBrowser",
  "getChatGptEndpoint",
  "getTimeline",
  "clearTimeline",
  "startProject",
  "pauseProject",
  "resumeProject",
  "listProjectPairs",
  "createProjectPair",
  "removeProjectPair",
  "discoverOpenCodeProjects",
  "discoverChatGptProjects",
  "listArchive",
  "deleteArchive",
  "copyText"
] as const;

describe("desktop IPC contract", () => {
  it("defines an explicit, non-empty whitelist of invoke channels", () => {
    expect(ALLOWED_INVOKE_CHANNELS.length).toBeGreaterThan(0);
    expect(ALLOWED_INVOKE_CHANNELS).toHaveLength(invokeChannelNames.length);
  });

  it("whitelist contains every non-event channel with no duplicates", () => {
    const expected = invokeChannelNames.map((name) => IPC_CHANNELS[name]);
    expect([...ALLOWED_INVOKE_CHANNELS].sort()).toEqual([...expected].sort());
    expect(new Set(ALLOWED_INVOKE_CHANNELS).size).toBe(ALLOWED_INVOKE_CHANNELS.length);
  });

  it("every invoke channel uses the narrow desktop: prefix namespace", () => {
    for (const channel of ALLOWED_INVOKE_CHANNELS) {
      expect(channel).toMatch(/^desktop:[a-z][a-zA-Z0-9:-]*$/);
    }
  });

  it("the event channel is receive-only and not exposed as an invoke channel", () => {
    expect(EVENT_CHANNEL).toBe(IPC_CHANNELS.event);
    expect(ALLOWED_INVOKE_CHANNELS).not.toContain(EVENT_CHANNEL);
  });

  it("exposes no generic execute/read/write channel", () => {
    for (const channel of ALLOWED_INVOKE_CHANNELS) {
      expect(channel).not.toMatch(/execute|command|read|write|open-any|fs|shell/);
    }
  });
});

describe("desktop DTO discriminators", () => {
  it("treats a serialized error DTO as an error", () => {
    const error: DesktopErrorDto = { code: "RUNTIME_ERROR", message: "boom" };
    expect(isValidError(error)).toBe(true);
  });

  it("treats a validation DTO as not-an-error", () => {
    const validation: ValidationResultDto = {
      pairId: "kisab-main",
      status: "READY",
      checks: [],
      validatedAt: "2026-08-29T00:00:00.000Z"
    };
    expect(isValidError(validation)).toBe(false);
  });

  it("treats a plain message string as not an error DTO", () => {
    expect(isValidError("boom")).toBe(false);
    expect(isValidError(null)).toBe(false);
    expect(isValidError(undefined)).toBe(false);
  });

  it("carries the expected DTO shapes over the wire", () => {
    const pair: PairIdentityDto = {
      pairId: "kisab-main",
      enabled: true,
      worker: { type: "opencode", sessionId: "s1", repoPath: "/repo" },
      planner: { type: "chatgpt-browser", conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" }
    };
    const event: EventRecordDto = { time: "t", type: "PAIR_VALIDATED", pairId: "kisab-main" };
    expect(pair.pairId).toBe("kisab-main");
    expect(event.type).toBe("PAIR_VALIDATED");
  });
});
