import type { RecoveryPolicy, SupervisorState } from "../types.js";

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = "safe";

export type RecoveryAction =
  | "none"
  | "reconnect-transport"
  | "relaunch-browser"
  | "reopen-conversation"
  | "reobserve-session"
  | "verify-only"
  | "intervention-required";

export function isRecoveryPolicy(value: unknown): value is RecoveryPolicy {
  return value === "safe" || value === "none";
}

export function recoveryActionForState(state: SupervisorState | undefined): RecoveryAction {
  switch (state) {
    case "DISCONNECTED":
      return "reconnect-transport";
    case "FAILED":
      return "intervention-required";
    case "STUCK":
      return "verify-only";
    default:
      return "none";
  }
}