/**
 * Agent-relay codebase — module explanation / info.
 * File: src/relay/index.ts
 * Purpose: Relay core exports (identity, verification, ledger).
 */
import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { OpenCodeSessionManager } from "../adapters/opencode/index.js";
import { canonicalRelayIdentity, type RelayStore } from "../persistence/index.js";
export * from "./chatgpt-gate.js";
export * from "./planner-prompt.js";
export * from "./receipt-verification.js";
export * from "../util/composer-readiness.js";
export * from "../util/composer-polling.js";
import type {
  PairReadinessReport,
  RelayDirection,
  RelayReceipt,
  RelayableMessage,
  SessionPair,
  WorkerIdentity,
  WorkerMessageClassification
} from "../types.js";
import { validatePair } from "../validator/readiness.js";
import { SubmissionNotAttemptedError } from "../util/delivery-error.js";
import { plannerControlMessage } from "../util/planner-control.js";
import { parseWorkerAttentionEnvelope } from "../util/attention-parser.js";
import { classifyWorkerMessage } from "./message-classifier.js";
import { withWatermark, makeWatermark, renderWatermark } from "../util/watermark.js";

export interface RelayAdapters {
  worker: OpenCodeSessionManager;
  planner: ChatGPTBrowserAdapter;
}

/**
 * Cap on delivery attempts per relay identity. Delivery servers can be flaky, but a permanently
 * failing message must not be attempted an unbounded number of times (which previously inflated
 * `attempt_count` into the hundreds). Above this count the relay refuses to re-attempt until
 * `--force`. Use a reserved outcome so downstream recovery can distinguish give-up from a
 * transient failure.
 */
export const MAX_RELAY_ATTEMPTS = 20;

export type RelayOutcome =
  | "DELIVERED"
  | "SKIPPED_DUPLICATE"
  | "AMBIGUOUS"
  | "FAILED"
  | "NOOP"
  | "NOT_READY"
  | "HELD"
  | "RATE_LIMITED";

export interface RelayResult {
  pairId: string;
  status: RelayOutcome;
  direction?: RelayDirection;
  sourceMessage?: RelayableMessage;
  receipt?: RelayReceipt;
  readiness?: PairReadinessReport;
  reason?: string;
  recordId?: number;
  sourceHash?: string;
  classification?: WorkerMessageClassification;
  workerStartBlocked?: boolean;
  workerStartBlockedReason?: string;
}

export interface RelayPersistence {
  store: RelayStore;
}

export interface RelayOptions {
  requireReady?: boolean;
  now?: Date;
  force?: boolean;
  persistence?: RelayPersistence;
  sourceMessage?: RelayableMessage;
  classification?: WorkerMessageClassification;
}

const MAX_WORKER_REPORT_CHARS = 10000; // prevent oversized messages from freezing ChatGPT or the relay

