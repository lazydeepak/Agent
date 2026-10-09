/**
 * Agent-relay codebase — module explanation / info.
 * File: src/recovery/index.ts
 * Purpose: Recovery engine exports.
 */
export {
  browserManagerFor,
  ExternalBrowserManager,
  ManagedBrowserManager,
  type BrowserManager,
  type BrowserStatus,
  type ManagedBrowserHandle,
  type ManagedBrowserLens
} from "./browser.js";
export { recoverChatGPT, type ChatGPTRecoveryOutcome } from "./chatgpt.js";
export { RecoveryEngine, type RecoveryRunResult, type RecoveryEngineDeps } from "./engine.js";
export { recoverOpenCode, type OpenCodeRecoveryOutcome } from "./opencode.js";
export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js";
export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js";
export { humanReason } from "./reasons.js";