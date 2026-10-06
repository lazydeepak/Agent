import type { AttentionItem } from "../../src/contracts/control-plane.js";

export interface AgentRelayClientConfig {
  endpoint: string;
  token: string;
}

export class AgentRelayClient {
  constructor(private readonly config: AgentRelayClientConfig) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.config.endpoint}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
        ...((init?.headers ?? {}) as Record<string, string>),
      },
    });
  }

  async getStatus(): Promise<unknown> {
    const res = await this.request("/status");
    return res.json();
  }

  async getTimeline(pairId?: string, limit?: number): Promise<unknown> {
    const url = new URL("/timeline", this.config.endpoint);
    if (pairId !== undefined) url.searchParams.set("pairId", pairId);
    if (limit !== undefined) url.searchParams.set("limit", String(limit));
    const res = await this.request(url.pathname + url.search);
    return res.json();
  }

  async startProject(projectPairId: string): Promise<unknown> {
    const res = await this.request("/start-project", {
      method: "POST",
      body: JSON.stringify({ projectPairId }),
    });
    return res.json();
  }

  async pauseProject(projectPairId: string): Promise<unknown> {
    const res = await this.request("/pause-project", {
      method: "POST",
      body: JSON.stringify({ projectPairId }),
    });
    return res.json();
  }

  async listAttention(pairId?: string, status?: string): Promise<AttentionItem[]> {
    const url = new URL("/attention/items", this.config.endpoint);
    if (pairId !== undefined) url.searchParams.set("pairId", pairId);
    if (status !== undefined) url.searchParams.set("status", status);
    const res = await this.request(url.pathname + url.search);
    const body = await res.json();
    return (body?.data ?? []) as AttentionItem[];
  }

  async dispatch(op: { type: string; payload?: unknown }): Promise<unknown> {
    const res = await this.request("/dispatch", {
      method: "POST",
      body: JSON.stringify(op),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error?.message ?? "Dispatch failed");
    return body.data;
  }

  async listProjectPairs(): Promise<unknown> {
    return this.dispatch({ type: "listProjectPairs" });
  }

  async createProjectPair(input: { projectPairId?: string; worker: { repoPath: string; projectId?: string }; planner: { projectSlug: string; projectName?: string } }): Promise<unknown> {
    return this.dispatch({ type: "createProjectPair", payload: input });
  }

  async removeProjectPair(projectPairId: string): Promise<unknown> {
    return this.dispatch({ type: "removeProjectPair", payload: { projectPairId } });
  }

  async discoverOpenCodeProjects(): Promise<unknown> {
    return this.dispatch({ type: "discoverOpenCodeProjects" });
  }

  async discoverChatGptProjects(cdpUrl?: string): Promise<unknown> {
    return this.dispatch({ type: "discoverChatGptProjects", payload: cdpUrl ? { cdpUrl } : {} });
  }

  async listPairs(): Promise<unknown> {
    return this.dispatch({ type: "listPairs" });
  }

  async createPair(input: { pairId: string; enabled?: boolean; worker: { sessionId: string; repoPath: string; server?: { baseUrl?: string } }; planner: { conversationId: string; conversationUrl: string; browser?: { cdpUrl?: string } }; projectPairId?: string }): Promise<unknown> {
    return this.dispatch({ type: "createPair", payload: input });
  }

  async updatePair(pairId: string, input: { enabled?: boolean; localAgentMode?: boolean; worker?: { sessionId?: string; repoPath?: string; server?: { baseUrl?: string } }; planner?: { conversationId?: string; conversationUrl?: string; browser?: { cdpUrl?: string } }; projectPairId?: string }): Promise<unknown> {
    return this.dispatch({ type: "updatePair", payload: { pairId, ...input } });
  }

  async removePair(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "removePair", payload: { pairId } });
  }

  async validatePair(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "validatePair", payload: { pairId } });
  }

  async getPair(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "getPair", payload: { pairId } });
  }

  async resumeProject(projectPairId: string): Promise<unknown> {
    return this.dispatch({ type: "resumeProject", payload: { projectPairId } });
  }

  async stopPair(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "stopPair", payload: { pairId } });
  }

  async startAll(): Promise<unknown> {
    return this.dispatch({ type: "startAll" });
  }

  async stopAll(): Promise<unknown> {
    return this.dispatch({ type: "stopAll" });
  }

  async getAutomationInfo(): Promise<unknown> {
    return this.dispatch({ type: "getAutomationInfo" });
  }

  async getWorkerProgress(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "getWorkerProgress", payload: { pairId } });
  }

  async listWorkerModels(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "listWorkerModels", payload: { pairId } });
  }

  async switchWorkerModel(pairId: string, providerId: string, modelId: string, notifyPlanner?: boolean): Promise<unknown> {
    return this.dispatch({ type: "setWorkerModel", payload: { pairId, providerId, modelId, notifyPlanner } });
  }

  async rebindWorker(pairId: string, sessionId: string): Promise<unknown> {
    return this.dispatch({ type: "rebindWorker", payload: { pairId, sessionId } });
  }

  async createWorkerSessionForPair(pairId: string, title?: string): Promise<unknown> {
    return this.dispatch({ type: "createWorkerSessionForPair", payload: { pairId, ...(title ? { title } : {}) } });
  }

  async openWorkerSession(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "openWorkerSession", payload: { pairId } });
  }

  async getRecentEvents(limit?: number): Promise<unknown> {
    return this.dispatch({ type: "getRecentEvents", payload: { limit } });
  }

  async listArchive(): Promise<unknown> {
    return this.dispatch({ type: "listArchive" });
  }

  async deleteArchive(ref: string): Promise<unknown> {
    return this.dispatch({ type: "deleteArchive", payload: { ref } });
  }

  async updateProjectPair(projectPairId: string, input: { worker?: { repoPath?: string; projectId?: string }; planner?: { projectSlug?: string; projectName?: string } }): Promise<unknown> {
    return this.dispatch({ type: "updateProjectPair", payload: { projectPairId, ...input } });
  }

  async seedPlanner(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "seedPlanner", payload: { pairId } });
  }

  async feedLocalAgent(pairId: string): Promise<unknown> {
    return this.dispatch({ type: "feedLocalAgent", payload: { pairId } });
  }

  async scanDesktopWorkerSession(): Promise<unknown> {
    return this.dispatch({ type: "scanDesktopWorkerSession" });
  }

  async startWorkerServer(input: unknown): Promise<unknown> {
    return this.dispatch({ type: "startWorkerServer", payload: input });
  }

  async updateOpenCode(): Promise<unknown> {
    return this.dispatch({ type: "updateOpenCode" });
  }

  async testPlannerEndpoint(input: unknown): Promise<unknown> {
    return this.dispatch({ type: "testPlannerEndpoint", payload: input });
  }

  async startPlannerBrowser(input: unknown): Promise<unknown> {
    return this.dispatch({ type: "startPlannerBrowser", payload: input });
  }

  async createWorkerSession(input: unknown): Promise<unknown> {
    return this.dispatch({ type: "createWorkerSession", payload: input });
  }

  async getOpenCodeEndpoint(): Promise<unknown> {
    return this.dispatch({ type: "getOpenCodeEndpoint" });
  }

  async getChatGptEndpoint(): Promise<unknown> {
    return this.dispatch({ type: "getChatGptEndpoint" });
  }
}