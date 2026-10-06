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
