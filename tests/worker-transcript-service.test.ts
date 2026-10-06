import { afterEach, expect, it, vi } from "vitest";
import { readWorkerTranscript } from "../src/application/worker-transcript-service.js";
import { OpenCodeHttpClient } from "../src/adapters/opencode/http.js";
import { LiveOpenCodeAdapter } from "../src/adapters/opencode/index.js";
import { makePair } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const pair = makePair();
  pair.worker.server = { baseUrl: "http://127.0.0.1:4096" };
  const session = vi.spyOn(OpenCodeHttpClient.prototype, "getSession").mockResolvedValue({
    id: pair.worker.sessionId, location: { directory: pair.worker.repoPath }, model: { providerID: "opencode", id: "big-pickle" }
  });
  const messages = vi.spyOn(OpenCodeHttpClient.prototype, "listSessionMessages").mockResolvedValue([
    { id: "new", type: "assistant", time: { created: 2 }, content: [
      { type: "reasoning", text: "private reasoning" },
      { type: "text", text: "<script>visible report</script>" },
      { type: "tool", name: "bash", state: { status: "completed", input: { secret: "hidden" } } }
    ] },
    { id: "old", type: "user", time: { created: 1 }, text: "Task" }
  ]);
  vi.spyOn(LiveOpenCodeAdapter.prototype, "observeWorkerSession").mockResolvedValue({ reachable: true, sessionExists: true, sessionActive: true, running: true, gathering: true });
  return { pair, session, messages };
}
it("uses the relay message reader, orders messages, and exposes only visible content", async () => {
  const { pair, messages } = fixture();
  const result = await readWorkerTranscript(pair);
  expect(messages).toHaveBeenCalledWith(pair.worker.sessionId);
  expect(result.model).toBe("opencode/big-pickle");
  expect(result.running).toBe(true);
  expect(result.messages.map(m => m.id)).toEqual(["old", "new"]);
  expect(result.messages[1]?.text).toBe("<script>visible report</script>\n[Tool: bash — completed]");
  expect(JSON.stringify(result)).not.toMatch(/private reasoning|hidden/);
});
it("refuses another session or repository before reading its messages", async () => {
  const { pair, session, messages } = fixture();
  session.mockResolvedValue({ id: "another", directory: pair.worker.repoPath });
  await expect(readWorkerTranscript(pair)).rejects.toThrow("mismatch");
  session.mockResolvedValue({ id: pair.worker.sessionId, directory: "/another" });
  await expect(readWorkerTranscript(pair)).rejects.toThrow("mismatch");
  expect(messages).not.toHaveBeenCalled();
});
it("propagates transport failures instead of presenting cached content as live", async () => {
  const { pair, messages } = fixture();
  messages.mockRejectedValue(new Error("offline"));
  await expect(readWorkerTranscript(pair)).rejects.toThrow("offline");
});
