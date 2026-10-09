/**
 * Agent-relay codebase — module explanation / info.
 * File: src/runtime/logging.ts
 * Purpose: Source module for logging.ts.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SupervisorLogger, SupervisorEvent, RuntimeEvent } from "../supervisor/events.js";

export const defaultPerPairLogRoot = () => resolve("logs", "pairs");

export class MultiSinkSupervisorLogger implements SupervisorLogger {
  private readonly shared: SupervisorLogger;
  private readonly pairStreams = new Map<string, ReturnType<typeof createWriteStream>>();
  private readonly perPairRoot: string;
  private closed = false;

  constructor(shared: SupervisorLogger, perPairRoot: string = defaultPerPairLogRoot()) {
    this.shared = shared;
    this.perPairRoot = perPairRoot;
    mkdirSync(this.perPairRoot, { recursive: true });
  }

  write(event: SupervisorEvent | RuntimeEvent): void {
    if (this.closed) {
      return;
    }
    this.shared.write(event);
    if (event.pairId) {
      this.pairStream(event.pairId).write(`${JSON.stringify(event)}\n`);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.shared.close();
    for (const stream of this.pairStreams.values()) {
      stream.end();
    }
    this.pairStreams.clear();
  }

  private pairStream(pairId: string) {
    let stream = this.pairStreams.get(pairId);
    if (!stream) {
      const logPath = join(this.perPairRoot, `${pairId}.ndjson`);
      mkdirSync(dirname(logPath), { recursive: true });
      stream = createWriteStream(logPath, { flags: "a" });
      this.pairStreams.set(pairId, stream);
    }
    return stream;
  }
}