import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { OpenCodeHttpClient, OpenCodeHttpError } from "../src/adapters/opencode/http.js";
import { observeWorkerSession } from "../src/supervisor/observation.js";
import { makePair } from "./helpers.js";
import { classify, emptyCycleContext } from "../src/supervisor/classifier.js";
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const pair = makePair();
  vi.spyOn(OpenCodeHttpClient.prototype, "health").mockResolvedValue({});
  vi.spyOn(OpenCodeHttpClient.prototype, "getSession").mockResolvedValue({ id: pair.worker.sessionId });
  vi.spyOn(OpenCodeHttpClient.prototype, "listActiveSessions").mockResolvedValue({ [pair.worker.sessionId]: { type: "busy" } });
  vi.spyOn(OpenCodeHttpClient.prototype, "listSessionMessages").mockResolvedValue([{ info: { id: "stream", role: "assistant", time: { created: 1000 } } }]);
  return { pair, adapter: new LiveOpenCodeAdapter({ baseUrl: "http://127.0.0.1:4096" }) };
}
describe("worker observation failure boundaries", () => {
  it("surfaces a running question as waiting for input and excludes reasoning from reports", async () => {
    const { pair, adapter } = fixture();
    vi.mocked(OpenCodeHttpClient.prototype.listSessionMessages).mockResolvedValue([
      { id: "question", type: "assistant", time: { created: 1000 }, content: [
        { type: "reasoning", text: "Private intermediate reasoning" },
        { type: "text", text: "Which task should I continue?" },
        { type: "tool", name: "question", state: { status: "running" } }
      ] },
      { id: "switch", type: "model-switched", time: { created: 2000 } }
    ]);
    const worker = await adapter.observeWorkerSession(pair.worker);
    expect(worker).toMatchObject({ running: true, waitingForInput: true });
    expect(await adapter.getLatestAssistantMessage(pair.worker)).toMatchObject({ text: "Which task should I continue?" });
    expect(classify({
      snapshot: { pairId: pair.pairId, observedAt: new Date().toISOString(), worker,
        planner: { reachable: true, authenticated: true, conversationReachable: true, composerAvailable: true, generating: false } },
      cycle: emptyCycleContext(), continuity: { pairId: pair.pairId, paused: false, lastSupervisorState: "WAITING_WORKER", stateChangedAt: new Date(0).toISOString() }
    }).state).toBe("WAITING_INPUT");
  });
  for (const endpoint of ["listActiveSessions", "listSessionMessages"] as const) {
    it(`does not report healthy idle when ${endpoint} fails`, async () => {
      const { pair, adapter } = fixture();
      vi.mocked(OpenCodeHttpClient.prototype[endpoint]).mockRejectedValue(new Error("temporary read failure"));
      expect(await observeWorkerSession(pair, adapter)).toMatchObject({ reachable: false });
    });
  }
  it("reserves missing-session classification for a definite 404", async () => {
    const { pair, adapter } = fixture();
    vi.mocked(OpenCodeHttpClient.prototype.getSession).mockRejectedValue(new OpenCodeHttpError(404, "Not Found", "missing"));
    expect(await observeWorkerSession(pair, adapter)).toMatchObject({ reachable: true, sessionExists: false });
  });
  it("keeps a streaming assistant busy", async () => {
    const { pair, adapter } = fixture();
    expect(await adapter.observeWorkerSession(pair.worker)).toMatchObject({ gathering: true, running: true });
  });
  it("treats explicit idle status as idle", async () => {
    const { pair, adapter } = fixture();
    vi.mocked(OpenCodeHttpClient.prototype.listActiveSessions).mockResolvedValue({ [pair.worker.sessionId]: { type: "idle" } });
    expect(await adapter.observeWorkerSession(pair.worker)).toMatchObject({ sessionActive: false, gathering: false });
  });
  it("routes transient session lookup failure through transport recovery", async () => {
    const { pair, adapter } = fixture();
    vi.mocked(OpenCodeHttpClient.prototype.getSession).mockRejectedValue(new Error("HTTP 503"));
    expect(await observeWorkerSession(pair, adapter)).toMatchObject({ reachable: false, detail: ["HTTP 503"] });
  });
});
