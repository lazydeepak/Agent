/**
 * Agent codebase — module explanation / info.
 * File: src/application/health-monitors.ts
 * Purpose: Deterministic health-monitor definitions (session drift, transport, idle activity, delivery stalled, overall health). Consolidated from RelayX.
 */

export type HealthStatus = "healthy" | "warning" | "critical";

export interface HealthSignal {
  name: string;
  value: number | boolean | string;
  threshold?: number;
}

export interface HealthIncident {
  id: string;
  component: string;
  status: HealthStatus;
  message: string;
  at: number;
}

export interface HealthMonitorResult {
  component: string;
  status: HealthStatus;
  message: string;
}

export function evaluateSessionDrift(activeSessions: number, configuredSessions: number): HealthMonitorResult {
  if (configuredSessions === 0) return { component: "session-drift", status: "healthy", message: "No sessions configured." };
  const ratio = activeSessions / configuredSessions;
  if (ratio < 0.5) return { component: "session-drift", status: "critical", message: `Only ${activeSessions}/${configuredSessions} sessions active.` };
  if (ratio < 1) return { component: "session-drift", status: "warning", message: `${activeSessions}/${configuredSessions} sessions active.` };
  return { component: "session-drift", status: "healthy", message: "All sessions active." };
}

export function evaluateTransportHealth(reachable: boolean, authOk: boolean): HealthMonitorResult {
  if (!reachable) return { component: "transport", status: "critical", message: "Transport unreachable." };
  if (!authOk) return { component: "transport", status: "warning", message: "Transport reachable but auth failed." };
  return { component: "transport", status: "healthy", message: "Transport healthy." };
}

export function evaluateIdleActivity(lastActivityMs: number | undefined, idleThresholdMs: number, now: number = Date.now()): HealthMonitorResult {
  if (lastActivityMs === undefined) return { component: "idle-activity", status: "warning", message: "No activity recorded." };
  const idle = now - lastActivityMs;
  if (idle > idleThresholdMs * 2) return { component: "idle-activity", status: "critical", message: `Idle for ${Math.round(idle / 1000)}s.` };
  if (idle > idleThresholdMs) return { component: "idle-activity", status: "warning", message: `Idle for ${Math.round(idle / 1000)}s.` };
  return { component: "idle-activity", status: "healthy", message: "Active recently." };
}

export function evaluateDeliveryStalled(pendingCount: number, oldestPendingAgeMs: number, stallThresholdMs: number): HealthMonitorResult {
  if (pendingCount === 0) return { component: "delivery-stalled", status: "healthy", message: "No pending deliveries." };
  if (oldestPendingAgeMs > stallThresholdMs) return { component: "delivery-stalled", status: "critical", message: `${pendingCount} pending, oldest ${Math.round(oldestPendingAgeMs / 1000)}s.` };
  return { component: "delivery-stalled", status: "warning", message: `${pendingCount} pending deliveries.` };
}

export function overallHealth(results: HealthMonitorResult[]): HealthStatus {
  if (results.some((r) => r.status === "critical")) return "critical";
  if (results.some((r) => r.status === "warning")) return "warning";
  return "healthy";
}
