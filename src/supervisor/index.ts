/**
 * Agent-relay codebase — module explanation / info.
 * File: src/supervisor/index.ts
 * Purpose: Supervisor / observation loop exports.
 */
export {
  classify,
  emptyCycleContext,
  DEFAULT_STUCK_AFTER_MS,
  type ClassifyInput,
  type ClassifyOptions,
  type Classification,
  type CycleContext
} from "./classifier.js";
export {
  JsonLineSupervisorLogger,
  MemorySupervisorLogger,
  defaultSupervisorLogPath,
  type SupervisorEvent,
  type SupervisorEventType,
  type SupervisorLogger
} from "./events.js";
export { collectObservation, makeObservationClock } from "./observation.js";
export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js";
export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js";
export {
  Supervisor,
  DEFAULT_POLL_INTERVAL_MS,
  buildCycle,
  type SupervisorDeps,
  type SupervisorReport
} from "./supervisor.js";