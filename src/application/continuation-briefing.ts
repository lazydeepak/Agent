/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/continuation-briefing.ts
 * Purpose: v1.1 §7.5 — decide whether a Resume may use direct continuation
 *          ("proven consistency") or must send a resume briefing ("unproven").
 *
 * Honesty contract: "proven" means NO recorded uncertainty exists in durable
 * state (ledger, cycles, supervisor continuity). The adapters cannot read the
 * live Planner conversation, so this never claims external proof — it means
 * "our records contain nothing that contradicts continuity". Any recorded
 * ambiguity forces the briefing path. Nothing here is inferred from model output.
 */
import type { RelayStore } from "../persistence/index.js";

export interface ResumeEvidence {
  pairId: string;
  outstandingDeliveries: number;
  unresolvedStartupOperation: boolean;
  gapsMarkerPresent: boolean;
  failedWorkerReports: number;
  latestCycle?: {
    plannerSourceMessageId: string;
    workerDispatchMessageId: string;
    cycleStatus: string;
    workerResponseMessageId?: string;
    workerCompletedAt?: string;
    dispatchedAt?: string;
  };
  lastPlannerSideSyncedMessageId?: string;
  lastError?: string;
  incidentDisposition?: string;
}

export type ResumeConsistency = "proven" | "unproven";

export interface ResumeDecision {
  consistency: ResumeConsistency;
  uncertainties: string[];
  /** Message text to deliver to the Planner. Always present; content differs by class. */
  text: string;
  /** Version tag recorded on the startup operation. */
  promptVersion: string;
}

const GAPS_MARKER = "UNRECOVERABLE_GAPS";
const START_CAPTURE_MARKER = "START_CAPTURE_NOT_READY";
export const RESUME_DIRECT_VERSION = "resume-direct-1";
export const RESUME_BRIEFING_VERSION = "resume-briefing-1";

export function collectResumeEvidence(store: RelayStore, pairId: string): ResumeEvidence {
  const records = store.listRecords(pairId);
  const supervisor = store.getSupervisorState(pairId);
  const pairState = store.getPairState(pairId);
  const cycles = store.listCycles(pairId);
  const latestCycle = cycles.length > 0 ? cycles[cycles.length - 1] : undefined;

  const outstandingDeliveries = records.filter((record) => record.status === "DELIVERING").length;
  const failedWorkerReports = records.filter(
    (record) => record.direction === "worker-to-planner" && record.status === "FAILED"
  ).length;
  const lastError = supervisor?.lastError ?? pairState?.lastError;
  const gapsMarkerPresent = typeof lastError === "string" && lastError.includes(GAPS_MARKER);

  return {
    pairId,
    outstandingDeliveries,
    unresolvedStartupOperation: store.getOpenStartupOperation(pairId) !== undefined,
    gapsMarkerPresent,
    failedWorkerReports,
    latestCycle: latestCycle
      ? {
          plannerSourceMessageId: latestCycle.plannerSourceMessageId,
          workerDispatchMessageId: latestCycle.workerDispatchMessageId,
          cycleStatus: latestCycle.cycleStatus,
          workerResponseMessageId: latestCycle.workerResponseMessageId,
          workerCompletedAt: latestCycle.workerCompletedAt,
          dispatchedAt: latestCycle.dispatchedAt
        }
      : undefined,
    lastPlannerSideSyncedMessageId: supervisor?.lastPlannerSideSyncedMessageId,
    lastError,
    incidentDisposition: supervisor?.incidentDisposition
  };
}