async function relayMessage(
  pair: SessionPair,
  adapters: RelayAdapters,
  direction: RelayDirection,
  options: RelayOptions,
  readSource: () => Promise<RelayableMessage | undefined>,
  send: (message: RelayableMessage) => Promise<RelayReceipt>,
  recordSourceId: (messageId: string) => Partial<{ lastWorkerMessageId: string; lastPlannerMessageId: string }>
): Promise<RelayResult> {
  if (options.requireReady ?? true) {
    const readiness = await validatePair(pair, adapters, options.now);
    if (readiness.status !== "READY") {
      return {
        pairId: pair.pairId,
        status: "NOT_READY",
        direction,
        readiness,
        reason: "Pair is not READY; relay was not attempted."
      };
    }
  }

  const sourceMessage = await readSource();
  if (sourceMessage && direction === "planner-to-worker" && plannerControlMessage(sourceMessage.text)) {
    return { pairId: pair.pairId, status: "NOOP", direction,
      reason: "Planner reported completion or a blocker; no worker instruction was sent." };
  }
  if (!sourceMessage) {
    return {
      pairId: pair.pairId,
      status: "NOOP",
      direction,
      reason: noopReason(direction)
    };
  }

  // --- Enforce message length cap and encoding validation (prevent ChatGPT/relay crashes) ---
  if (sourceMessage.text.length > MAX_WORKER_REPORT_CHARS) {
    // Truncate with a deterministic marker so the acceptance predicate still matches partially
    const truncated = sourceMessage.text.substring(0, MAX_WORKER_REPORT_CHARS - 1) + "\uFFFDLIMIT_TRUNCATED";
    sourceMessage.text = truncated;
  }
  // Strip control characters that can corrupt DOM insertion or acceptance comparison
  sourceMessage.text = sourceMessage.text.replace(/[\x00-\x1F\x7F]/g, "");
  // ----------------------------------------------------------------

  if (!options.persistence) {
    const receipt = await send({ ...sourceMessage, text: withWatermark(sourceMessage.text) });
    if (!receipt.delivered) {
      return { pairId: pair.pairId, status: "AMBIGUOUS", direction, sourceMessage,
        classification: options.classification,
        reason: "Target acceptance was not confirmed; reconcile before retrying." };
    }
    return {
      pairId: pair.pairId,
      status: "DELIVERED",
      direction,
      sourceMessage,
      classification: options.classification,
      receipt: { ...receipt, pairId: pair.pairId }
    };
  }

  const { store } = options.persistence;
  const identity = canonicalRelayIdentity(pair.pairId, direction, sourceMessage);
  const existing = store.findRecord(identity);
  const classification = options.classification;

  if (existing && existing.status === "DELIVERED" && !options.force) {
    recordPairState(store, pair.pairId, { ...recordSourceId(existing.sourceMessageId), lastDirection: direction });
    return {
      pairId: pair.pairId,
      status: "SKIPPED_DUPLICATE",
      direction,
      sourceMessage,
      classification,
      sourceHash: identity.sourceHash,
      recordId: existing.id,
      reason: `Message ${sourceMessage.id} was already delivered for ${direction}; not sent again.`
    };
  }

  if (
    existing &&
    existing.status === "FAILED" &&
    (existing.attemptCount ?? 0) >= MAX_RELAY_ATTEMPTS &&
    !options.force
  ) {
    return {
      pairId: pair.pairId,
      status: "HELD",
      direction,
      sourceMessage,
      classification,
      sourceHash: identity.sourceHash,
      recordId: existing.id,
      reason:
        `Delivery previously failed ${existing.attemptCount} times (cap ${MAX_RELAY_ATTEMPTS}); ` +
        "refusing to attempt again. Use --force to override after the target is healthy."
    };
  }

  if (existing && existing.status === "DELIVERING" && !options.force) {
    return {
      pairId: pair.pairId,
      status: "AMBIGUOUS",
      direction,
      sourceMessage,
      classification,
      sourceHash: identity.sourceHash,
      recordId: existing.id,
      reason:
        `Message ${sourceMessage.id} has an incomplete prior delivery attempt (${existing.status}). ` +
        "It may have been sent before a crash; refusing to resend without --force. Reconcile externally."
    };
  }

  // v1.1 §4 — narrow startup activation exception.
  // While a startup operation is open, admit at most ONE planner response as the
  // continuation, using the durable atomic acceptance fence before dispatch.
  if (direction === "planner-to-worker" && options.persistence?.store) {
    const open = options.persistence.store.getOpenStartupOperation(pair.pairId);
    if (open) {
      // Attribution gate: only responses newer than the activation are attributable to it.
      const attributable = typeof sourceMessage.createdAt === "number" && sourceMessage.createdAt >= Date.parse(open.createdAt);
      if (!attributable) {
        return {
          pairId: pair.pairId,
          status: "AMBIGUOUS",
          direction,
          sourceMessage,
          classification,
          sourceHash: identity.sourceHash,
          reason: `Planner message is not attributable to the open startup activation (created ${sourceMessage.createdAt ?? "unknown"} vs activation ${open.createdAt}); holding (v1.1 §4).`
        };
      }
      if (open.status === "hold") {
        return {
          pairId: pair.pairId,
          status: "AMBIGUOUS",
          direction,
          sourceMessage,
          classification,
          sourceHash: identity.sourceHash,
          reason: `Startup activation is on hold for pair ${pair.pairId}: ${open.holdReason ?? "operator/agent reconciliation required before dispatch"} (v1.1 §4).`
        };
      }
      if (open.acceptedResponseId && open.acceptedResponseId !== sourceMessage.id) {
        return {
          pairId: pair.pairId,
          status: "AMBIGUOUS",
          direction,
          sourceMessage,
          classification,
          sourceHash: identity.sourceHash,
          recordId: undefined,
          reason: "A different planner response was already accepted as the startup continuation; holding dispatch (v1.1 §4)."
        };
      }
      if (!open.acceptedResponseId) {
        const accepted = options.persistence.store.acceptStartupResponse(open.id, sourceMessage.id);
        if (!accepted) {
          return {
            pairId: pair.pairId,
            status: "AMBIGUOUS",
            direction,
            sourceMessage,
            classification,
            sourceHash: identity.sourceHash,
            recordId: undefined,
            reason: "Startup acceptance fence was lost to a competing response; holding dispatch (v1.1 §4)."
          };
        }
      }
    }
  }

  const record =
    existing ??
    store.createRecord(identity, sourceMessage.createdAt, classification);

  store.updateStatus(identity, "DELIVERING", {});

  let receipt: RelayReceipt;
  try {
    receipt = await send({ ...sourceMessage, text: withWatermark(sourceMessage.text) });
    if (!receipt.delivered) throw new Error("Target acceptance was not confirmed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof SubmissionNotAttemptedError)) {
      // A transport exception can occur after acceptance. Keep the durable
      // in-flight marker so retry/restart cannot silently submit twice.
      touchPairStateForFailure(store, pair.pairId, direction, {}, message);
      return {
        pairId: pair.pairId,
        status: "AMBIGUOUS",
        direction,
        sourceMessage,
        classification,
        sourceHash: identity.sourceHash,
        recordId: record.id,
        reason: `Delivery acceptance is uncertain; reconcile before retrying: ${message}`
      };
    }
    store.recordFailure(identity, message);
    touchPairStateForFailure(store, pair.pairId, direction, recordSourceId(identity.sourceMessageId), message);
    return {
      pairId: pair.pairId,
      status: "FAILED",
      direction,
      sourceMessage,
      classification,
      sourceHash: identity.sourceHash,
      recordId: record.id,
      reason: `Delivery failed: ${message}`
    };
  }

  const deliveredRecord = store.recordDelivered(identity, receipt.targetId);
  recordPairState(store, pair.pairId, {
    ...recordSourceId(identity.sourceMessageId),
    lastSuccessfulRelayAt: nowIso(options.now),
    lastDirection: direction
  });

  return {
    pairId: pair.pairId,
    status: "DELIVERED",
    direction,
    sourceMessage,
    classification,
    sourceHash: identity.sourceHash,
    recordId: deliveredRecord?.id ?? record.id,
    receipt: { ...receipt, pairId: pair.pairId },
    workerStartBlocked: receipt.workerStartBlocked,
    workerStartBlockedReason: receipt.workerStartBlockedReason
  };
}

