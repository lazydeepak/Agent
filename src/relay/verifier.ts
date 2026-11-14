/**
 * Agent codebase — module explanation / info.
 * File: src/relay/verifier.ts
 * Purpose: Deterministic delivery verification (Rule 12).
 *
 * Verification strategy per direction:
 * - planner-to-worker: the OpenCode session can be searched for the delivered user message
 *   by exact target id (recorded on the relay record) or by content hash (source hash of the
 *   pre-watermark text). Deterministic message-identity evidence.
 * - worker-to-planner: live ChatGPT observation cannot surface user messages; the fake/test
 *   adapter attests delivery via its own sent-message log. When no evidence is available,
 *   verification deterministically reports "unverified" and the supervisor retries on the
 *   Rule 13 interval, then escalates to the Recovery Agent — it never resends blindly.
 */
import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { OpenCodeSessionManager } from "../adapters/opencode/index.js";
import { stripWatermark } from "../util/watermark.js";
import { hashText } from "../util/canonical.js";
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

/** Rule 13 — wait 2 minutes between verification retries of an unconfirmed message. */
export const RELAY_VERIFY_RETRY_MS = 2 * 60 * 1000;

/** Rule 12 — after this many failed verification attempts, escalate to the Recovery Agent. */
export const RELAY_VERIFY_MAX_ATTEMPTS = 3;

/** Normalize an observed message back to its pre-watermark form before hashing. */
function sourceHashOfObserved(text: string): string {
  return hashText(stripWatermark(text));
}

export { sourceHashOfObserved };

/**
 * Deterministic verifier to reconcile AMBIGUOUS (interrupted) deliveries.
 * It checks the target side for the presence of a message that matches the source.
 */
export class RelayVerifier {
  constructor(private readonly adapters: VerifierAdapters) {}

  async verify(pair: SessionPair, record: RelayRecord): Promise<VerificationResult> {
    if (record.direction === "planner-to-worker") {
      return this.verifyPlannerToWorker(pair, record);
    }
    return this.verifyWorkerToPlanner(pair, record);
  }

  private async verifyPlannerToWorker(pair: SessionPair, record: RelayRecord): Promise<VerificationResult> {
    const { worker } = this.adapters;
    if (typeof worker.findUserMessageByIdentity !== "function") {
      return { verified: false, reason: "Worker adapter cannot look up messages by identity." };
    }
    try {
      const found = await worker.findUserMessageByIdentity(pair.worker, {
        targetId: record.targetId,
        sourceHash: record.sourceHash
      });
      if (found) {
        return { verified: true, targetId: found.id };
      }
      return {
        verified: false,
        reason: "No user message matching the relay identity exists in the worker session."
      };
    } catch (error) {
      return {
        verified: false,
        reason: `Verification failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async verifyWorkerToPlanner(pair: SessionPair, record: RelayRecord): Promise<VerificationResult> {
    const { planner } = this.adapters;
    const attester = (planner as ChatGPTBrowserAdapter & {
      attestDelivery?(planner: SessionPair["planner"], sourceHash: string): Promise<boolean>;
    }).attestDelivery;
    if (typeof attester !== "function") {
      return {
        verified: false,
        reason: "Planner adapter cannot expose user-message history; reconciliation needs a CDP-backed check."
      };
    }
    try {
      const attested = await attester.call(planner, pair.planner, record.sourceHash);
      return attested
        ? { verified: true, targetId: record.targetId }
        : { verified: false, reason: "The planner adapter attests no delivery with this content hash." };
    } catch (error) {
      return {
        verified: false,
        reason: `Verification failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