/** Deterministic: any recorded uncertainty forces the briefing path. */
export function classifyResumeConsistency(evidence: ResumeEvidence): { consistency: ResumeConsistency; uncertainties: string[] } {
  const uncertainties: string[] = [];
  if (evidence.outstandingDeliveries > 0) {
    uncertainties.push(
      `${evidence.outstandingDeliveries} delivery(ies) have no confirmed outcome; the ledger cannot rule out lost or duplicated transport.`
    );
  }
  if (evidence.unresolvedStartupOperation) {
    uncertainties.push(
      "A previous startup/resume activation is still open (pending, stabilized, or on hold); its response may or may not have arrived."
    );
  }
  if (evidence.gapsMarkerPresent) {
    uncertainties.push(
      "Event history may contain gaps (marked UNRECOVERABLE_GAPS); the observed window is not known to be complete."
    );
  }
  if (evidence.latestCycle && evidence.latestCycle.cycleStatus !== "DELIVERED" && !evidence.latestCycle.workerCompletedAt) {
    uncertainties.push(
      `The last worker instruction (${evidence.latestCycle.workerDispatchMessageId}) has no recorded completion; it may still be in flight.`
    );
  }
  if (evidence.failedWorkerReports > 0) {
    uncertainties.push(
      `${evidence.failedWorkerReports} worker→planner report(s) are marked FAILED; the Planner may be missing instructions reports.`
    );
  }
  if (evidence.incidentDisposition === "terminated_unverified") {
    uncertainties.push(
      "Termination after Stop All is UNVERIFIED; the worker may or may not have stopped doing work."
    );
  } else if (evidence.incidentDisposition === "held" || evidence.incidentDisposition === "awaiting_operator") {
    uncertainties.push(`The latest incident disposition is "${evidence.incidentDisposition}"; the prior state is not settled.`);
  }
  if (evidence.lastError && evidence.lastError.includes(START_CAPTURE_MARKER)) {
    uncertainties.push(
      "Capture at the last start was not verified (START_CAPTURE_NOT_READY); dispatch depends on evidence that has not arrived."
    );
  }
  return {
    consistency: uncertainties.length === 0 ? "proven" : "unproven",
    uncertainties
  };
}

export function buildResumeDecision(evidence: ResumeEvidence): ResumeDecision {
  const { consistency, uncertainties } = classifyResumeConsistency(evidence);

  if (consistency === "proven") {
    return {
      consistency,
      uncertainties: [],
      promptVersion: RESUME_DIRECT_VERSION,
      text:
        "Agent relay resumed. No recorded uncertainty blocks continuation: every admitted delivery in the local ledger is confirmed, and no gaps are marked. Continue from the last verified state and issue the next job. Do not replay or re-dispatch earlier worker instructions. End with RELAY_CONTINUE, RELAY_COMPLETE, or RELAY_BLOCKED as usual."
    };
  }

  const lastCycle = evidence.latestCycle;
  const cycleLines = lastCycle
    ? [
        `- Planner instruction (source message id): ${lastCycle.plannerSourceMessageId}`,
        `- Worker dispatch (dispatch message id): ${lastCycle.workerDispatchMessageId}`,
        `- Cycle status: ${lastCycle.cycleStatus}${lastCycle.dispatchedAt ? ` · dispatched ${lastCycle.dispatchedAt}` : ""}`,
        lastCycle.workerCompletedAt
          ? `- Worker completion recorded at ${lastCycle.workerCompletedAt}`
          : "- Worker completion: NOT recorded"
      ]
    : ["- No completed relay cycle is on record."];

  const workerReportLine = lastCycle?.workerResponseMessageId
    ? `- Latest relevant worker report message id: ${lastCycle.workerResponseMessageId} — marked POSSIBLE PRIOR DELIVERY; it may not have reached you. Do not assume you received it; re-derive from the repository and your conversation history.`
    : "- Latest relevant worker report: none recorded in the ledger.";

  const text = `Agent relay resumed in CHECKPOINT mode. This message is a state checkpoint, not proof of what completed.

Last known state (from the durable local ledger, not the live conversation):
${cycleLines.join("\n")}
- Last planner-side sync point: ${evidence.lastPlannerSideSyncedMessageId ?? "unknown"}
${workerReportLine}

Uncertainties Agent cannot rule out:
${uncertainties.map((entry) => `- ${entry}`).join("\n")}

Instructions:
1. Do not re-issue prior worker instructions; they may have been delivered or executed.
2. Re-audit the repository, tests, and this conversation before issuing the next job.
3. If a worker job may still be in flight, wait for its report and fold it into your next job instead of starting duplicate work.
4. Establish a fresh baseline for the next job from current evidence; do not assume earlier context is intact.
5. End with RELAY_CONTINUE, RELAY_COMPLETE, or RELAY_BLOCKED as usual.`;

  return { consistency, uncertainties, text, promptVersion: RESUME_BRIEFING_VERSION };
}
