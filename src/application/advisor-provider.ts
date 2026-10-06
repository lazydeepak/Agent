import type { AttentionAdvisorInput, AttentionAdvisorResult, BoundedContext } from "../contracts/ai-proposal.js";

/** Provider abstraction. Implementation must never include arbitrary
 *  tool calls, shell commands, filesystem access, or runtime mutation.
 */
export interface AttentionAdvisorProvider {
  generate(input: AttentionAdvisorInput): Promise<AttentionAdvisorResult>;
}
