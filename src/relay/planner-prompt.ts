/**
 * Agent codebase — module explanation / info.
 * File: src/relay/planner-prompt.ts
 * Purpose: Deterministic selection of the worker prompt from a planner (ChatGPT) assistant message's structured writing_blocks. Consolidated from TerminalBot/RelayLoop.
 */

export type PlannerPromptSelectionStatus = "ready" | "missing" | "ambiguous";

export interface PlannerPromptSelection {
  status: PlannerPromptSelectionStatus;
  /** The prompt to forward when status === "ready". */
  prompt?: string;
  /** Number of writing blocks observed. */
  blockCount: number;
  /** Human-readable reason, suitable for logs/pause messages. */
  reason: string;
}

/**
 * Select the worker prompt from a list of writing blocks extracted from the latest
 * planner assistant message.
 *
 * @param blocks Raw writing-block strings (may be empty/whitespace). Whitespace-only
 *              entries are ignored.
 */
export function selectPlannerPromptFromWritingBlocks(blocks: readonly string[] | undefined | null): PlannerPromptSelection {
  const normalized = (blocks ?? [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return {
      status: "missing",
      blockCount: 0,
      reason: "No writing_block found in the latest planner response; request regeneration."
    };
  }

  if (normalized.length === 1) {
    return {
      status: "ready",
      prompt: normalized[0],
      blockCount: 1,
      reason: "Single writing_block selected as the worker prompt."
    };
  }

  return {
    status: "ambiguous",
    blockCount: normalized.length,
    reason: `Multiple writing_blocks (${normalized.length}) found; worker prompt is ambiguous.`
  };
}

/**
 * Decide whether a second consecutive missing/ambiguous result should pause the
 * relay. TerminalBot pauses with "Worker prompt not available" after the second
 * failure; the first failure triggers a single regeneration request.
 */
export function shouldPauseForMissingPrompt(
  previousStatus: PlannerPromptSelectionStatus | undefined,
  currentStatus: PlannerPromptSelectionStatus
): boolean {
  const failed = currentStatus === "missing" || currentStatus === "ambiguous";
  if (!failed) return false;
  // Pause only when the immediately preceding attempt also failed.
  return previousStatus === "missing" || previousStatus === "ambiguous";
}

export const WORKER_PROMPT_NOT_AVAILABLE = "Worker prompt not available";
