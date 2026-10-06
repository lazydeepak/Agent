import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { OpenCodeSessionManager } from "../adapters/opencode/index.js";
import type {
  ObservationSnapshot,
  PlannerObservation,
  SessionPair,
  WorkerObservation
} from "../types.js";

export function makeObservationClock(): () => Date {
  return () => new Date();
}

export async function collectObservation(
  pair: SessionPair,
  worker: OpenCodeSessionManager,
  planner: ChatGPTBrowserAdapter,
  clock: () => Date = makeObservationClock()
): Promise<ObservationSnapshot> {
  const [workerObservation, plannerObservation] = await Promise.all([
    observeWorker(pair, worker),
    observePlanner(pair, planner)
  ]);

  return {
    pairId: pair.pairId,
    observedAt: clock().toISOString(),
    worker: workerObservation,
    planner: plannerObservation
  };
}

export async function observeWorkerSession(pair: SessionPair, worker: OpenCodeSessionManager): Promise<WorkerObservation> {
  return observeWorker(pair, worker);
}

export async function observePlannerConversation(pair: SessionPair, planner: ChatGPTBrowserAdapter): Promise<PlannerObservation> {
  return observePlanner(pair, planner);
}

async function observeWorker(pair: SessionPair, worker: OpenCodeSessionManager): Promise<WorkerObservation> {
  if (typeof worker.observeWorkerSession !== "function") {
    return {
      reachable: false,
      sessionExists: false,
      sessionActive: false,
      gathering: false,
      detail: ["Worker adapter does not support observation."]
    };
  }

  try {
    return await worker.observeWorkerSession(pair.worker);
  } catch (error) {
    return {
      reachable: false,
      sessionExists: false,
      sessionActive: false,
      gathering: false,
      detail: [readableError(error)]
    };
  }
}

async function observePlanner(pair: SessionPair, planner: ChatGPTBrowserAdapter): Promise<PlannerObservation> {
  if (typeof planner.observePlannerConversation !== "function") {
    return {
      reachable: false,
      authenticated: false,
      conversationReachable: false,
      composerAvailable: false,
      generating: false,
      detail: ["Planner adapter does not support observation."]
    };
  }

  try {
    return await planner.observePlannerConversation(pair.planner);
  } catch (error) {
    return {
      reachable: false,
      authenticated: false,
      conversationReachable: false,
      composerAvailable: false,
      generating: false,
      detail: [readableError(error)]
    };
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}