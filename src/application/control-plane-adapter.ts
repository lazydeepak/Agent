/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/control-plane-adapter.ts
 * Purpose: Control-plane adapter for worker/planner pairs.
 */
import { resolve } from "node:path";
import { DesktopApplicationService } from "./desktop-service.js";
import { ProjectPairService } from "./project-pair-service.js";
import type { RelayStore } from "../persistence/index.js";
import { AttentionService } from "./attention-service.js";
import { LiveOpenCodeAdapter } from "../adapters/opencode/index.js";
import { parseWorkerAttentionEnvelope } from "./attention-parser.js";
import type {
  ControlPlaneOperation,
  GetStatusPayload,
  GetTimelinePayload,
  StartProjectPayload,
  PauseProjectPayload,
  ListAttentionPayload,
  AcknowledgeAttentionPayload,
  ResolveAttentionPayload,
} from "../contracts/control-plane.js";

/** Thin transport-neutral adapter that maps typed control-plane operations
 *  to the existing DesktopApplicationService without duplicating runtime,
 *  scheduler, recovery, relay, persistence, or validation logic.
 */
export class ControlPlaneAdapter {
  private readonly attention?: AttentionService;

  constructor(private readonly service: DesktopApplicationService, private readonly projectPairService: ProjectPairService) {
    const store = service.getStore();
    if (store) {
      this.attention = new AttentionService({ service, store });
    }
  }

