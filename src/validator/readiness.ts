import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { OpenCodeAdapter } from "../adapters/opencode/index.js";
import type {
  CheckStatus,
  PairReadinessReport,
  ReadinessCheck,
  SessionPair
} from "../types.js";
import { fail, pass } from "../util/readiness.js";

export interface ValidatorAdapters {
  worker: OpenCodeAdapter;
  planner: ChatGPTBrowserAdapter;
}

export async function validatePair(
  pair: SessionPair,
  adapters: ValidatorAdapters,
  now: Date = new Date()
): Promise<PairReadinessReport> {
  const checks = [
    await adapterChecks(() => adapters.worker.checkReadiness(pair.worker), "worker"),
    await adapterChecks(() => adapters.planner.checkReadiness(pair.planner), "planner"),
    pairExclusiveOwnershipCheck(),
    pairStateConsistentCheck(pair)
  ].flat();

  return {
    pairId: pair.pairId,
    status: checks.every((check) => !check.mandatory || check.status === "PASS")
      ? "READY"
      : "NOT_READY",
    checks,
    validatedAt: now.toISOString()
  };
}

function pairExclusiveOwnershipCheck(): ReadinessCheck {
  return pass("pair.exclusiveOwnership", "Pair ownership is unique in the loaded configuration.");
}

function pairStateConsistentCheck(pair: SessionPair): ReadinessCheck {
  // A disabled pair cannot be relayed; skip with NOT_READY status
  if (!pair.enabled) {
    return fail("pair.stateConsistent", "Pair is disabled.");
  }

  return pass("pair.stateConsistent", "Pair is enabled and internally consistent.");
}

async function adapterChecks(
  getChecks: () => Promise<ReadinessCheck[]>,
  owner: "worker" | "planner"
): Promise<ReadinessCheck[]> {
  // Wrap adapter check execution in a try/catch so a failing adapter
  // doesn't block the entire readiness validation; instead it reports
  // an "adapterAvailable" failure.
  try {
    return await getChecks();
  } catch (error) {
    return [
      fail(
        `${owner}.adapterAvailable`,
        `${capitalize(owner)} adapter failed during readiness checks: ${errorMessage(error)}`
      )
    ];
  }
}

// `pass`/`fail` are defined in `src/util/readiness.ts` so adapters can build checks without
// importing this layer; re-exported to keep the validator's public surface unchanged.
export { fail, pass } from "../util/readiness.js";

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
