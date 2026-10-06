import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { PairsConfig, SessionPair } from "../types.js";

const pairIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const readinessOverridesSchema = z.record(z.union([z.boolean(), z.string()])).optional();

const openCodeServerSchema = z
  .object({
    baseUrl: z.string().trim().url("OpenCode server baseUrl must be a valid URL.").optional(),
    apiProtocol: z.enum(["legacy", "v2"]).optional(),
    username: z.string().trim().min(1, "OpenCode server username cannot be empty.").optional(),
    password: z.string().min(1, "OpenCode server password cannot be empty.").optional(),
    passwordEnv: z.string().trim().min(1, "OpenCode server passwordEnv cannot be empty.").optional()
  })
  .strict()
  .transform((server) => {
    if (!server.baseUrl) {
      return server;
    }
    return { ...server, baseUrl: stripTrailingSlashes(server.baseUrl) };
  })
  .optional();

const chatGptBrowserSchema = z
  .object({
    cdpUrl: z.string().trim().url("ChatGPT browser cdpUrl must be a valid URL.").optional(),
    executablePath: z.string().trim().min(1, "ChatGPT browser executablePath cannot be empty.").optional(),
    userDataDir: z.string().trim().min(1, "ChatGPT browser userDataDir cannot be empty.").optional(),
    headless: z.boolean().optional(),
    timeoutMs: z.number().int().positive("ChatGPT browser timeoutMs must be positive.").optional()
  })
  .strict()
  .transform((browser) => {
    if (!browser.cdpUrl) {
      return browser;
    }
    return { ...browser, cdpUrl: stripTrailingSlashes(browser.cdpUrl) };
  })
  .optional();

const workerSchema = z
  .object({
    type: z.literal("opencode", {
      errorMap: () => ({ message: "Worker type must be one of: opencode." })
    }),
    sessionId: z.string().trim().min(1, "Worker sessionId is required."),
    repoPath: z.string().trim().min(1, "Worker repoPath is required."),
    server: openCodeServerSchema,
    readiness: readinessOverridesSchema
  })
  .strict();

const plannerSchema = z
  .object({
    type: z.literal("chatgpt-browser", {
      errorMap: () => ({ message: "Planner type must be one of: chatgpt-browser." })
    }),
    conversationId: z.string().trim().min(1, "Planner conversationId is required."),
    conversationUrl: z.string().trim().url("Planner conversationUrl must be a valid URL."),
    browser: chatGptBrowserSchema,
    readiness: readinessOverridesSchema,
    automation: z
      .object({
        promptVersion: z.string().trim().min(1, "Planner automation promptVersion is required."),
        seededAt: z.string().datetime("Planner automation seededAt must be an ISO timestamp.")
      })
      .strict()
      .optional()
  })
  .strict();

const pairSchema = z
  .object({
    pairId: z
      .string()
      .trim()
      .regex(
        pairIdPattern,
        "pairId must use lowercase letters, numbers, and single hyphens, starting with a letter."
      ),
    enabled: z.boolean(),
    worker: workerSchema,
    planner: plannerSchema,
    localAgentMode: z.boolean().optional(),
    projectPairId: z.string().trim().optional(),
    fallbackModel: z.object({
      providerID: z.string(),
      id: z.string()
    }).optional()
  })
  .strict();

const pairsConfigSchema = z
  .object({
    pairs: z.array(pairSchema)
  })
  .strict();

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export async function loadPairsConfig(configPath: string): Promise<PairsConfig> {
  let rawConfig: string;

  try {
    rawConfig = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError([`Could not read config file ${configPath}: ${errorMessage(error)}`]);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawConfig);
  } catch (error) {
    throw new ConfigError([`Config file ${configPath} is not valid JSON: ${errorMessage(error)}`]);
  }

  // Parse and validate the configuration, rejecting duplicates and
  // mismatched conversation URLs before returning the normalized config.
  return parsePairsConfig(parsedJson);
}

