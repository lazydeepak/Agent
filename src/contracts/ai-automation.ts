/** AI automation policy contract — transport-neutral, explicit, deterministic.
 *
 * Policy must never give a model autonomous authority to send answers,
 * resolve attention, execute commands, or alter repositories.
 */

export type AiAutomationMode =
  | "off"
  | "manual"
  | "auto_propose";

export interface AiAutomationPolicy {
  mode: AiAutomationMode;
  eligibleAttentionKinds: Array<"question" | "blocked">;
  maxProposalsPerHour: number;
  maxConcurrentRequests: number;
  cooldownMs: number;
  providerId?: string;
  modelId?: string;
}
