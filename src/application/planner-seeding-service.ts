import { createPairAdapters } from "../runtime/index.js";
import type { LockRegistry, RuntimeAdapterOptions } from "../runtime/index.js";
import type { RelayStore } from "../persistence/index.js";
import { relayPlannerToWorker, relayWorkerToPlanner } from "../relay/index.js";
import type {
  LocalAgentFeedResult,
  PairStartPriming,
  PlannerSeedResult
} from "../contracts/desktop.js";
import { DesktopApplicationError } from "./desktop-service.js";
import { UNIVERSAL_PLANNER_PROMPT, UNIVERSAL_PLANNER_PROMPT_VERSION } from "./universal-planner-prompt.js";
import { LOCAL_AGENT_PLANNER_PROMPT, LOCAL_AGENT_PLANNER_PROMPT_VERSION } from "./local-agent-planner-prompt.js";
import type { RelayableMessage, SessionPair } from "../types.js";

/**
 * Everything planner seeding needs from the owning application service.
 *
 * Seeding is the only place that writes a planner kickoff prompt, so it lives behind an explicit
 * context instead of inside the (large) desktop facade.
 */
export interface PlannerSeedingContext {
  /** True when the service runs in relay mode: unseeded pairs then need an initial handoff. */
  relay: boolean;
  getPairDetail(pairId: string): SessionPair | undefined;
  adapterOptions(): RuntimeAdapterOptions;
  assertPairStopped(pairId: string): void;
  ensureBrowserLocks(): LockRegistry;
  ensureStore(): RelayStore;
  recordEvent(type: string, pairId: string | undefined, extras?: { reason?: string; details?: Record<string, unknown> }): void;
  /** Persists pair edits and reloads pairs; throws a config error when persistence fails. */
  updatePairConfig(pairId: string, edits: Record<string, unknown>): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PlannerSeedingService {
  constructor(private readonly ctx: PlannerSeedingContext) {}

  async seedPlanner(pairId: string): Promise<PlannerSeedResult> {
    this.ctx.assertPairStopped(pairId);
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    this.ctx.ensureBrowserLocks();
    const planner = createPairAdapters(pair, this.ctx.adapterOptions()).planner;
    const sentAt = new Date().toISOString();
    const message: RelayableMessage = {
      id: `universal-kickoff-${pairId}-v${UNIVERSAL_PLANNER_PROMPT_VERSION}-${Date.now()}`,
      source: "worker",
      role: "user",
      text: UNIVERSAL_PLANNER_PROMPT,
      createdAt: Date.now()
    };
    await planner.sendWorkerMessage(pair.planner, message);
    try {
      await this.ctx.updatePairConfig(pairId, {
        planner: { automation: { promptVersion: UNIVERSAL_PLANNER_PROMPT_VERSION, seededAt: sentAt } }
      });
    } catch (error) {
      throw new DesktopApplicationError(
        "PLANNER_SEED_STATE_FAILED",
        `The kickoff prompt was sent, but its state could not be saved. Do not resend until the conversation is checked: ${messageOf(error)}`
      );
    }
    this.ctx.recordEvent("PLANNER_SEEDED", pairId, {
      reason: `Universal planner prompt v${UNIVERSAL_PLANNER_PROMPT_VERSION} sent.`
    });
    return { pairId, promptVersion: UNIVERSAL_PLANNER_PROMPT_VERSION, sentAt };
  }

  async feedLocalAgentPrompt(pairId: string): Promise<LocalAgentFeedResult> {
    this.ctx.assertPairStopped(pairId);
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);
    this.ctx.ensureBrowserLocks();
    const planner = createPairAdapters(pair, this.ctx.adapterOptions()).planner;
    const sentAt = new Date().toISOString();
    const message: RelayableMessage = {
      id: `local-agent-kickoff-${pairId}-v${LOCAL_AGENT_PLANNER_PROMPT_VERSION}-${Date.now()}`,
      source: "worker",
      role: "user",
      text: LOCAL_AGENT_PLANNER_PROMPT,
      createdAt: Date.now()
    };
    await planner.sendWorkerMessage(pair.planner, message);
    try {
      await this.ctx.updatePairConfig(pairId, { localAgentMode: true });
    } catch (error) {
      throw new DesktopApplicationError(
        "LOCAL_AGENT_STATE_FAILED",
        `The local agent prompt was sent, but its state could not be saved. Do not resend until the conversation is checked: ${messageOf(error)}`
      );
    }
    this.ctx.recordEvent("LOCAL_AGENT_PROMPT_FED", pairId, {
      reason: `Local agent planner prompt v${LOCAL_AGENT_PLANNER_PROMPT_VERSION} sent; pair marked local-agent mode.`
    });
    return {
      pairId,
      promptVersion: LOCAL_AGENT_PLANNER_PROMPT_VERSION,
      sentAt,
      localAgentMode: true
    };
  }

  /** True when a relay-mode pair has no ledger history and therefore needs one initial handoff. */
  requiresInitialPlannerHandoff(pairId: string): boolean {
    if (!this.ctx.relay) return false;
    const store = this.ctx.ensureStore();
    return store.listCycles(pairId).length === 0 && store.listRecords(pairId).length === 0;
  }

  /**
   * Performs the single handoff a pair needs before its first supervised cycle: a kickoff prompt
   * (`from-trigger`) or one relay in the requested direction.
   */
  async primePair(pairId: string, priming: PairStartPriming): Promise<void> {
    this.ctx.assertPairStopped(pairId);
    const pair = this.ctx.getPairDetail(pairId);
    if (!pair) throw new DesktopApplicationError("UNKNOWN_PAIR", `Unknown pairId "${pairId}".`);

    if (priming === "from-trigger") {
      await this.seedPlanner(pairId);
      this.ctx.recordEvent("PAIR_PRIMED", pairId, {
        reason: `Universal kickoff prompt v${UNIVERSAL_PLANNER_PROMPT_VERSION} sent before start.`
      });
      return;
    }

    const store = this.ctx.ensureStore();
    const adapters = createPairAdapters(pair, this.ctx.adapterOptions());
    const result =
      priming === "from-worker"
        ? await relayWorkerToPlanner(pair, adapters, { persistence: { store } })
        : await relayPlannerToWorker(pair, adapters, { persistence: { store } });

    if (result.status === "FAILED" || result.status === "AMBIGUOUS" || result.status === "NOT_READY") {
      this.ctx.recordEvent("PAIR_PRIME_FAILED", pairId, {
        reason: result.reason,
        details: {
          priming,
          status: result.status,
          direction: result.direction,
          sourceMessageId: result.sourceMessage?.id
        }
      });
      throw new DesktopApplicationError(
        "PAIR_PRIME_FAILED",
        `Priming did not complete (${result.status}): ${result.reason ?? "The relay was not attempted."}`,
        { priming, status: result.status, direction: result.direction }
      );
    }

    if (
      priming === "from-planner" &&
      result.sourceMessage?.id &&
      (result.status === "DELIVERED" || result.status === "SKIPPED_DUPLICATE")
    ) {
      store.touchSupervisorState({ pairId, lastPlannerSideSyncedMessageId: result.sourceMessage.id });
    }

    this.ctx.recordEvent("PAIR_PRIMED", pairId, {
      reason: `One-shot ${result.direction ?? priming} relay completed (${result.status}).`,
      details: {
        priming,
        status: result.status,
        direction: result.direction,
        sourceMessageId: result.sourceMessage?.id
      }
    });
  }
}
