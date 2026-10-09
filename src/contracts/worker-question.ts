/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/worker-question.ts
 * Purpose: Source module for worker-question.ts.
 */
export interface WorkerQuestion {
  id: string;
  sessionID: string;
  questions: Array<{ question: string; header?: string; multiple?: boolean; options: Array<{ label: string; description?: string }> }>;
}