export async function relayWorkerToPlanner(
  pair: SessionPair,
  adapters: RelayAdapters,
  options: RelayOptions = {}
): Promise<RelayResult> {
  const sourceMessage = options.sourceMessage;
  const classification =
    options.classification ??
    (sourceMessage ? classifyWorkerMessage(sourceMessage.text) : undefined);
  return relayMessage(
    pair,
    adapters,
    "worker-to-planner",
    { ...options, sourceMessage, classification },
    () => options.sourceMessage ? Promise.resolve(options.sourceMessage) : adapters.worker.getLatestAssistantMessage(pair.worker),
    (message) => adapters.planner.sendWorkerMessage(pair.planner, { ...message, text: stripAttentionEnvelope(message.text) }),
    (messageId) => ({ lastWorkerMessageId: messageId })
  );
}

export async function relayPlannerToWorker(
  pair: SessionPair,
  adapters: RelayAdapters,
  options: RelayOptions = {}
): Promise<RelayResult> {
  const sourceMessage = options.sourceMessage ?? await adapters.planner.getLatestPlannerMessage(pair.planner);
  if (!sourceMessage) {
    return {
      pairId: pair.pairId,
      status: "NOOP",
      direction: "planner-to-worker",
      reason: noopReason("planner-to-worker")
    };
  }
  const instruction = extractModelInstruction(sourceMessage.text);
  if (instruction) {
    await adapters.worker.switchSessionModel(pair.worker, instruction.model);
    if (!instruction.task) {
      return {
        pairId: pair.pairId,
        status: "NOOP",
        direction: "planner-to-worker",
        sourceMessage,
        reason: `Worker model switched to ${instruction.model.providerID}/${instruction.model.id}; no worker task was included.`
      };
    }
  }

  // Exact relay rules: a Planner reply that contains a Worker prompt is delivered
  // immediately — there is no authorization gate. A reply without a prompt is
  // asked about once; if the Planner still produces no prompt, the exact reply is
  // escalated to the pair's Recovery Agent session. TerminalBot/Agent itself must
  // not hold, pause, or terminate automation based on Planner prose.
  const writingBlocks = sourceMessage.writingBlocks;
  if (Array.isArray(writingBlocks)) {
    const nonEmpty = writingBlocks.map((b) => b.trim()).filter((b) => b.length > 0);
    if (nonEmpty.length === 1) {
      // Exactly one prompt: deliver it (instruction task still applies above).
      if (options.persistence?.store) {
        options.persistence.store.touchPairState({
          pairId: pair.pairId,
          lastPlannerMessageId: sourceMessage.id,
          lastDirection: "planner-to-worker",
          lastError: "PROMPT_RECOVERY_RESOLVED"
        });
      }
      if (instruction) {
        return relayMessage(
          pair,
          adapters,
          "planner-to-worker",
          { ...options, sourceMessage: { ...sourceMessage, text: instruction.task } },
          () => Promise.resolve({ ...sourceMessage, text: instruction.task }),
          (message) => adapters.worker.sendPlannerMessage(pair.worker, message),
          (messageId) => ({ lastPlannerMessageId: messageId })
        );
      }
      return relayMessage(
        pair,
        adapters,
        "planner-to-worker",
        { ...options, sourceMessage: { ...sourceMessage, text: nonEmpty[0] } },
        () => Promise.resolve({ ...sourceMessage, text: nonEmpty[0] }),
        (message) => adapters.worker.sendPlannerMessage(pair.worker, message),
        (messageId) => ({ lastPlannerMessageId: messageId })
      );
    }

    // 0 or multiple structured blocks: not an unambiguous Worker prompt.
    if (!options.persistence?.store) {
      return {
        pairId: pair.pairId,
        status: "HELD",
        direction: "planner-to-worker",
        sourceMessage,
        reason: "Worker prompt not available; regeneration requested but no durable store is configured to track state."
      };
    }
    const store = options.persistence.store;
    const priorState = store.getPairState(pair.pairId);
    const alreadyAsked = priorState?.lastError === "PROMPT_RECOVERY_REQUESTED" || priorState?.lastError === "CONFIG_MISSING_MASTER";
    const alreadyEscalated = priorState?.lastError === "ESCALATED_TO_AGENT";

    if (alreadyEscalated) {
      return {
        pairId: pair.pairId,
        status: "HELD",
        direction: "planner-to-worker",
        sourceMessage,
        reason: "Already escalated to Recovery Agent; the relay stays open. Waiting for Planner to provide a valid Worker prompt."
      };
    }

    if (!alreadyAsked) {
      // Ask the Planner once for the missing Worker prompt.
      const regenerationId = `prompt-recovery-${pair.pairId}-${Date.now()}`;
      await adapters.planner.sendWorkerMessage(pair.planner, {
        id: regenerationId,
        source: "worker",
        role: "user",
        text: "Worker prompt not found. Please generate the next Worker prompt.",
        createdAt: Date.now()
      });
      store.touchPairState({
        pairId: pair.pairId,
        lastPlannerMessageId: sourceMessage.id,
        lastDirection: "planner-to-worker",
        lastError: "PROMPT_RECOVERY_REQUESTED"
      });
      return {
        pairId: pair.pairId,
        status: "HELD",
        direction: "planner-to-worker",
        sourceMessage,
        reason: "Worker prompt not available; asked Planner once for regeneration."
      };
    }

    // Second consecutive missing/ambiguous prompt: escalate to Recovery Agent.
    if (!pair.masterWorkerSessionId) {
      store.touchPairState({
        pairId: pair.pairId,
        lastPlannerMessageId: sourceMessage.id,
        lastDirection: "planner-to-worker",
        lastError: "CONFIG_MISSING_MASTER"
      });
      return {
        pairId: pair.pairId,
        status: "HELD",
        direction: "planner-to-worker",
        sourceMessage,
        reason: "Worker prompt not available after one request; masterWorkerSessionId is not configured for this pair. Configure it in pair settings to escalate to Recovery Agent."
      };
    }
    const masterWorker: WorkerIdentity = { ...pair.worker, sessionId: pair.masterWorkerSessionId };
    const escalation = await adapters.worker.sendPlannerMessage(masterWorker, { ...sourceMessage });
    store.touchPairState({
      pairId: pair.pairId,
      lastPlannerMessageId: sourceMessage.id,
      lastDirection: "planner-to-worker",
      lastError: "ESCALATED_TO_AGENT"
    });
    return {
      pairId: pair.pairId,
      status: escalation.delivered ? "DELIVERED" : "AMBIGUOUS",
      direction: "planner-to-worker",
      sourceMessage,
      reason: "Worker prompt not available after one request; verbatim Planner reply escalated to Recovery Agent.",
      receipt: { ...escalation, pairId: pair.pairId }
    };
  }

  const workerMessage = instruction
    ? { ...sourceMessage, text: instruction.task }
    : sourceMessage;
  return relayMessage(
    pair,
    adapters,
    "planner-to-worker",
    { ...options, sourceMessage: workerMessage },
    () => Promise.resolve(workerMessage),
    (message) => adapters.worker.sendPlannerMessage(pair.worker, message),
    (messageId) => ({ lastPlannerMessageId: messageId })
  );
}

