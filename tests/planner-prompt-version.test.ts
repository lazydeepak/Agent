import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  UNIVERSAL_PLANNER_PROMPT,
  UNIVERSAL_PLANNER_PROMPT_VERSION
} from "../src/application/universal-planner-prompt.js";
import {
  LOCAL_AGENT_PLANNER_PROMPT,
  LOCAL_AGENT_PLANNER_PROMPT_VERSION
} from "../src/application/local-agent-planner-prompt.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Digest pinning for the versioned kickoff prompts.
 *
 * Seeded pairs persist `promptVersion`; changing the prompt text on another machine while keeping
 * the version would silently change what "seeded v1" means. When you edit either prompt, bump
 * `_VERSION` AND replace its digest here — the test fails otherwise.
 */
const EXPECTED_VERSION_DIGESTS: Record<string, string> = {
  [`universal:${UNIVERSAL_PLANNER_PROMPT_VERSION}`]:
    "8c00346e069932cd256ade99e6ce61406ac57732d94300d4ab35259fed52c84b",
  [`local-agent:${LOCAL_AGENT_PLANNER_PROMPT_VERSION}`]:
    "aa0c0b2096c340319a0919254711d12426f610e28d0eefed83665b0119909347"
};

describe("versioned planner prompts", () => {
  it("pin the universal prompt to its version digest", () => {
    const key = `universal:${UNIVERSAL_PLANNER_PROMPT_VERSION}`;
    const expected = EXPECTED_VERSION_DIGESTS[key];
    expect(expected, `No pinned digest for universal:${UNIVERSAL_PLANNER_PROMPT_VERSION}`).toBeDefined();
    expect(sha256(UNIVERSAL_PLANNER_PROMPT), "Prompt text changed without a version bump").toBe(expected);
  });

  it("pin the local-agent prompt to its version digest", () => {
    const key = `local-agent:${LOCAL_AGENT_PLANNER_PROMPT_VERSION}`;
    const expected = EXPECTED_VERSION_DIGESTS[key];
    expect(expected, `No pinned digest for local-agent:${LOCAL_AGENT_PLANNER_PROMPT_VERSION}`).toBeDefined();
    expect(sha256(LOCAL_AGENT_PLANNER_PROMPT), "Prompt text changed without a version bump").toBe(expected);
  });
});