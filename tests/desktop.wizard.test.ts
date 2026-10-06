import { describe, expect, it } from "vitest";
import {
  canAdvance,
  candidateIssues,
  candidateFromWizard,
  createWizardDraft,
  isValidPairId,
  rebindSelection,
  stepComplete,
  stepIssues,
  suggestPairId,
  wizardStepLabel,
  wizardSteps,
  wizardTitle,
  type WizardDraft
} from "../desktop/renderer/wizard.js";
import type { PairIdentityDto } from "../desktop/shared/dto.js";

const existing: PairIdentityDto = {
  pairId: "kisab-main",
  enabled: true,
  worker: { type: "opencode", sessionId: "s_old", repoPath: "/repo/kisab", server: { baseUrl: "http://127.0.0.1:4096" } },
  planner: {
    type: "chatgpt-browser",
    conversationId: "c_old",
    conversationUrl: "https://chatgpt.com/c/c_old",
    browser: { cdpUrl: "http://127.0.0.1:9222" }
  }
};

describe("isValidPairId", () => {
  it("accepts canonical lowercase-dash pair ids", () => {
    expect(isValidPairId("kisab-main")).toBe(true);
    expect(isValidPairId("a")).toBe(true);
    expect(isValidPairId("kisab2b")).toBe(true);
  });

  it("rejects invalid pair ids", () => {
    expect(isValidPairId("Kisab Main")).toBe(false);
    expect(isValidPairId("")).toBe(false);
    expect(isValidPairId("1start")).toBe(false);
    expect(isValidPairId("has__underscore")).toBe(false);
  });
});

describe("suggestPairId", () => {
  it("creates a valid pair id from a detected session title or repository", () => {
    expect(suggestPairId("Agent Relay 1", "/repo/ignored")).toBe("agent-relay-1");
    expect(suggestPairId(undefined, "/Users/x/My Project")).toBe("my-project");
    expect(suggestPairId("2026 work")).toBe("pair-2026-work");
  });
});

describe("createWizardDraft", () => {
  it("starts an empty draft for a new pair", () => {
    const draft = createWizardDraft("create");
    expect(draft.pairId).toBe("");
    expect(draft.workerSessionId).toBe("");
    expect(draft.parsed).toBeUndefined();
  });

  it("prefills an edit draft and retains the pairId", () => {
    const draft = createWizardDraft("edit", existing);
    expect(draft.pairId).toBe("kisab-main");
    expect(draft.workerSessionId).toBe("s_old");
    expect(draft.parsed?.conversationId).toBe("c_old");
    expect(draft.workerEndpoint).toBe("http://127.0.0.1:4096");
    expect(draft.plannerEndpoint).toBe("http://127.0.0.1:9222");
  });

  it("starts a rebind draft that only targets the worker session", () => {
    const draft = createWizardDraft("rebind", existing);
    expect(draft.targetPairId).toBe("kisab-main");
    expect(draft.parsed).toBeUndefined();
    expect(draft.workerSessionId).toBe("");
  });
});

describe("wizard steps", () => {
  it("lists worker, planner, review for create/edit", () => {
    expect(wizardSteps("create")).toEqual(["worker", "planner", "review"]);
    expect(wizardSteps("edit")).toEqual(["worker", "planner", "review"]);
  });

  it("lists a single worker step for rebind", () => {
    expect(wizardSteps("rebind")).toEqual(["worker"]);
  });

  it("labels each step", () => {
    expect(wizardStepLabel("worker")).toContain("OpenCode");
    expect(wizardStepLabel("planner")).toContain("ChatGPT");
    expect(wizardStepLabel("review")).toContain("Review");
  });

  it("titles the wizard by kind", () => {
    expect(wizardTitle("create", createWizardDraft("create"))).toContain("Add");
    expect(wizardTitle("edit", createWizardDraft("edit", existing))).toContain("kisab-main");
    expect(wizardTitle("rebind", createWizardDraft("rebind", existing))).toContain("Rebind");
  });
});

