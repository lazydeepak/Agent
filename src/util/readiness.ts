import type { CheckStatus, ReadinessCheck } from "../types.js";

/**
 * Readiness check constructors. Kept in `src/util` because adapters (the lowest layer) build
 * checks too and must not import from `src/validator`.
 */
export function readinessCheck(name: string, status: CheckStatus, reason: string): ReadinessCheck {
  return { name, status, reason, mandatory: true };
}

export function pass(name: string, reason = "OK"): ReadinessCheck {
  return readinessCheck(name, "PASS", reason);
}

export function fail(name: string, reason: string): ReadinessCheck {
  return readinessCheck(name, "FAIL", reason);
}
