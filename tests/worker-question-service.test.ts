import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerQuestionService } from "../src/application/worker-question-service.js";
import { OpenCodeHttpClient } from "../src/adapters/opencode/http.js";
import { makePair } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const pair = makePair();
  pair.worker.server = { baseUrl: "http://127.0.0.1:4096" };
  vi.spyOn(OpenCodeHttpClient.prototype, "getSession").mockResolvedValue({ id: pair.worker.sessionId, directory: pair.worker.repoPath });
  vi.spyOn(OpenCodeHttpClient.prototype, "listQuestions").mockResolvedValue([{ id: "que_test", sessionID: pair.worker.sessionId, questions: [{ question: "Which task?", options: [] }] }]);
  const reply = vi.spyOn(OpenCodeHttpClient.prototype, "answerQuestion").mockResolvedValue();
  return { pair, reply, service: new WorkerQuestionService() };
}
describe("explicit worker question replies", () => {
  it("answers the bound session through the question endpoint", async () => {
    const { pair, reply, service } = fixture();
    await service.answer(pair, "que_test", [["Run the existing read-only probe"]]);
    expect(reply).toHaveBeenCalledWith(pair.worker.sessionId, "que_test", [["Run the existing read-only probe"]]);
  });
  it("refuses stale questions and mismatched repositories without sending", async () => {
    const { pair, reply, service } = fixture();
    await expect(service.answer(pair, "que_stale", [["answer"]])).rejects.toThrow("no longer pending");
    vi.mocked(OpenCodeHttpClient.prototype.getSession).mockResolvedValue({ id: pair.worker.sessionId, directory: "/other" });
    await expect(service.answer(pair, "que_test", [["answer"]])).rejects.toThrow("repository mismatch");
    expect(reply).not.toHaveBeenCalled();
  });
  it("validates every answer and refuses concurrent sends", async () => {
    const { pair, reply, service } = fixture();
    await expect(service.answer(pair, "que_test", [[]])).rejects.toThrow("non-empty");
    let finish!: () => void;
    reply.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = service.answer(pair, "que_test", [["answer"]]);
    await expect(service.answer(pair, "que_test", [["answer"]])).rejects.toThrow("already in progress");
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    finish();
    await first;
  });
});
