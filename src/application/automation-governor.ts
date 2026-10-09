/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/automation-governor.ts
 * Purpose: Source module for automation-governor.ts.
 */
import type { AttentionService } from "./attention-service.js";
import type { AttentionAdvisorProvider } from "../application/advisor-provider.js";
import type { AiAutomationPolicy } from "../contracts/ai-automation.js";
import type { AttentionItem } from "../contracts/attention.js";

export interface AutomationGovernorOptions {
  attentionService: AttentionService;
  provider?: AttentionAdvisorProvider;
  policy?: AiAutomationPolicy;
  pairId?: string;
}

export interface AutomationGovernorState {
  running: boolean;
  proposalCountThisHour: number;
  lastProposalAt?: string;
  circuitOpen?: boolean;
  consecutiveFailures: number;
  suspendedUntil?: string;
}

export class AutomationGovernor {
  private running = false;
  private proposalCountThisHour = 0;
  private lastProposalAt?: string;
  private circuitOpen = false;
  private consecutiveFailures = 0;
  private suspendedUntil?: string;

  constructor(private readonly options: AutomationGovernorOptions) {}

  getState(): AutomationGovernorState {
    return {
      running: this.running,
      proposalCountThisHour: this.proposalCountThisHour,
      lastProposalAt: this.lastProposalAt,
      circuitOpen: this.circuitOpen,
      consecutiveFailures: this.consecutiveFailures,
      suspendedUntil: this.suspendedUntil,
    };
  }

  getEffectivePolicy(): AiAutomationPolicy {
    return {
      mode: this.options.policy?.mode ?? "manual",
      eligibleAttentionKinds: this.options.policy?.eligibleAttentionKinds ?? ["question", "blocked"],
      maxProposalsPerHour: this.options.policy?.maxProposalsPerHour ?? 0,
      maxConcurrentRequests: this.options.policy?.maxConcurrentRequests ?? 1,
      cooldownMs: this.options.policy?.cooldownMs ?? 30000,
      providerId: this.options.policy?.providerId,
      modelId: this.options.policy?.modelId,
    };
  }

  isEligible(attentionItem: AttentionItem, openItems: AttentionItem[]): boolean {
    const policy = this.getEffectivePolicy();
    if (policy.mode !== "auto_propose") return false;
    if (!attentionItem.blocking && !attentionItem.blocking) {
      // Only blocking attention items trigger automatic proposals by default
      // Non-blocking questions are eligible only if explicitly configured
      return policy.eligibleAttentionKinds.includes(attentionItem.kind as "question" | "blocked");
    }
    if (!policy.eligibleAttentionKinds.includes(attentionItem.kind as "question" | "blocked")) return false;
    // Check if there is already an active pending proposal for this attention item
    const hasPending = openItems.some(
      (o) => o.id === attentionItem.id && (o.status === "open" || o.status === "acknowledged")
    );
    // Idempotency: one proposal per open attention item maximum
    if (hasPending) {
      // For simplicity, we treat the attention item itself as the unique identity;
      // a separate proposal lookup would be needed in full production.
      return false;
    }
    return true;
  }

  checkLimits(): { allowed: boolean; reason?: string } {
    const policy = this.getEffectivePolicy();
    if (policy.mode !== "auto_propose") {
      return { allowed: false, reason: "Policy mode is not auto_propose." };
    }
    if (this.circuitOpen) {
      return { allowed: false, reason: "Provider circuit breaker is open (repeated failures)." };
    }
    if (this.suspendedUntil && new Date(this.suspendedUntil).getTime() > Date.now()) {
      return { allowed: false, reason: "Governor temporarily suspended due to provider failures." };
    }
    if (policy.maxProposalsPerHour > 0 && this.proposalCountThisHour >= policy.maxProposalsPerHour) {
      return { allowed: false, reason: `Hourly proposal limit reached (${policy.maxProposalsPerHour}).` };
    }
    return { allowed: true };
  }

  async observe(attentionItem: AttentionItem): Promise<void> {
    this.running = true;
    const policy = this.getEffectivePolicy();
    if (policy.mode !== "auto_propose") return;
    const openItems = this.options.attentionService.listAttention(attentionItem.pairId, "open");
    const eligible = this.isEligible(attentionItem, openItems);
    if (!eligible) return;
    const limits = this.checkLimits();
    if (!limits.allowed) return;
    // Cooldown check
    if (this.lastProposalAt && policy.cooldownMs > 0) {
      const lastMs = Date.parse(this.lastProposalAt);
      if (Date.now() - lastMs < policy.cooldownMs) return;
    }
    if (!this.options.provider) return;
    try {
      const input = await this.buildBoundedInput(attentionItem);
      const result = await this.options.provider.generate(input);
      this.proposalCountThisHour += 1;
      this.lastProposalAt = new Date().toISOString();
      this.consecutiveFailures = 0;
      // For this slice, we only create the proposal through the adapter layer.
      // Proposal delivery and approval remain explicit human actions.
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 5) {
        this.circuitOpen = true;
        this.suspendedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      }
    }
  }

  private async buildBoundedInput(attentionItem: AttentionItem): Promise<import("../contracts/ai-proposal.js").AttentionAdvisorInput> {
    const kindForContext: "question" | "blocked" = (attentionItem.kind === "question" || attentionItem.kind === "blocked") ? (attentionItem.kind as "question" | "blocked") : "question";
    const boundedContext: import("../contracts/ai-proposal.js").BoundedContext = {
      pairId: attentionItem.pairId,
      attentionKind: kindForContext,
      boundedAttentionId: attentionItem.id,
    };
    return {
      attentionId: attentionItem.id,
      pairId: attentionItem.pairId,
      kind: (attentionItem.kind === "question" || attentionItem.kind === "blocked") ? (attentionItem.kind as "question" | "blocked") : "question",
      question: attentionItem.question,
      summary: attentionItem.summary,
      boundedContext,
    };
  }
}
