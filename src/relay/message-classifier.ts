import { parseWorkerAttentionEnvelope } from "../application/attention-parser.js";
import type { WorkerMessageClassification, WorkerQuestionNature } from "../types.js";

const QUESTION_PHRASES = [
  /\bplease clarify\b/i,
  /\bclarify whether\b/i,
  /\bclarify which\b/i,
  /\bnot sure whether\b/i,
  /\bnot sure if\b/i,
  /\bshould i\b/i,
  /\bwhat should i\b/i,
  /\bhow should i\b/i,
  /\bcould you clarify\b/i
];

/**
 * Deterministic worker-attention classification.
 * Prioritizes explicit envelope tags, then deterministic question indicators.
 */
export function classifyWorkerMessage(text: string): WorkerMessageClassification {
  const content = text ?? "";
  const envelope = parseWorkerAttentionEnvelope(content);
  if (envelope) {
    if (envelope.kind === "question" || envelope.kind === "blocked") {
      return "question";
    }
    if (envelope.kind === "report" || envelope.kind === "completed") {
      return "report";
    }
  }

  if (content.includes("?")) {
    return "question";
  }

  for (const phrase of QUESTION_PHRASES) {
    if (phrase.test(content)) {
      return "question";
    }
  }

  return "report";
}

export function questionNature(text: string): WorkerQuestionNature | undefined {
  if (classifyWorkerMessage(text) !== "question") {
    return undefined;
  }
  return "planner_input_required";
}
