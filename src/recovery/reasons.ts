import type { RecoveryErrorCode } from "../types.js";

export function humanReason(code: RecoveryErrorCode): string {
  switch (code) {
    case "OPENCODE_UNREACHABLE":
      return "The OpenCode server endpoint is unreachable or did not respond.";
    case "OPENCODE_TIMEOUT":
      return "The OpenCode server timed out while responding.";
    case "OPENCODE_SESSION_MISSING":
      return "The configured OpenCode session no longer exists; intervention is required.";
    case "OPENCODE_REPO_MISMATCH":
      return "The configured OpenCode session is attached to a different repository; intervention is required.";
    case "CHATGPT_CDP_UNREACHABLE":
      return "The ChatGPT browser target (CDP) is unreachable.";
    case "CHATGPT_PAGE_CLOSED":
      return "The ChatGPT automation page closed or crashed.";
    case "CHATGPT_AUTH_REQUIRED":
      return "The ChatGPT browser session requires authentication; intervention is required.";
    case "CHATGPT_CONVERSATION_MISMATCH":
      return "The ChatGPT conversation could not be re-opened at the configured conversation URL.";
    case "RELAY_AMBIGUOUS":
      return "An interrupted relay delivery is pending; operator decision required.";
    case "RELAY_DELIVERY_FAILED":
      return "A relay delivery failed for a reason outside automatic recovery.";
    case "STUCK_UNRESOLVED":
      return "A stuck worker was verified and showed no progress; intervention is required.";
    case "RECOVERY_RETRY_EXHAUSTED":
      return "Recovery retries were exhausted without re-establishing the peer.";
    default:
      return "Recovery condition is unknown.";
  }
}