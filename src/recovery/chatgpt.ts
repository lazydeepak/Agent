import {
  type ChatGPTBrowserAdapter
} from "../adapters/chatgpt/index.js";
import type { BrowserManager } from "./browser.js";
import type { RecoveryErrorCode, PlannerObservation, PlannerIdentity } from "../types.js";
import { interruptibleSleep } from "./schedule.js";

export type ChatGPTRecoveryOutcome =
  | { recovered: true; action: "reconnect-transport" | "reopen-conversation" | "relaunch-browser" }
  | { recovered: false; code: RecoveryErrorCode; reason: string; intervention: boolean };

export interface ChatGPTRecoveryInput {
  planner: PlannerIdentity;
  adapter: ChatGPTBrowserAdapter;
  browser: BrowserManager;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  maxProbes?: number;
}

export async function recoverChatGPT(input: ChatGPTRecoveryInput): Promise<ChatGPTRecoveryOutcome> {
  const maxProbes = input.maxProbes ?? 3;
  const sleep = input.sleep ?? interruptibleSleep;

  const first = await probe(input);
  if (healthy(first)) {
    return { recovered: true, action: "reconnect-transport" };
  }

  const failure = categorize(first);

  if (failure.code === "CHATGPT_AUTH_REQUIRED") {
    return {
      recovered: false,
      code: "CHATGPT_AUTH_REQUIRED",
      reason: "ChatGPT browser session requires authentication. Agent will not attempt a login by itself.",
      intervention: true
    };
  }

  let observation = first;
  let relaunched = false;

  for (let attempt = 1; attempt <= maxProbes; attempt += 1) {
    if (failure.transport) {
      await input.browser.reconnect();
      if (input.browser.ownership === "managed" && input.browser.relaunch && !relaunched) {
        await input.browser.relaunch();
        relaunched = true;
      }
    } else {
      await input.browser.openConversation?.(input.planner.conversationUrl);
    }

    if (attempt < maxProbes) {
      await sleep(50, input.signal).catch(() => undefined);
    }
    observation = await probe(input);
    if (healthy(observation)) {
      return {
        recovered: true,
        action: relaunched ? "relaunch-browser" : failure.transport ? "reconnect-transport" : "reopen-conversation"
      };
    }
  }

  const final = categorize(observation);
  return {
    recovered: false,
    code: final.code,
    reason: `ChatGPT peer did not recover after ${maxProbes} probes (${final.code}).`,
    intervention: final.intervention
  };
}

async function probe(input: ChatGPTRecoveryInput): Promise<PlannerObservation | undefined> {
  if (input.adapter.observePlannerConversation) {
    try {
      return await input.adapter.observePlannerConversation(input.planner);
    } catch (error) {
      return undefined;
    }
  }

  try {
    const checks = await input.adapter.checkReadiness(input.planner);
    const byName = Object.fromEntries(checks.map((check) => [check.name, check.status === "PASS"]));
    return {
      reachable: byName["planner.browserReachable"] === true,
      authenticated: byName["planner.authenticated"] === true,
      conversationReachable: byName["planner.conversationReachable"] === true,
      composerAvailable: byName["planner.composerAvailable"] === true,
      generating: byName["planner.notGenerating"] === false
    };
  } catch {
    return undefined;
  }
}

function healthy(observation: PlannerObservation | undefined): boolean {
  if (!observation) {
    return false;
  }
  return (
    observation.reachable &&
    observation.authenticated &&
    observation.conversationReachable &&
    observation.composerAvailable
  );
}

function categorize(observation: PlannerObservation | undefined): {
  code: RecoveryErrorCode;
  transport: boolean;
  intervention: boolean;
} {
  if (!observation) {
    return { code: "CHATGPT_CDP_UNREACHABLE", transport: true, intervention: false };
  }
  if (!observation.reachable) {
    return { code: "CHATGPT_CDP_UNREACHABLE", transport: true, intervention: false };
  }
  if (!observation.authenticated) {
    return { code: "CHATGPT_AUTH_REQUIRED", transport: false, intervention: true };
  }
  if (!observation.conversationReachable) {
    return { code: "CHATGPT_CONVERSATION_MISMATCH", transport: false, intervention: false };
  }
  if (!observation.composerAvailable) {
    return { code: "CHATGPT_CONVERSATION_MISMATCH", transport: false, intervention: false };
  }
  return { code: "CHATGPT_CDP_UNREACHABLE", transport: true, intervention: false };
}