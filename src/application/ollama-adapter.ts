import type { AttentionAdvisorInput, AttentionAdvisorResult } from "../contracts/ai-proposal.js";
import type { AttentionAdvisorProvider } from "../application/advisor-provider.js";

export interface OllamaAdvisorOptions {
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  maxResponseLength?: number;
}

export class OllamaAdvisorProvider implements AttentionAdvisorProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxResponseLength: number;

  constructor(options: OllamaAdvisorOptions = {}) {
    this.endpoint = options.endpoint ?? process.env.RELAY_OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";
    this.model = options.model ?? process.env.RELAY_OLLAMA_MODEL ?? process.env.OLLAMA_MODEL ?? "llama3.2";
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxResponseLength = options.maxResponseLength ?? 2000;
  }

  async generate(input: AttentionAdvisorInput): Promise<AttentionAdvisorResult> {
    const prompt = buildAdvisorPrompt(input);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama provider error: HTTP ${response.status}`);
      }

      const body = (await response.json()) as { message?: { content?: string } };
      const rawAnswer = (body?.message?.content ?? "").trim();
      const boundedAnswer = rawAnswer.slice(0, this.maxResponseLength);

      return this.parseProposal(boundedAnswer);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Ollama provider timeout.");
      }
      throw new Error(`Ollama provider error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseProposal(text: string): AttentionAdvisorResult {
    const lower = text.toLowerCase();
    if (lower.includes("<agent-relay>") || lower.includes("kind") || lower.includes("blocking")) {
      // The model must not invent its own envelope; any envelope in response indicates confusion.
      return { disposition: "needs_human", rationaleSummary: "Response contained unexpected structured markers; requires human review." };
    }
    return { disposition: "propose_answer", proposedAnswer: text.slice(0, 500) };
  }
}

function buildAdvisorPrompt(input: AttentionAdvisorInput): string {
  return `Agent AI Advisor Protocol (v1):
You receive bounded worker attention metadata (not full repository contents) and must produce a proposal.
Your proposal must be a bounded text answer only — no tool calls, no shell commands, no file mutations.
Worker attention kind: ${input.kind}
Blocking: ${input.kind === "blocked" ? "true" : (input.kind === "question" ? "true" : "false")}
Pair identity (trusted): ${input.pairId}
Bounded recent timeline entries: ${JSON.stringify(input.boundedContext.boundedTimeline ?? [])}
Bounded worker message (first 500 chars): ${input.boundedContext.boundedWorkerMessage ?? "(none)"}
Attention item id (trusted): ${input.attentionId}

Instructions:
- If kind is "blocked" and blocking is true: explain briefly why no safe automated action is possible and what the smallest safe planner/human action would be (max 250 chars).
- If kind is "question": provide a bounded, safe planner-level answer (max 250 chars) that does not invent technical details, does not expose secrets, and does not assume external systems.
- If kind is "report" or "completed": confirm no additional action is needed.
- Never include bearer tokens, passwords, cookies, environment variables, or arbitrary file paths.
- Your answer must be plain bounded text only. Do not embed <agent-relay> tags or JSON objects.
Response:`;
}
