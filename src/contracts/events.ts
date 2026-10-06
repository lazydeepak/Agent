/** Event contract shared by core and the desktop shell. */
export interface EventRecord {
  time: string;
  type: string;
  pairId?: string;
  projectPairId?: string;
  state?: string;
  previousState?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface EventFilter {
  pairId?: string;
  limit?: number;
}
