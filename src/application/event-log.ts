/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/event-log.ts
 * Purpose: Source module for event-log.ts.
 */
import type { EventFilter, EventRecord } from "../contracts/events.js";

export interface EventLogOptions {
  /** Maximum number of events retained in memory. */
  maxEvents?: number;
  clock?: () => Date;
}

export interface RecordEventOptions {
  pairId?: string;
  projectPairId?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Bounded in-memory event ring buffer with subscription support.
 *
 * Extracted from `DesktopApplicationService` so event retention, filtering, and fan-out are
 * testable in isolation and the service only decides *what* to record.
 */
function cloneEvent(event: EventRecord): EventRecord {
  return {
    ...event,
    ...(event.details ? { details: { ...event.details } } : {})
  };
}

export class EventLog {
  private readonly events: EventRecord[] = [];
  private readonly listeners = new Set<(event: EventRecord) => void>();
  private readonly maxEvents: number;
  private readonly clock: () => Date;

  constructor(options: EventLogOptions = {}) {
    this.maxEvents = options.maxEvents ?? 200;
    this.clock = options.clock ?? (() => new Date());
  }

  record(type: string, options: RecordEventOptions = {}): EventRecord {
    const event: EventRecord = {
      time: this.clock().toISOString(),
      type,
      ...(options.pairId === undefined ? {} : { pairId: options.pairId }),
      ...(options.projectPairId === undefined ? {} : { projectPairId: options.projectPairId }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...(options.details === undefined ? {} : { details: options.details })
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    for (const listener of this.listeners) {
      listener(cloneEvent(event));
    }
    return event;
  }

  recent(filter: EventFilter = {}): EventRecord[] {
    const events = filter.pairId
      ? this.events.filter((event) => event.pairId === filter.pairId || event.pairId === undefined)
      : this.events;
    const limit = filter.limit ?? this.maxEvents;
    return events.slice(-limit).map(cloneEvent);
  }

  /** Snapshot of every retained event (oldest first). */
  all(): EventRecord[] {
    return this.events.map(cloneEvent);
  }

  subscribe(listener: (event: EventRecord) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.events.length = 0;
    this.listeners.clear();
  }
}
