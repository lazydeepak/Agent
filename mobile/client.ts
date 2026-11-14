// Minimal client for Agent's remote HTTP control API.
// Usable from mobile web, or Node. No native dependencies.

export interface AgentClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  retryCount?: number;
  retryDelayMs?: number;
}

export class AgentClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryCount: number;
  private readonly retryDelayMs: number;

  constructor(options: AgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryCount = options.retryCount ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          // Do not retry client errors.
          if (res.status >= 400 && res.status < 500) {
            throw new Error(`Agent request failed: ${res.status} ${res.statusText}`);
          }
          throw new Error(`Agent request failed: ${res.status} ${res.statusText}`);
        }
        return await res.json();
      } catch (error) {
        lastError = error;
        if (attempt < this.retryCount) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  health() { return this.request("/health"); }
  status() { return this.request("/status"); }
  timeline(limit?: number) { return this.request(`/timeline${limit ? `?limit=${limit}` : ""}`); }
  startProject(projectPairId: string) { return this.request("/start-project", { method: "POST", body: JSON.stringify({ projectPairId }) }); }
  pauseProject(projectPairId: string) { return this.request("/pause-project", { method: "POST", body: JSON.stringify({ projectPairId }) }); }
  attention() { return this.request("/attention"); }
  proposals() { return this.request("/attention/proposals"); }
  approveProposal(proposalId: string) { return this.request("/attention/proposal/approve", { method: "POST", body: JSON.stringify({ proposalId }) }); }
  rejectProposal(proposalId: string) { return this.request("/attention/proposal/reject", { method: "POST", body: JSON.stringify({ proposalId }) }); }
  dispatch(payload: unknown) { return this.request("/dispatch", { method: "POST", body: JSON.stringify(payload) }); }
}