describe("step completion gating", () => {
  it("worker step requires a session id", () => {
    let draft = createWizardDraft("create");
    expect(stepComplete("create", "worker", draft)).toBe(false);
    draft.workerSessionId = "s_1";
    expect(stepComplete("create", "worker", draft)).toBe(false);
    draft.workerRepoPath = "/repo";
    expect(stepComplete("create", "worker", draft)).toBe(false);
    draft.workerEndpointOk = true;
    expect(stepComplete("create", "worker", draft)).toBe(false);
    draft.pairId = "valid-pair";
    expect(stepComplete("create", "worker", draft)).toBe(true);
  });

  it("rebind only requires an explicit session id", () => {
    const draft = createWizardDraft("rebind", existing);
    draft.workerRepoPath = "";
    draft.workerSessionId = "s_new";
    draft.workerEndpointOk = true;
    expect(stepComplete("rebind", "worker", draft)).toBe(true);
  });

  it("planner step requires a parsed conversation", () => {
    const draft = createWizardDraft("create");
    expect(stepComplete("create", "planner", draft)).toBe(false);
    draft.parsed = { conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1" };
    expect(stepComplete("create", "planner", draft)).toBe(false);
    draft.plannerEndpointOk = true;
    expect(stepComplete("create", "planner", draft)).toBe(true);
  });

  it("review step requires a full candidate", () => {
    const draft = createWizardDraft("create");
    expect(stepComplete("create", "review", draft)).toBe(false);
    draft.pairId = "kisab-main";
    draft.workerSessionId = "s_1";
    draft.workerRepoPath = "/repo";
    draft.workerEndpointOk = true;
    draft.parsed = { conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1" };
    draft.plannerEndpointOk = true;
    expect(stepComplete("create", "review", draft)).toBe(true);
  });

  it("canAdvance mirrors step completion", () => {
    const draft = createWizardDraft("create");
    expect(canAdvance("create", "worker", draft)).toBe(false);
    draft.workerSessionId = "s_1";
    draft.workerRepoPath = "/repo";
    draft.workerEndpointOk = true;
    draft.pairId = "valid-pair";
    expect(canAdvance("create", "worker", draft)).toBe(true);
  });
});

describe("candidate issue reporting", () => {
  it("reports the exact incomplete or invalid setup fields", () => {
    const draft = createWizardDraft("create");
    expect(candidateIssues("create", draft)).toEqual([
      "Enter a valid Automation Session ID using lowercase letters, numbers, and single hyphens.",
      "Select an OpenCode session.",
      "Provide the OpenCode repository path.",
      "Test the OpenCode connection and selected session.",
      "Paste and parse the ChatGPT conversation URL.",
      "Launch or test automation Chrome."
    ]);
  });

  it("reports only the blockers for the current step", () => {
    const draft = createWizardDraft("create");
    draft.pairId = "valid-pair";
    draft.workerSessionId = "s_1";
    draft.workerRepoPath = "/repo";
    expect(stepIssues("create", "worker", draft)).toEqual([
      "Test the OpenCode connection and selected session."
    ]);
  });
});

describe("candidateFromWizard", () => {
  it("builds a serializable candidate including endpoint values", () => {
    const draft = createWizardDraft("create");
    draft.pairId = "kisab-main";
    draft.workerSessionId = "s_1";
    draft.workerRepoPath = "/repo";
    draft.workerEndpoint = "http://127.0.0.1:4096";
    draft.parsed = { conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1", project: "p-1" };
    draft.plannerEndpoint = "http://127.0.0.1:9222";
    draft.plannerEndpointOk = true;

    const candidate = candidateFromWizard("create", draft);
    expect(candidate).toMatchObject({
      pairId: "kisab-main",
      worker: { sessionId: "s_1", repoPath: "/repo", server: { baseUrl: "http://127.0.0.1:4096" } },
      planner: {
        conversationId: "c_1",
        conversationUrl: "https://chatgpt.com/c/c_1",
        browser: { cdpUrl: "http://127.0.0.1:9222" }
      }
    });
  });

  it("returns undefined when the pairId is invalid", () => {
    const draft = createWizardDraft("create");
    draft.pairId = "Bad Id";
    draft.workerSessionId = "s_1";
    draft.workerRepoPath = "/repo";
    draft.parsed = { conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1" };
    expect(candidateFromWizard("create", draft)).toBeUndefined();
  });

  it("returns undefined for a rebind wizard (no candidate to save)", () => {
    const draft = createWizardDraft("rebind", existing);
    draft.workerSessionId = "s_1";
    expect(candidateFromWizard("rebind", draft)).toBeUndefined();
  });

  it("ignores the UI-only project selection when building the candidate", () => {
    const draft = createWizardDraft("create");
    draft.pairId = "kisab-main";
    draft.workerSessionId = "s_1";
    draft.workerRepoPath = "/repo";
    draft.parsed = { conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1" };
    draft.projectPairId = "some-project";
    const candidate = candidateFromWizard("create", draft);
    expect(candidate).toMatchObject({ pairId: "kisab-main", projectPairId: "some-project" });
  });
});

describe("navigation preserves entered values", () => {
  it("retains worker and parsed values when navigating back", () => {
    const draft: WizardDraft = createWizardDraft("create");
    draft.pairId = "kisab-main";
    draft.workerSessionId = "s_1";
    draft.workerRepoPath = "/repo";
    draft.workerEndpoint = "http://127.0.0.1:4096";
    draft.plannerEndpoint = "http://127.0.0.1:9222";
    draft.plannerEndpointOk = true;

    draft.parsed = { conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1" };
    expect(stepComplete("create", "planner", draft)).toBe(true);

    draft.parsed = undefined;
    expect(stepComplete("create", "planner", draft)).toBe(false);

    draft.parsed = { conversationId: "c_1", conversationUrl: "https://chatgpt.com/c/c_1" };
    const backCandidate = candidateFromWizard("create", draft);
    expect(backCandidate?.worker.sessionId).toBe("s_1");
    expect(backCandidate?.worker.server?.baseUrl).toBe("http://127.0.0.1:4096");
  });

  it("rebindSelection returns the chosen session id when non-empty", () => {
    const draft = createWizardDraft("rebind", existing);
    expect(rebindSelection(draft)).toBeUndefined();
    draft.workerSessionId = "  s_chosen  ";
    expect(rebindSelection(draft)).toBe("s_chosen");
  });
});