export async function bindOpenCodeSession(
  configPath: string,
  pairId: string,
  sessionId: string
): Promise<PairsConfig> {
  const config = await loadPairsConfig(configPath);
  const pair = config.pairs.find((candidate) => candidate.pairId === pairId);

  if (!pair) {
    throw new ConfigError([`Unknown pairId "${pairId}". Check the configured pairs or use --all.`]);
  }

  const updatedConfig = {
    pairs: config.pairs.map((candidate) =>
      candidate.pairId === pairId
        ? {
            ...candidate,
            worker: {
              ...candidate.worker,
              sessionId
            }
          }
        : candidate
    )
  };

  parsePairsConfig(updatedConfig);
  await writeFile(configPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");
  return updatedConfig;
}

export function parsePairsConfig(input: unknown): PairsConfig {
  const parsed = pairsConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map(formatZodIssue));
  }

  // Validate ownership constraints: no duplicate pairIds, sessionIds, or conversationIds
  validateUniqueOwnership(parsed.data.pairs);
  // Validate that conversation URLs match their declared conversationIds
  validateConversationUrls(parsed.data.pairs);
  // Validate that pairs sharing one OpenCode endpoint agree on credentials so the
  // same server is not addressed with and without auth at the same time
  validateSharedEndpointCredentials(parsed.data.pairs);

  return parsed.data;
}

export function deriveChatGptConversationId(conversationUrl: string): string | undefined {
  try {
    const url = new URL(conversationUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const conversationMarkerIndex = parts.indexOf("c");
    return conversationMarkerIndex >= 0 ? parts[conversationMarkerIndex + 1] : undefined;
  } catch {
    return undefined;
  }
}

function validateUniqueOwnership(pairs: SessionPair[]): void {
  const issues = [
    ...findDuplicates(pairs, (pair) => pair.pairId).map(
      (pairId) => `Duplicate pairId "${pairId}". Each pair must have a stable unique pairId.`
    ),
    ...findDuplicates(pairs, (pair) => pair.worker.sessionId).map(
      (sessionId) =>
        `Duplicate OpenCode session ownership "${sessionId}". One OpenCode session can belong to only one pair.`
    ),
    ...findDuplicates(pairs, (pair) => pair.planner.conversationId).map(
      (conversationId) =>
        `Duplicate ChatGPT conversation ownership "${conversationId}". One ChatGPT conversation can belong to only one pair.`
    )
  ];

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
}

/**
 * Endpoint identity for grouping: scheme+host+port+path with any trailing slash
 * removed, so `http://host:4096` and `http://host:4096/` are the same endpoint.
 */
function endpointIdentity(baseUrl: string): string {
  const url = new URL(baseUrl);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

function validateSharedEndpointCredentials(pairs: SessionPair[]): void {
  const shared = new Map<string, { baseUrl: string; withCredentials: string[]; withoutCredentials: string[] }>();
  for (const pair of pairs) {
    const server = pair.worker.server;
    if (!server?.baseUrl) {
      continue;
    }
    const key = endpointIdentity(server.baseUrl);
    const entry = shared.get(key) ?? { baseUrl: server.baseUrl, withCredentials: [], withoutCredentials: [] };
    const hasCredentials = Boolean(server.username ?? server.password ?? server.passwordEnv);
    if (hasCredentials) {
      entry.withCredentials.push(pair.pairId);
    } else {
      entry.withoutCredentials.push(pair.pairId);
    }
    shared.set(key, entry);
  }

  const issues = [...shared.values()].flatMap((entry) => {
    if (entry.withCredentials.length === 0 || entry.withoutCredentials.length === 0) {
      return [];
    }
    return [
      `OpenCode endpoint "${entry.baseUrl}" is shared by pairs ${[
        ...entry.withCredentials,
        ...entry.withoutCredentials
      ].join(", ")} but only some declare credentials. All pairs on a shared endpoint must agree on credentials.`
    ];
  });

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function validateConversationUrls(pairs: SessionPair[]): void {
  const issues = pairs.flatMap((pair) => {
    const derivedConversationId = deriveChatGptConversationId(pair.planner.conversationUrl);

    if (!derivedConversationId) {
      return [
        `Pair "${pair.pairId}" planner conversationUrl must include a ChatGPT conversation path like /c/${pair.planner.conversationId}.`
      ];
    }

    if (derivedConversationId !== pair.planner.conversationId) {
      return [
        `Pair "${pair.pairId}" planner conversationId "${pair.planner.conversationId}" does not match conversationUrl id "${derivedConversationId}".`
      ];
    }

    return [];
  });

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
}

function findDuplicates<T>(items: T[], keyForItem: (item: T) => string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    const key = keyForItem(item);
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }

  return [...duplicates];
}

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
