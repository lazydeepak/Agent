export interface WorkerQuestion {
  id: string;
  sessionID: string;
  questions: Array<{ question: string; header?: string; multiple?: boolean; options: Array<{ label: string; description?: string }> }>;
}
