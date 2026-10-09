/**
 * Agent-relay codebase — module explanation / info.
 * File: src/relay/verifier.ts
 * Purpose: Source module for verifier.ts.
 */
import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { OpenCodeSessionManager } from "../adapters/opencode/index.js";
import { canonicalizeText } from "../persistence/canonical.js";
import type { RelayRecord, SessionPair } from "../types.js";

export interface VerifierAdapters {
  worker: OpenCodeSessionManager;
  planner: ChatGPTBrowserAdapter;
}

export interface VerificationResult {
  verified: boolean;
  targetId?: string;
  reason?: string;
}

/**
 * Deterministic verifier to reconcile AMBIGUOUS (interrupted) deliveries.
 * It checks the target side for the presence of a message that matches the source.
 */
export class RelayVerifier {
  constructor(private readonly adapters: VerifierAdapters) {}

  async verify(pair: SessionPair, record: RelayRecord): Promise<VerificationResult> {
    if (record.direction === "worker-to-planner") {
      return this.verifyWorkerToPlanner(pair, record);
    } else {
      return this.verifyPlannerToWorker(pair, record);
    }
  }

  private async verifyWorkerToPlanner(pair: SessionPair, record: RelayRecord): Promise<VerificationResult> {
    const { planner } = this.adapters;
    try {
      const messages = await planner.getLatestPlannerMessages?.(pair.planner, { limit: 5 });
      if (!messages) {
        return { verified: false, reason: "Planner adapter does not support multi-message retrieval." };
      }

      // We look for a message that matches the sourceHash (which is based on canonicalized text).
      // Since we don't have user messages in the planner observation (usually only assistant),
      // we need to rely on the fact that some adapters might show them.
      // In the case of Playwright driver, it extracts assistant messages.
      // To verify a worker->planner relay, we need to find the user message we sent.
      
      // If we can't see user messages in the planner adapter, we might need to assume 
      // that if the *latest* assistant message is a response to our suspected message, it was delivered.
      // But that's less deterministic.
      
      return { verified: false, reason: "Worker-to-planner verification requires user message retrieval from ChatGPT." };
    } catch (error) {
      return { verified: false, reason: `Verification failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async verifyPlannerToWorker(pair: SessionPair, record: RelayRecord): Promise<VerificationResult> {
    const { worker } = this.adapters;
    try {
      // For planner-to-worker, we check if the OpenCode session has the message.
      const latest = await worker.getLatestAssistantMessage(pair.worker);
      // We check if the latest assistant message was created after the record's first_seen_at
      // OR if we can find a message that matches the text.
      // OpenCode adapter's getLatestAssistantMessage returns the latest *assistant* (worker) message.
      // We want to check if the *planner* (user) message we sent is there.
      
      // Let's add getLatestUserMessage to OpenCodeSessionManager if needed, 
      // but we can also just check if the worker has responded to it.
      
      return { verified: false, reason: "Planner-to-worker verification not yet implemented." };
    } catch (error) {
      return { verified: false, reason: `Verification failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