  async dispatch(op: ControlPlaneOperation): Promise<unknown> {
    switch (op.type) {
      case "getStatus": {
        return this.service.getStatus();
      }
      case "getTimeline": {
        const payload = (op.payload ?? {}) as GetTimelinePayload;
        return this.service.getTimeline(payload.pairId, payload.limit);
      }
      case "startProject": {
        const payload = op.payload as StartProjectPayload;
        if (!payload || typeof payload.projectPairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "startProject requires a valid projectPairId");
        }
        return this.service.startProject(payload.projectPairId);
      }
      case "pauseProject": {
        const payload = op.payload as PauseProjectPayload;
        if (!payload || typeof payload.projectPairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "pauseProject requires a valid projectPairId");
        }
        return this.service.pauseProject(payload.projectPairId);
      }
      case "createAttentionProposal": {
        return this.createProposal(op.payload as any);
      }
      case "approveAttentionProposal": {
        const payload = op.payload as { proposalId: string };
        if (!payload || typeof payload.proposalId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "approveAttentionProposal requires a valid proposalId");
        }
        return this.approveProposal(payload.proposalId);
      }
      case "rejectAttentionProposal": {
        const payload = op.payload as { proposalId: string };
        if (!payload || typeof payload.proposalId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "rejectAttentionProposal requires a valid proposalId");
        }
        return this.rejectProposal(payload.proposalId);
      }
      case "listAttentionProposals": {
        const payload = (op.payload ?? {}) as { pairId?: string; status?: string };
        const store = this.service.getStore();
        return store ? store.listProposals(payload.pairId, payload.status) : [];
      }
      case "getAttentionProposal": {
        const payload = op.payload as { proposalId: string };
        if (!payload || typeof payload.proposalId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "getAttentionProposal requires a valid proposalId");
        }
        const store = this.service.getStore();
        return store ? store.getProposalById(parseInt(payload.proposalId, 10)) ?? undefined : undefined;
      }
      case "listAttention": {
        const payload = (op.payload ?? {}) as ListAttentionPayload;
        return this.attention?.listAttention(payload.pairId, payload.status as "open" | "acknowledged" | "resolved" | undefined) ?? [];
      }
      case "acknowledgeAttention": {
        const payload = op.payload as AcknowledgeAttentionPayload;
        if (!payload || typeof payload.id !== "number") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "acknowledgeAttention requires a valid id");
        }
        return this.attention?.acknowledge(payload.id) ?? undefined;
      }
      case "resolveAttention": {
        const payload = op.payload as ResolveAttentionPayload;
        if (!payload || typeof payload.id !== "number") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "resolveAttention requires a valid id");
        }
        return this.attention?.resolve(payload.id, payload.plannerSourceMessageId) ?? undefined;
      }
      case "listProjectPairs": {
        return this.projectPairService.listProjectPairs();
      }
      case "createProjectPair": {
        const payload = op.payload as any;
        if (!payload || typeof payload !== "object") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "createProjectPair requires a valid payload");
        }
        return this.projectPairService.createProjectPair({
          projectPairId: payload.projectPairId,
          worker: {
            repoPath: payload.worker?.repoPath ?? "",
            ...(payload.worker?.projectId ? { projectId: payload.worker.projectId } : {}),
          },
          planner: {
            projectSlug: payload.planner?.projectSlug ?? "",
            ...(payload.planner?.projectName ? { projectName: payload.planner.projectName } : {}),
          },
        });
      }
      case "removeProjectPair": {
        const payload = op.payload as { projectPairId?: string };
        if (!payload || typeof payload.projectPairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "removeProjectPair requires a valid projectPairId");
        }
        return this.projectPairService.removeProjectPair(payload.projectPairId);
      }
      case "discoverOpenCodeProjects": {
        return this.projectPairService.discoverOpenCodeProjects();
      }
      case "discoverChatGptProjects": {
        const payload = (op.payload ?? {}) as { cdpUrl?: string };
        return this.projectPairService.discoverChatGptProjects(payload.cdpUrl);
      }
      case "listPairs": {
        return this.service.listPairs();
      }
      case "createPair": {
        const payload = op.payload as any;
        if (!payload || typeof payload !== "object") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "createPair requires a valid payload");
        }
        return this.service.createPair({
          pairId: payload.pairId,
          worker: {
            sessionId: payload.worker?.sessionId ?? "",
            repoPath: payload.worker?.repoPath ?? "",
            ...(payload.worker?.server ? { server: payload.worker.server } : {}),
          },
          planner: {
            conversationId: payload.planner?.conversationId ?? "",
            conversationUrl: payload.planner?.conversationUrl ?? "",
            ...(payload.planner?.browser ? { browser: payload.planner.browser } : {}),
          },
          ...(payload.projectPairId ? { projectPairId: payload.projectPairId } : {}),
        });
      }
      case "updatePair": {
        const payload = op.payload as any;
        if (!payload || typeof payload.pairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "updatePair requires a valid pairId");
        }
        const edits: any = {};
        if (payload.enabled !== undefined) edits.enabled = payload.enabled;
        if (payload.localAgentMode !== undefined) edits.localAgentMode = payload.localAgentMode;
        if (payload.worker) {
          edits.worker = {};
          if (payload.worker.sessionId !== undefined) edits.worker.sessionId = payload.worker.sessionId;
          if (payload.worker.repoPath !== undefined) edits.worker.repoPath = payload.worker.repoPath;
          if (payload.worker.server !== undefined) edits.worker.server = { ...(edits.worker.server ?? {}), ...payload.worker.server };
        }
        if (payload.planner) {
          edits.planner = {};
          if (payload.planner.conversationId !== undefined) edits.planner.conversationId = payload.planner.conversationId;
          if (payload.planner.conversationUrl !== undefined) edits.planner.conversationUrl = payload.planner.conversationUrl;
          if (payload.planner.browser !== undefined) edits.planner.browser = { ...(edits.planner.browser ?? {}), ...payload.planner.browser };
        }
        if (payload.projectPairId !== undefined) edits.projectPairId = payload.projectPairId;
        return this.service.updatePair(payload.pairId, edits);
      }
      case "removePair": {
        const payload = op.payload as { pairId?: string };
        if (!payload || typeof payload.pairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "removePair requires a valid pairId");
        }
        return this.service.removePair(payload.pairId);
      }
      case "archivePair": {
        const payload = op.payload as { pairId?: string };
        if (!payload || typeof payload.pairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "archivePair requires a valid pairId");
        }
        return this.service.removePair(payload.pairId);
      }
      case "getPair": {
        const getPayload = op.payload as { pairId?: string };
        if (!getPayload || typeof getPayload.pairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "getPair requires a valid pairId");
        }
        return this.service.getPairDetail(getPayload.pairId);
      }
      case "discoverWorkerSessions": {
        const discoverPayload = op.payload as { pairId?: string; baseUrl?: string };
        if (!discoverPayload || typeof discoverPayload.pairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "discoverWorkerSessions requires a valid pairId");
        }
        return this.service.listOpenCodeSessions(discoverPayload.pairId);
      }
      case "bindWorkerSession": {
        const bindPayload = op.payload as { pairId?: string; sessionId?: string };
        if (!bindPayload || typeof bindPayload.pairId !== "string" || typeof bindPayload.sessionId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "bindWorkerSession requires valid pairId and sessionId");
        }
        const pair = this.service.getPairDetail(bindPayload.pairId);
        if (!pair) {
          throw new ControlPlaneOperationError("UNKNOWN_PAIR", `Pair "${bindPayload.pairId}" not found.`);
        }
        // Strict repository isolation: verify the selected session belongs to the pair's repo.
        const baseUrl = pair.worker.server?.baseUrl || "http://127.0.0.1:4096";
        const workerAdapter = new LiveOpenCodeAdapter({ ...pair.worker.server, baseUrl });
        let sessionInfo;
        try {
          sessionInfo = await workerAdapter.getSession(bindPayload.sessionId);
        } catch {
          sessionInfo = undefined;
        }
        if (!sessionInfo) {
          throw new ControlPlaneOperationError("WORKER_SESSION_NOT_FOUND", `Worker session ${bindPayload.sessionId} was not found on the configured server.`);
        }
        const sessionRepoPath = sessionInfo.repoPath ?? (sessionInfo as any).directory ?? (sessionInfo as any).location?.directory ?? "";
          const configuredRepo = pair.worker.repoPath?.trim() ?? "";
          if (configuredRepo) {
            const configuredResolved = resolve(configuredRepo);
            const sessionResolved = sessionRepoPath ? resolve(sessionRepoPath) : "";
            if (sessionResolved && configuredResolved !== sessionResolved) {
              throw new ControlPlaneOperationError(
                "WORKER_SESSION_REPO_MISMATCH",
                `WORKER_SESSION_REPO_MISMATCH: selected session belongs to "${sessionRepoPath}" but pair is configured for repo "${configuredRepo}". Reselect a compatible session or update repository.`
              );
            }
          }
        return this.service.rebindWorker(bindPayload.pairId, bindPayload.sessionId);
      }
      case "updateProjectPair": {
        const payload = op.payload as { projectPairId?: string; worker?: { repoPath?: string; projectId?: string }; planner?: { projectSlug?: string; projectName?: string } };
        if (!payload || typeof payload.projectPairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "updateProjectPair requires a valid projectPairId");
        }
        return this.projectPairService.updateProjectPair(payload.projectPairId, {
          ...(payload.worker ? { worker: payload.worker } : {}),
          ...(payload.planner ? { planner: payload.planner } : {}),
        });
      }
      case "archiveProjectPair": {
        const payload = op.payload as { projectPairId?: string };
        if (!payload || typeof payload.projectPairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "archiveProjectPair requires a valid projectPairId");
        }
        return this.projectPairService.removeProjectPair(payload.projectPairId);
      }
      case "listWorkerModels": {
        const payload = op.payload as { pairId?: string };
        if (!payload || typeof payload.pairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "listWorkerModels requires a valid pairId");
        }
        return this.service.listWorkerModels(payload.pairId);
      }
      case "setWorkerModel": {
        const payload = op.payload as { pairId?: string; providerId?: string; modelId?: string; notifyPlanner?: boolean };
        if (!payload || typeof payload.pairId !== "string" || typeof payload.providerId !== "string" || typeof payload.modelId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "setWorkerModel requires valid pairId, providerId and modelId");
        }
        return this.service.switchWorkerModel(payload.pairId, { providerID: payload.providerId, id: payload.modelId }, Boolean(payload.notifyPlanner));
      }
      case "validatePair": {
        const payload = op.payload as { pairId?: string };
        if (!payload || typeof payload.pairId !== "string") {
          throw new ControlPlaneOperationError("INVALID_PAYLOAD", "validatePair requires a valid pairId");
        }
        return this.service.validatePair(payload.pairId);
      }
      default: {
        const unknown = (op as { type?: unknown }).type;
        throw new ControlPlaneOperationError("UNKNOWN_OPERATION", `Unknown operation: ${String(unknown)}`);
      }
    }
  }

  getStatus(): unknown {
    return this.service.getStatus();
  }

  getTimeline(pairId?: string, limit?: number): unknown {
    return this.service.getTimeline(pairId, limit);
  }

  async startProject(projectPairId: string): Promise<unknown> {
    return this.service.startProject(projectPairId);
  }

  async pauseProject(projectPairId: string): Promise<unknown> {
    return this.service.pauseProject(projectPairId);
  }

  subscribeEvents(listener: (event: SafeRemoteEvent) => void): () => void {
    return this.service.subscribeEvents((record) => {
      listener(projectToSafeRemoteEvent(record));
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  async observeWorkerAttention(pairId: string, sourceMessageId: string, text: string): Promise<import("../contracts/attention.js").AttentionItem | undefined> {
    return this.attention ? await this.attention?.observeWorkerResponse(pairId, sourceMessageId, text) : undefined;
  }

  createProposal(input: import("../contracts/control-plane.js").CreateAttentionProposalPayload): unknown {
    const store = this.service.getStore();
    if (!store) return undefined;
    try {
      const proposalId = `prop-${Date.now()}-${input.attentionId}`;
      const pairId = input.pairId || "unknown";
      const id = store.createProposal({
        proposalId,
        pairId,
        attentionId: input.attentionId,
        provider: input.provider ?? "ollama",
        model: input.model ?? "llama3.2",
        disposition: "PENDING",
      });
      return { proposalId, id, status: "PENDING", pairId, attentionId: input.attentionId };
    } catch {
      return undefined;
    }
  }

  approveProposal(proposalId: string): unknown {
    const store = this.service.getStore();
    if (!store) return undefined;
    try {
      const proposals = store.listProposals();
      const proposal = proposals.find((p) => p.proposalId === proposalId);
      if (!proposal) return undefined;
      store.updateProposalStatus(proposal.id, "APPROVED");
      return { proposalId, status: "APPROVED", deliveredAt: undefined };
    } catch {
      return undefined;
    }
  }

  rejectProposal(proposalId: string): unknown {
    const store = this.service.getStore();
    if (!store) return undefined;
    try {
      const proposals = store.listProposals();
      const proposal = proposals.find((p) => p.proposalId === proposalId);
      if (!proposal) return undefined;
      store.updateProposalStatus(proposal.id, "REJECTED");
      return { proposalId, status: "REJECTED" };
    } catch {
      return undefined;
    }
  }
}

export interface SafeRemoteEvent {
  id: string;
  time: string;
  type: string;
  pairId?: string;
  projectPairId?: string;
  data?: Record<string, unknown>;
}

export class ControlPlaneOperationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ControlPlaneOperationError";
    this.code = code;
  }
}

