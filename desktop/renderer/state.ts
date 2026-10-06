import type { EventRecordDto, PairIdentityDto, PeerHealthDto, StatusSummaryDto, ValidationResultDto } from "../shared/dto.js";

export interface PairCardModel {
  pairId: string;
  enabled: boolean;
  localAgentMode: boolean;
  runtimeState: string;
  hasRelayHistory: boolean;
  schedulerMode?: "ACTIVE" | "DORMANT_WATCH";
  supervisorState?: string;
  worker: string;
  planner: string;
  workerActivity?: "idle" | "working";
  plannerActivity?: "idle" | "working";
  workerFailureReason?: "transport" | "session";
  plannerFailureReason?: "transport" | "session";
  recovering: boolean;
  paused: boolean;
  lastObservedAt?: string;
  lastError?: string;
  workerSessionId: string;
  repoPath: string;
  conversationId: string;
  conversationUrl: string;
  openCodeEndpoint?: string;
  cdpEndpoint?: string;
  validation?: ValidationResultDto;
}

export interface PairControls {
  canStart: boolean;
  canStop: boolean;
  canPause: boolean;
  canResume: boolean;
  canValidate: boolean;
}

export function toPairCard(pair: PairIdentityDto, status: PeerHealthDto | undefined, validation?: ValidationResultDto): PairCardModel {
  return {
    pairId: pair.pairId,
    enabled: pair.enabled,
    localAgentMode: pair.localAgentMode ?? false,
    runtimeState: status?.runtimeState ?? "STOPPED",
    hasRelayHistory: status?.hasRelayHistory ?? false,
    schedulerMode: status?.schedulerMode,
    supervisorState: status?.supervisorState,
    worker: status?.worker ?? "unknown",
    planner: status?.planner ?? "unknown",
    workerActivity: status?.workerActivity,
    plannerActivity: status?.plannerActivity,
    workerFailureReason: status?.workerFailureReason,
    plannerFailureReason: status?.plannerFailureReason,
    recovering: status?.recovering ?? false,
    paused: status?.paused ?? false,
    lastObservedAt: status?.lastObservedAt,
    lastError: status?.lastError,
    workerSessionId: pair.worker.sessionId,
    repoPath: pair.worker.repoPath,
    conversationId: pair.planner.conversationId,
    conversationUrl: pair.planner.conversationUrl,
    openCodeEndpoint: pair.worker.server?.baseUrl,
    cdpEndpoint: pair.planner.browser?.cdpUrl,
    validation
  };
}

export function controlsFor(state: string, paused: boolean, enabled: boolean): PairControls {
  const running = state === "RUNNING" || state === "STARTING" || state === "STOPPING";
  const stopped = state === "STOPPED" || state === "ERROR";
  return {
    canStart: !running && enabled,
    canStop: running || state === "PAUSED",
    canPause: running && !paused,
    canResume: running && paused,
    canValidate: true
  };
}

export function stateDotClass(runtimeState: string, paused: boolean): string {
  if (paused) {
    return "dot-ok";
  }
  switch (runtimeState) {
    case "RUNNING":
      return "dot-ok";
    case "STARTING":
    case "STOPPING":
      return "dot-warn";
    case "PAUSED":
      return "dot-warn";
    case "ERROR":
      return "dot-danger";
    case "STOPPED":
    default:
      return "dot-dim";
  }
}

export function supervisorBadgeClass(supervisorState: string | undefined): string {
  switch (supervisorState) {
    case "READY":
    case "WORKING":
    case "COMPLETED":
    case "WAITING_WORKER":
    case "WAITING_PLANNER":
      return "badge-ok";
    case "STUCK":
    case "FAILED":
    case "DISCONNECTED":
      return "badge-failed";
    case "PAUSED":
      return "badge-paused";
    default:
      return "badge-neutral";
  }
}

export function peerBadgeClass(health: string, recovering?: boolean): string {
  if (recovering) {
    return "badge-degraded";
  }
  switch (health) {
    case "connected":
      return "badge-ok";
    case "degraded":
      return "badge-degraded";
    case "failed":
      return "badge-failed";
    default:
      return "badge-neutral";
  }
}

/**
 * Produces the human-facing peer status label, e.g. "Connected · Idle", "Connected · Working",
 * "Connection lost · Recovering…", "Transport unavailable", or "Session unavailable". Keeps
 * connection health, activity, recovery, and failure-reason signals distinct rather than
 * collapsing them into one generic health word.
 */
export function peerStatusLabel(
  health: string,
  activity: "idle" | "working" | undefined,
  recovering: boolean,
  failureReason?: "transport" | "session"
): string {
  if (health === "failed") {
    if (recovering) {
      return "Connection lost · Recovering…";
    }
    return failureReason === "session" ? "Session unavailable" : "Transport unavailable";
  }
  if (health === "unknown") {
    return "Unknown";
  }
  if (health === "connected") {
    return activity === "working" ? "Connected · Working" : "Connected · Idle";
  }
  return "Degraded";
}

export function validationSummaryClass(status: string | undefined): string {
  if (status === "READY") {
    return "check-pass";
  }
  return "check-fail";
}

export function appendEvent(existing: EventRecordDto[], event: EventRecordDto, max: number): EventRecordDto[] {
  const next = [...existing, event];
  next.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  if (next.length > max) {
    next.length = max;
  }
  return next;
}

export function filterEvents(events: EventRecordDto[], pairId?: string): EventRecordDto[] {
  if (!pairId) {
    return events;
  }
  return events.filter((event) => event.pairId === pairId || event.pairId === undefined);
}

export function summarizeStatus(status: StatusSummaryDto): string {
  return `${status.running} running · ${status.healthy} healthy · ${status.degraded} degraded · ${status.failed} failed`;
}

export function isValidError(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}
