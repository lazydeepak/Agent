/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/worker-question-service.ts
 * Purpose: Source module for worker-question-service.ts.
 */
import { resolve } from "node:path";
import { OpenCodeHttpClient, type OpenCodeClientOptions } from "../adapters/opencode/http.js";
import type { SessionPair } from "../types.js";

/** Explicit question replies, separate from ordinary queued planner prompts. */
export class WorkerQuestionService {
  private readonly pending = new Set<string>();

  constructor(private readonly options: OpenCodeClientOptions = {}) {}

  private client(pair: SessionPair): OpenCodeHttpClient {
    return new OpenCodeHttpClient({ ...pair.worker.server, ...this.options, allowInsecureAuth: true });
  }

  async list(pair: SessionPair) {
    return this.client(pair).listQuestions(pair.worker.sessionId);
  }

  async answer(pair: SessionPair, requestId: string, answers: string[][]): Promise<void> {
    if (this.pending.has(pair.pairId)) throw new Error("A question reply is already in progress for this pair.");
    this.pending.add(pair.pairId);
    try {
      const client = this.client(pair);
      const session = await client.getSession(pair.worker.sessionId);
      const directory = session.directory ?? session.location?.directory;
      if (!directory || resolve(directory) !== resolve(pair.worker.repoPath)) throw new Error("Worker repository mismatch; question reply refused.");
      const question = (await client.listQuestions(pair.worker.sessionId)).find((item) => item.id === requestId);
      if (!question) throw new Error("This question is no longer pending for the bound worker session. Refresh before replying.");
      if (!Array.isArray(answers) || answers.length !== question.questions.length || answers.some((answer) =>
        !Array.isArray(answer) || !answer.length || answer.some((text) => typeof text !== "string" || !text.trim() || text.length > 32000)
      )) throw new Error("Provide a non-empty answer for every question (maximum 32000 characters each).");
      await client.answerQuestion(pair.worker.sessionId, requestId, answers);
    } finally {
      this.pending.delete(pair.pairId);
    }
  }
}
