/**
 * Agent-relay codebase — module explanation / info.
 * File: src/adapters/chatgpt/project-discovery.ts
 * Purpose: Source module for project-discovery.ts.
 */
import { parseChatGptConversationUrl } from "../../sessions/chatgpt-url.js";

export interface CdpListTarget {
  type?: string;
  title?: string;
  url?: string;
}

export interface ChatGptProjectDiscovery {
  projectSlug: string;
  projectName?: string;
  conversationIds: string[];
  conversationTitles: Record<string, string>;
  openTabCount: number;
}

export class ChatGptProjectDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGptProjectDiscoveryError";
  }
}

/**
 * Splits a `/g/<segment>` project segment into its stable key and an optional
 * display-name suffix. Observed live: `g-p-<hex>`, `g-p-<hex>-<name>`, and
 * UUID-style ids that embed hyphens (`g-p-<hex>-<hex>-...`). The key is the
 * `g-p-<hex>[...]` head (hyphen-separated hex groups are part of the id); only a
 * trailing non-hex suffix after that is a human rename hint.
 */
const PROJECT_SEGMENT_PATTERN = /^(g-p-(?:[0-9a-fA-F]{1,64}-)*[0-9a-fA-F]{4,64})(?:-(.+))?$/;

/**
 * Accepts either a bare project slug (`g-p-<hex>[-<name>]`) or a full
 * project-scoped conversation URL (`https://chatgpt.com/g/<slug>/c/<id>`)
 * and returns the normalized `{ slug, name? }` identity.
 */
export function normalizeChatGptProject(input: string): { slug: string; name?: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ChatGptProjectDiscoveryError("A ChatGPT project slug or project conversation URL is required.");
  }

  let segment = trimmed;
  try {
    const parsed = parseChatGptConversationUrl(trimmed);
    if (parsed.project) {
      segment = parsed.project;
    } else if (trimmed !== parsed.conversationId && trimmed.includes("/")) {
      throw new ChatGptProjectDiscoveryError(
        "The ChatGPT URL is a plain conversation URL without a /g/<project> segment. Open a conversation inside a ChatGPT project."
      );
    }
  } catch (error) {
    if (error instanceof ChatGptProjectDiscoveryError) {
      throw error;
    }
    // Not a URL — treat the input as a bare slug below.
  }

  const match = PROJECT_SEGMENT_PATTERN.exec(segment);
  if (match) {
    const name = match[2]?.trim().replace(/-/g, " ");
    return { slug: match[1], ...(name ? { name } : {}) };
  }

  if (/^g-p-[A-Za-z0-9_-]+$/.test(segment)) {
    return { slug: segment };
  }

  throw new ChatGptProjectDiscoveryError(
    `Could not read a ChatGPT project from "${trimmed}". Use a g-p-<id> slug or a /g/<project>/c/<id> URL.`
  );
}

/** Read-only CDP target listing. Never navigates, never writes. */
export async function listCdpTargets(
  cdpUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<CdpListTarget[]> {
  const base = cdpUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetchImpl(`${base}/json/list`);
  } catch (error) {
    throw new ChatGptProjectDiscoveryError(
      `Could not reach the automation browser at ${cdpUrl}: ${messageOf(error)}`
    );
  }
  if (!response.ok) {
    throw new ChatGptProjectDiscoveryError(
      `Automation browser discovery failed with HTTP ${response.status} at ${cdpUrl}.`
    );
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new ChatGptProjectDiscoveryError(
      `Automation browser at ${cdpUrl} returned an unexpected target list.`
    );
  }
  return payload as CdpListTarget[];
}

/** Groups open ChatGPT conversation pages by their `/g/<project>` slug. Pure. */
export function groupChatGptProjects(targets: CdpListTarget[]): ChatGptProjectDiscovery[] {
  const bySlug = new Map<
    string,
    { name?: string; conversationIds: string[]; conversationTitles: Record<string, string>; openTabCount: number }
  >();
  for (const target of targets) {
    if (target.type !== "page" || typeof target.url !== "string") {
      continue;
    }
    let parsed: { conversationId: string; project?: string };
    try {
      parsed = parseChatGptConversationUrl(target.url);
    } catch {
      continue;
    }
    if (!parsed.project) {
      continue;
    }
    let slug: string;
    let name: string | undefined;
    try {
      ({ slug, name } = normalizeChatGptProject(parsed.project));
    } catch {
      continue;
    }
    const entry = bySlug.get(slug) ?? { conversationIds: [], conversationTitles: {}, openTabCount: 0 };
    if (!entry.conversationIds.includes(parsed.conversationId)) {
      entry.conversationIds.push(parsed.conversationId);
    }
    const title = target.title?.trim();
    if (title && !entry.conversationTitles[parsed.conversationId]) {
      entry.conversationTitles[parsed.conversationId] = title;
    }
    entry.openTabCount += 1;
    if (!entry.name && name) {
      entry.name = name;
    }
    bySlug.set(slug, entry);
  }
  return [...bySlug.entries()].map(([projectSlug, entry]) => ({
    projectSlug,
    ...(entry.name ? { projectName: entry.name } : {}),
    conversationIds: entry.conversationIds,
    conversationTitles: entry.conversationTitles,
    openTabCount: entry.openTabCount
  }));
}

/** Discovers ChatGPT projects from the automation browser's open tabs. Read-only. */
export async function discoverChatGptProjects(
  cdpUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<ChatGptProjectDiscovery[]> {
  return groupChatGptProjects(await listCdpTargets(cdpUrl, fetchImpl));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
