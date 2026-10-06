import { isAbsolute } from "node:path";
import { DesktopApplicationError } from "../../src/application/desktop-service.js";
import type { CreateProjectPairInput } from "../../src/application/project-pair-service.js";

/**
 * Validation of every value that crosses the IPC bridge.
 *
 * Renderer input is untrusted: these helpers are the only thing standing between the sandboxed
 * renderer and a filesystem path, an automation endpoint, or a shell-opened URL, so they are kept
 * together (and separately testable) rather than scattered through the handler wiring.
 */

export function asPairId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DesktopApplicationError("INVALID_PAIR_ID", "A non-empty pairId string is required.");
  }
  return value;
}

export function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DesktopApplicationError("INVALID_INPUT", `A non-empty "${field}" string is required.`);
  }
  return value;
}

export function asStringRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

export const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Parses a renderer-supplied URL and rejects anything that is not http(s). Renderer input is
 * untrusted: without this check a scheme such as `file:` or a custom protocol would reach
 * `shell.openExternal` or receive stored OpenCode Basic credentials.
 */
export function asHttpUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DesktopApplicationError("INVALID_URL", `A non-empty "${field}" string is required.`);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DesktopApplicationError("INVALID_URL", `"${field}" must be a valid absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DesktopApplicationError("INVALID_URL", `"${field}" must use http or https.`);
  }
  return url.toString();
}

/** Browser automation attaches over CDP only, so the endpoint must be a loopback http(s) URL. */
export function asLoopbackUrl(value: unknown, field: string): string {
  const parsed = asHttpUrl(value, field);
  const hostname = new URL(parsed).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    throw new DesktopApplicationError(
      "INVALID_URL",
      `"${field}" must be a loopback address (127.0.0.1, localhost, or ::1).`
    );
  }
  return parsed;
}

export function asAbsolutePath(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DesktopApplicationError("INVALID_PATH", `A non-empty "${field}" is required.`);
  }
  const trimmed = value.trim();
  if (!isAbsolute(trimmed)) {
    throw new DesktopApplicationError("INVALID_PATH", `"${field}" must be an absolute path.`);
  }
  return trimmed;
}

export function castOpenCodeEndpoint(value: unknown): { baseUrl?: string } {
  const record = asStringRecord(value);
  const result: { baseUrl?: string } = {};
  if (typeof record.baseUrl === "string" && record.baseUrl.length > 0) {
    result.baseUrl = asHttpUrl(record.baseUrl, "baseUrl");
  }
  return result;
}

export function castStartPriming(value: unknown): "from-worker" | "from-planner" | "from-trigger" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "from-worker" || value === "from-planner" || value === "from-trigger") {
    return value;
  }
  throw new DesktopApplicationError("INVALID_START_PRIMING", `Unknown start priming "${String(value)}".`);
}

export function castWorkerModel(value: unknown): { providerId: string; modelId: string; notifyPlanner: boolean } {
  const record = asStringRecord(value);
  return {
    providerId: asNonEmptyString(record.providerId, "providerId"),
    modelId: asNonEmptyString(record.modelId, "modelId"),
    notifyPlanner: record.notifyPlanner === true
  };
}

export function castWorkerSessionTitle(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asStringRecord(value);
  const title = record.title;
  if (typeof title !== "string" || !title.trim()) {
    throw new DesktopApplicationError("INVALID_WORKER_SESSION_TITLE", "A non-empty worker session name is required.");
  }
  return title.trim();
}

export function asProjectPairId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DesktopApplicationError("INVALID_PROJECT_PAIR_ID", "A non-empty projectPairId string is required.");
  }
  return value;
}

export function castCdpUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asStringRecord(value);
  if (record.cdpUrl === undefined || record.cdpUrl === null) return undefined;
  if (typeof record.cdpUrl !== "string" || !record.cdpUrl.trim()) {
    throw new DesktopApplicationError("INVALID_INPUT", "A non-empty cdpUrl string is required.");
  }
  return asLoopbackUrl(record.cdpUrl, "cdpUrl");
}

export function castCreateProjectPair(value: unknown): CreateProjectPairInput {
  const record = asStringRecord(value);
  const worker = asStringRecord(record.worker);
  const planner = asStringRecord(record.planner);
  const repoPath = worker.repoPath;
  if (typeof repoPath !== "string" || !repoPath.trim()) {
    throw new DesktopApplicationError("INVALID_INPUT", "A non-empty worker repoPath is required.");
  }
  const resolvedRepoPath = asAbsolutePath(repoPath, "worker repoPath");
  const projectSlug = planner.projectSlug;
  if (typeof projectSlug !== "string" || !projectSlug.trim()) {
    throw new DesktopApplicationError("INVALID_INPUT", "A non-empty planner project slug or URL is required.");
  }
  const result: CreateProjectPairInput = {
    worker: { repoPath: resolvedRepoPath },
    planner: { projectSlug: projectSlug.trim() }
  };
  if (typeof record.projectPairId === "string" && record.projectPairId.trim()) {
    result.projectPairId = record.projectPairId.trim();
  }
  if (typeof worker.projectId === "string" && worker.projectId.trim()) {
    result.worker.projectId = worker.projectId.trim();
  }
  if (typeof planner.projectName === "string" && planner.projectName.trim()) {
    result.planner.projectName = planner.projectName.trim();
  }
  return result;
}

export function castOpenCodeEndpointTest(value: unknown): { baseUrl?: string; sessionId?: string; repoPath?: string } {
  const record = asStringRecord(value);
  const result: { baseUrl?: string; sessionId?: string; repoPath?: string } = { ...castOpenCodeEndpoint(record) };
  if (typeof record.sessionId === "string" && record.sessionId.trim()) result.sessionId = record.sessionId;
  if (typeof record.repoPath === "string" && record.repoPath.trim()) {
    result.repoPath = asAbsolutePath(record.repoPath, "repoPath");
  }
  return result;
}

export function castCreateWorkerSession(value: unknown) {
  const record = asStringRecord(value);
  const repoPath = record.repoPath;
  if (typeof repoPath !== "string" || repoPath.length === 0) {
    throw new DesktopApplicationError("INVALID_INPUT", "A non-empty repoPath is required to create an OpenCode session.");
  }
  const base = castOpenCodeEndpoint(record);
  const result: { baseUrl?: string; repoPath: string; title?: string } = {
    ...base,
    repoPath: asAbsolutePath(repoPath, "repoPath")
  };
  if (typeof record.title === "string" && record.title.length > 0) {
    result.title = record.title;
  }
  return result;
}

export function castStartWorkerServer(value: unknown): { baseUrl?: string; repoPath: string; sessionId?: string } {
  const record = asStringRecord(value);
  if (typeof record.repoPath !== "string" || record.repoPath.trim().length === 0) {
    throw new DesktopApplicationError("INVALID_INPUT", "A repository path is required to start OpenCode.");
  }
  return {
    ...castOpenCodeEndpoint(record),
    repoPath: asAbsolutePath(record.repoPath, "repoPath"),
    ...(typeof record.sessionId === "string" && record.sessionId.trim().length > 0
      ? { sessionId: record.sessionId }
      : {})
  };
}

export function castUrlInput(value: unknown): { url: string } {
  const record = asStringRecord(value);
  if (typeof record.url !== "string") {
    throw new DesktopApplicationError("INVALID_INPUT", "A URL string is required.");
  }
  return { url: record.url };
}

export function castPlannerEndpoint(value: unknown): { cdpUrl?: string; conversationUrl?: string } {
  const record = asStringRecord(value);
  const result: { cdpUrl?: string; conversationUrl?: string } = {};
  if (typeof record.cdpUrl === "string" && record.cdpUrl.length > 0) {
    result.cdpUrl = asLoopbackUrl(record.cdpUrl, "cdpUrl");
  }
  if (typeof record.conversationUrl === "string" && record.conversationUrl.length > 0) {
    result.conversationUrl = asHttpUrl(record.conversationUrl, "conversationUrl");
  }
  return result;
}

export function castCandidatePair(value: unknown) {
  const record = asStringRecord(value);
  const worker = asStringRecord(record.worker);
  const planner = asStringRecord(record.planner);
  if (typeof record.pairId !== "string" || typeof worker.sessionId !== "string" || typeof worker.repoPath !== "string") {
    throw new DesktopApplicationError(
      "INVALID_INPUT",
      "A candidate pair requires a pairId, worker.sessionId, and worker.repoPath."
    );
  }
  if (typeof planner.conversationId !== "string" || typeof planner.conversationUrl !== "string") {
    throw new DesktopApplicationError(
      "INVALID_INPUT",
      "A candidate pair requires planner.conversationId and planner.conversationUrl."
    );
  }
  const result: {
    pairId: string;
    worker: { sessionId: string; repoPath: string; server?: { baseUrl?: string } };
    planner: { conversationId: string; conversationUrl: string; browser?: { cdpUrl?: string } };
  } = {
    pairId: record.pairId,
    worker: { sessionId: worker.sessionId, repoPath: worker.repoPath },
    planner: { conversationId: planner.conversationId, conversationUrl: planner.conversationUrl }
  };
  const workerServer = castEndpointNested(worker.server);
  const plannerBrowser = castBrowserNested(planner.browser);
  if (workerServer) {
    result.worker.server = workerServer;
  }
  if (plannerBrowser) {
    result.planner.browser = plannerBrowser;
  }
  return result;
}

export function castUpdatePair(value: unknown) {
  const record = asStringRecord(value);
  const result: {
    enabled?: boolean;
    localAgentMode?: boolean;
    worker?: { sessionId?: string; repoPath?: string; server?: { baseUrl?: string } };
    planner?: { conversationId?: string; conversationUrl?: string; browser?: { cdpUrl?: string } };
  } = {};
  if (typeof record.enabled === "boolean") {
    result.enabled = record.enabled;
  }
  if (typeof record.localAgentMode === "boolean") {
    result.localAgentMode = record.localAgentMode;
  }
  const worker = asStringRecord(record.worker);
  const workerResult: NonNullable<typeof result.worker> = {};
  if (typeof worker.sessionId === "string") workerResult.sessionId = worker.sessionId;
  if (typeof worker.repoPath === "string") workerResult.repoPath = worker.repoPath;
  const workerServer = castEndpointNested(worker.server);
  if (workerServer) workerResult.server = workerServer;
  if (Object.keys(workerResult).length > 0) result.worker = workerResult;

  const planner = asStringRecord(record.planner);
  const plannerResult: NonNullable<typeof result.planner> = {};
  if (typeof planner.conversationId === "string") plannerResult.conversationId = planner.conversationId;
  if (typeof planner.conversationUrl === "string") plannerResult.conversationUrl = planner.conversationUrl;
  const plannerBrowser = castBrowserNested(planner.browser);
  if (plannerBrowser) plannerResult.browser = plannerBrowser;
  if (Object.keys(plannerResult).length > 0) result.planner = plannerResult;

  return result;
}

export function castEndpointNested(value: unknown): { baseUrl?: string } | undefined {
  const record = asStringRecord(value);
  if (typeof record.baseUrl !== "string" || record.baseUrl.length === 0) {
    return undefined;
  }
  return { baseUrl: asHttpUrl(record.baseUrl, "baseUrl") };
}

export function castBrowserNested(value: unknown): { cdpUrl?: string } | undefined {
  const record = asStringRecord(value);
  if (typeof record.cdpUrl !== "string" || record.cdpUrl.length === 0) {
    return undefined;
  }
  return { cdpUrl: asLoopbackUrl(record.cdpUrl, "cdpUrl") };
}

export function castRecentEventsFilter(value: unknown): { pairId?: string; limit?: number } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const filter: { pairId?: string; limit?: number } = {};
  if (typeof record.pairId === "string") {
    filter.pairId = record.pairId;
  }
  if (typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0) {
    filter.limit = record.limit;
  }
  return filter;
}

export function asArchiveRef(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) {
    throw new Error("Invalid archive reference.");
  }
  return value;
}
