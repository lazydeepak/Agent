import type { PairIdentityDto, PeerHealthDto } from "../../src/contracts/desktop.js";

export interface PairCardModel {
  pairId: string;
  enabled: boolean;
  runtimeState: string;
  hasRelayHistory: boolean;
  paused: boolean;
  lastObservedAt?: string;
  lastError?: string;
  workerSessionId: string;
  repoPath: string;
  conversationId: string;
  conversationUrl: string;
  openCodeEndpoint?: string;
  cdpEndpoint?: string;
}

export interface PairControls {
  canStart: boolean;
  canStop: boolean;
  canPause: boolean;
  canResume: boolean;
}

export function toPairCard(pair: PairIdentityDto, status: PeerHealthDto | undefined): PairCardModel {
  return {
    pairId: pair.pairId,
    enabled: pair.enabled,
    runtimeState: status?.runtimeState ?? "STOPPED",
    hasRelayHistory: status?.hasRelayHistory ?? false,
    paused: status?.paused ?? false,
    lastObservedAt: status?.lastObservedAt,
    lastError: status?.lastError,
    workerSessionId: pair.worker.sessionId,
    repoPath: pair.worker.repoPath,
    conversationId: pair.planner.conversationId,
    conversationUrl: pair.planner.conversationUrl,
    openCodeEndpoint: pair.worker.server?.baseUrl,
    cdpEndpoint: pair.planner.browser?.cdpUrl
  };
}

export function controlsFor(state: string, paused: boolean, enabled: boolean): PairControls {
  const running = state === "RUNNING" || state === "STARTING" || state === "STOPPING";
  return {
    canStart: !running && enabled,
    canStop: running || state === "PAUSED",
    canPause: running && !paused,
    canResume: running && paused
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

export function isValidError(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}