export function extractModelInstruction(text: string): { model: { providerID: string; id: string }; task: string } | undefined {
  const [firstLine, ...rest] = text.split(/\r?\n/);
  const match = /^RELAY_MODEL:\s*([A-Za-z0-9._-]+)\/([A-Za-z0-9._:-]+)\s*$/.exec(firstLine ?? "");
  if (!match) return undefined;
  return {
    model: { providerID: match[1], id: match[2] },
    task: rest.join("\n").trim()
  };
}

export function formatRelayResult(result: RelayResult): string {
  const header = `${result.pairId}  ${result.status}`;

  if (result.status === "DELIVERED") {
    return [
      header,
      `direction: ${result.direction}`,
      `sourceMessageId: ${result.sourceMessage?.id}`,
      `sourceHash: ${result.sourceHash ?? ""}`,
      `targetId: ${result.receipt?.targetId}`,
      `transport: ${result.receipt?.transport}`,
      `recordId: ${result.recordId ?? ""}`
    ].join("\n");
  }

  if (result.status === "SKIPPED_DUPLICATE" || result.status === "AMBIGUOUS") {
    return [
      header,
      `direction: ${result.direction}`,
      `sourceMessageId: ${result.sourceMessage?.id}`,
      `recordId: ${result.recordId ?? ""}`,
      result.reason ?? ""
    ].join("\n");
  }

  if (result.status === "FAILED") {
    return [
      header,
      `direction: ${result.direction}`,
      `sourceMessageId: ${result.sourceMessage?.id}`,
      result.reason ?? ""
    ].join("\n");
  }

  if (result.status === "HELD" || result.status === "RATE_LIMITED") {
    return [
      header,
      `direction: ${result.direction}`,
      result.reason ?? ""
    ].join("\n");
  }

  if (result.status === "NOT_READY") {
    return [header, result.reason ?? "Relay was not attempted."].join("\n");
  }

  return [header, result.reason ?? "Nothing to relay."].join("\n");
}

function noopReason(direction: RelayDirection): string {
  return direction === "worker-to-planner"
    ? "No relayable assistant message was found in the OpenCode session."
    : "No relayable planner message was found.";
}

function recordPairState(
  store: RelayStore,
  pairId: string,
  state: {
    lastWorkerMessageId?: string;
    lastPlannerMessageId?: string;
    lastSuccessfulRelayAt?: string;
    lastDirection?: RelayDirection;
    lastError?: string;
  }
): void {
  store.touchPairState({ pairId, ...state });
}

function touchPairStateForFailure(
  store: RelayStore,
  pairId: string,
  direction: RelayDirection,
  source: Partial<{ lastWorkerMessageId: string; lastPlannerMessageId: string }>,
  error: string
): void {
  store.touchPairState({
    pairId,
    ...source,
    lastDirection: direction,
    lastError: error
  });
}

function stripAttentionEnvelope(text: string): string {
  const envelope = parseWorkerAttentionEnvelope(text);
  if (!envelope) return text;
  return text.replace(/<agent>.*?<\/agent>/g, "").trim();
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}
