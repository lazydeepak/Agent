import type { CandidatePairDto, PairIdentityDto } from "../../src/contracts/desktop.js";

export type WizardKind = "create" | "edit" | "rebind";

export type WizardStep = "worker" | "planner" | "review";

export interface WizardSession {
  kind: WizardKind;
  draft: WizardDraft;
  sessions: Array<import("../../src/contracts/desktop.js").OpenCodeSessionInfoDto>;
  projects: Array<import("../../src/contracts/desktop.js").ProjectPairDto>;
  validation?: import("../../src/contracts/desktop.js").ValidationResultDto;
  manualCommand?: { command: string; verify: "worker" | "planner" };
}


export interface ParsedPlannerUrl {
  conversationId: string;
  conversationUrl: string;
  project?: string;
}

export interface WizardDraft {
  pairId: string;
  workerSessionId: string;
  workerRepoPath: string;
  workerEndpoint: string;
  workerEndpointOk?: boolean;
  /** "auto" lets agent-relay detect the compatible protocol; pin to "legacy" for OpenCode Desktop parity. */
  workerApiProtocol: "auto" | "legacy" | "v2";
  parsed: ParsedPlannerUrl | undefined;
  plannerEndpoint: string;
  plannerEndpointOk?: boolean;
  enabled: boolean;
  targetPairId?: string;
  /** UI-only project selection; never persisted — repo equality assigns the session. */
  projectPairId?: string;
}

export const pairIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function isValidPairId(value: string): boolean {
  return pairIdPattern.test(value.trim());
}

export function suggestPairId(title?: string, repoPath?: string): string | undefined {
  const repoParts = repoPath?.replace(/\\/g, "/").split("/").filter(Boolean) ?? [];
  const repoName = repoParts[repoParts.length - 1];
  const source = title?.trim() || repoName?.trim();
  if (!source) return undefined;
  let suggestion = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!suggestion) return undefined;
  if (!/^[a-z]/.test(suggestion)) suggestion = `pair-${suggestion}`;
  return isValidPairId(suggestion) ? suggestion : undefined;
}

export function createWizardDraft(kind: WizardKind, existing?: PairIdentityDto): WizardDraft {
  if (kind === "rebind") {
    return {
      pairId: "",
      workerSessionId: "",
      workerRepoPath: existing?.worker.repoPath ?? "",
      workerEndpoint: existing?.worker.server?.baseUrl ?? "",
      workerApiProtocol: existing?.worker.server?.apiProtocol ?? "auto",
      parsed: undefined,
      plannerEndpoint: "",
      enabled: existing?.enabled ?? true,
      targetPairId: existing?.pairId
    };
  }
  return {
    pairId: existing?.pairId ?? "",
    workerSessionId: existing?.worker.sessionId ?? "",
    workerRepoPath: existing?.worker.repoPath ?? "",
    workerEndpoint: existing?.worker.server?.baseUrl ?? "",
    workerApiProtocol: existing?.worker.server?.apiProtocol ?? "auto",
    parsed: existing
      ? {
          conversationId: existing.planner.conversationId,
          conversationUrl: existing.planner.conversationUrl
        }
      : undefined,
    plannerEndpoint: existing?.planner.browser?.cdpUrl ?? "",
    enabled: existing?.enabled ?? true,
    targetPairId: existing?.pairId
  };
}

export function wizardSteps(kind: WizardKind): WizardStep[] {
  if (kind === "rebind") {
    return ["worker"];
  }
  return ["worker", "planner", "review"];
}

export function wizardStepLabel(step: WizardStep): string {
  switch (step) {
    case "worker":
      return "OpenCode Session";
    case "planner":
      return "ChatGPT Conversation";
    case "review":
      return "Review & Save";
  }
}

export function stepComplete(kind: WizardKind, step: WizardStep, draft: WizardDraft): boolean {
  return stepIssues(kind, step, draft).length === 0;
}

export function stepIssues(kind: WizardKind, step: WizardStep, draft: WizardDraft): string[] {
  switch (step) {
    case "worker": {
      const issues: string[] = [];
      if (kind !== "rebind" && !isValidPairId(draft.pairId)) {
        issues.push("Enter a valid Automation Session ID using lowercase letters, numbers, and single hyphens.");
      }
      if (!draft.workerSessionId.trim()) issues.push("Select an OpenCode session.");
      if (kind !== "rebind" && !draft.workerRepoPath.trim()) issues.push("Provide the OpenCode repository path.");
      if (draft.workerEndpointOk !== true) issues.push("Test the OpenCode connection and selected session.");
      return issues;
    }
    case "planner": {
      const issues: string[] = [];
      if (!draft.parsed?.conversationId || !draft.parsed.conversationUrl) {
        issues.push("Paste and parse the ChatGPT conversation URL.");
      }
      if (draft.plannerEndpointOk !== true) issues.push("Launch or test automation Chrome.");
      return issues;
    }
    case "review": {
      return candidateFromWizard(kind, draft) ? [] : candidateIssues(kind, draft);
    }
  }
}

export function candidateIssues(kind: WizardKind, draft: WizardDraft): string[] {
  if (kind === "rebind") return stepIssues(kind, "worker", draft);
  return [...stepIssues(kind, "worker", draft), ...stepIssues(kind, "planner", draft)];
}

export function canAdvance(kind: WizardKind, step: WizardStep, draft: WizardDraft): boolean {
  return stepComplete(kind, step, draft);
}

export function candidateFromWizard(kind: WizardKind, draft: WizardDraft): CandidatePairDto | undefined {
  if (kind === "rebind" || !draft.parsed) {
    return undefined;
  }
  const pairId = draft.pairId.trim();
  const sessionId = draft.workerSessionId.trim();
  const repoPath = draft.workerRepoPath.trim();
  if (!isValidPairId(pairId) || sessionId.length === 0 || repoPath.length === 0) {
    return undefined;
  }
  if (!draft.parsed.conversationId || !draft.parsed.conversationUrl) {
    return undefined;
  }
  const result: CandidatePairDto = {
    pairId,
    worker: {
      sessionId,
      repoPath,
      ...(draft.workerEndpoint.trim() || draft.workerApiProtocol !== "auto"
        ? {
            server: {
              ...(draft.workerEndpoint.trim() ? { baseUrl: draft.workerEndpoint.trim() } : {}),
              ...(draft.workerApiProtocol !== "auto" ? { apiProtocol: draft.workerApiProtocol } : {})
            }
          }
        : {})
    },
    planner: {
      conversationId: draft.parsed.conversationId,
      conversationUrl: draft.parsed.conversationUrl,
      ...(draft.plannerEndpoint.trim() ? { browser: { cdpUrl: draft.plannerEndpoint.trim() } } : {})
    },
    ...(draft.projectPairId ? { projectPairId: draft.projectPairId.trim() } : {})
  };
  return result;
}

export function rebindSelection(draft: WizardDraft): string | undefined {
  const sessionId = draft.workerSessionId.trim();
  return sessionId.length > 0 ? sessionId : undefined;
}

export function wizardTitle(kind: WizardKind, draft: WizardDraft): string {
  switch (kind) {
    case "create":
      return "Add Session";
    case "edit":
      return `Edit Session — ${draft.targetPairId || draft.pairId || "session"}`;
    case "rebind":
      return "Rebind OpenCode Session";
  }
}
