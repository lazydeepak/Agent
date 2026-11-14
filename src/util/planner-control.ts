/**
 * Agent codebase — module explanation / info.
 * File: src/util/planner-control.ts
 * Purpose: Recognises the planner's terminal control messages (RELAY_COMPLETE / RELAY_BLOCKED).
 * Shared by the adapter (to classify observed planner messages) and the relay (to short-circuit
 * delivering planner control replies back to the worker).
 */

/** Terminal replies from the existing planner protocol are never worker tasks. */
export function plannerControlMessage(text: string): "complete" | "blocked" | undefined {
  const marker = text.trim().match(/^(?:\*\*)?(RELAY_COMPLETE|RELAY_BLOCKED)(?:\*\*)?(?:\s|$)/)?.[1]
    ?? text.trim().match(/(?:^|\n)(?:\*\*)?(RELAY_COMPLETE|RELAY_BLOCKED)(?:\*\*)?$/)?.[1];
  return marker === "RELAY_COMPLETE" ? "complete" : marker === "RELAY_BLOCKED" ? "blocked" : undefined;
}
