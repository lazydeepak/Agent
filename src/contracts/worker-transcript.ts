/**
 * Agent-relay codebase — module explanation / info.
 * File: src/contracts/worker-transcript.ts
 * Purpose: Worker transcript / session summary service.
 */
export interface WorkerTranscript {
  sessionId: string;
  repoPath: string;
  title: string;
  model: string;
  checkedAt: string;
  running: boolean;
  waitingForInput: boolean;
  messages: Array<{ id: string; role: string; createdAt: number; text: string }>;
}
