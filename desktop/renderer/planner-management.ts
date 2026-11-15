import { runAction } from "./actions.js";
import type {
  ChatGptProjectDto,
  EndpointTestResultDto,
  ParsedChatGptUrlDto,
  ToolLaunchResultDto
} from "../../src/contracts/desktop.js";

export interface PlannerEndpointInput {
  cdpUrl?: string;
  conversationUrl?: string;
}

/** Verify the planner browser's CDP endpoint and, when supplied, its conversation. */
export function verifyPlannerEndpoint(
  input: PlannerEndpointInput
): Promise<EndpointTestResultDto | undefined> {
  return runAction(() => window.desktop.testPlannerEndpoint(input));
}

export function parsePlannerConversation(url: string): Promise<ParsedChatGptUrlDto | undefined> {
  return runAction(() => window.desktop.parsePlannerUrl({ url }));
}

export function discoverPlannerProjects(cdpUrl?: string): Promise<ChatGptProjectDto[] | undefined> {
  return runAction(() => window.desktop.discoverChatGptProjects(cdpUrl ? { cdpUrl } : undefined));
}

/** Start or attach to the dedicated Planner automation browser. */
export function startPlannerManagementBrowser(
  cdpUrl?: string
): Promise<ToolLaunchResultDto | undefined> {
  return runAction(() => window.desktop.startPlannerBrowser(cdpUrl ? { cdpUrl } : undefined));
}