function projectToSafeRemoteEvent(record: {
  time: string;
  type: string;
  pairId?: string;
  projectPairId?: string;
  state?: string;
  previousState?: string;
  reason?: string;
  details?: Record<string, unknown>;
}): SafeRemoteEvent {
  return {
    id: generateEventId(record),
    time: record.time,
    type: record.type,
    ...(record.pairId ? { pairId: record.pairId } : {}),
    ...(record.projectPairId ? { projectPairId: record.projectPairId } : {}),
    data: {
      ...(record.state ? { state: record.state } : {}),
      ...(record.previousState ? { previousState: record.previousState } : {}),
      ...(record.reason ? { reason: record.reason } : {}),
      ...(record.details ? { details: sanitizeDetails(record.details) } : {}),
    },
  };
}

function generateEventId(record: { time: string; type: string; pairId?: string; projectPairId?: string }): string {
  const seed = `${record.time}:${record.type}:${record.pairId ?? ""}:${record.projectPairId ?? ""}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  const positive = Math.abs(hash).toString(36).padStart(8, "0").slice(0, 8);
  return `evt-${positive}-${record.time.slice(-10)}`;
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const safeKeys = new Set([
    "validatedAt", "failedChecks", "requestedAction", "results",
    "pairResults", "aggregate", "reason", "state", "previousState",
    "selected", "fallback", "sessionId", "repoPath", "title",
  ]);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const lowerKey = String(key).toLowerCase();
    if (lowerKey.includes("password") || lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("cookie") || lowerKey.includes("credential")) {
      continue;
    }
    if (lowerKey.includes("env") || lowerKey.includes("path") && typeof value === "string" && (String(value).includes("/secret") || String(value).includes(".env"))) {
      continue;
    }
    if (!safeKeys.has(key) && !key.startsWith("start") && !key.startsWith("pause") && !key.startsWith("resume") && !key.startsWith("pair")) {
      if (key !== "action" && key !== "selected" && key !== "results" && key !== "pairResults") {
        continue;
      }
    }
    safe[key] = value;
  }
  return safe;
}
