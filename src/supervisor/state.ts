import type { SupervisorState } from "../types.js";

export const SUPERVISOR_STATES: readonly SupervisorState[] = [
  "READY",
  "WORKING",
  "WAITING_PLANNER",
  "WAITING_WORKER",
  "IDLE",
  "COMPLETED",
  "WAITING_INPUT",
  "STUCK",
  "FAILED",
  "DISCONNECTED",
  "PAUSED"
];

export function isBusyState(state: SupervisorState | undefined): boolean {
  return state === "WORKING" || state === "WAITING_WORKER" || state === "WAITING_PLANNER";
}

export function isTerminalFailure(state: SupervisorState): boolean {
  return state === "DISCONNECTED" || state === "FAILED" || state === "STUCK";
}

export function isSupervisorState(value: string): value is SupervisorState {
  return (SUPERVISOR_STATES as readonly string[]).includes(value);
}