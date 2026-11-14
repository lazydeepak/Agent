/**
 * Agent-relay codebase — module explanation / info.
 * File: src/supervisor/events.ts
 * Purpose: Supervisor-side event logger implementations. The event type definitions
 * live in contracts/events.ts so lower layers (recovery, runtime) can emit them
 * without importing the supervisor layer.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RuntimeEvent, SupervisorEvent, SupervisorLogger } from "../contracts/events.js";

export class MemorySupervisorLogger implements SupervisorLogger {
  readonly events: (SupervisorEvent | RuntimeEvent)[] = [];

  write(event: SupervisorEvent | RuntimeEvent): void {
    this.events.push(event);
  }

  close(): void {
    // nothing to flush for an in-memory logger
  }
}

export const defaultSupervisorLogPath = () => resolve("logs", "supervisor.ndjson");

export class JsonLineSupervisorLogger implements SupervisorLogger {
  private readonly stream;
  private closed = false;

  constructor(private readonly logPath: string = defaultSupervisorLogPath()) {
    mkdirSync(dirname(logPath), { recursive: true });
    this.stream = createWriteStream(logPath, { flags: "a" });
  }

  write(event: SupervisorEvent | RuntimeEvent): void {
    if (this.closed) {
      return;
    }
    this.stream.write(`${JSON.stringify(event)}\n`);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.stream.end();
  }
}
