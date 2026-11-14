/**
 * Agent codebase — module explanation / info.
 * File: src/application/diagnostics-buffer.ts
 * Purpose: Bounded diagnostics telemetry buffer (500 samples) — per-operation metrics, component health, plain-text report. Consolidated from RelayX.
 */

export interface DiagnosticSample {
  operation: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  at: number;
}

export interface OperationMetrics {
  operation: string;
  calls: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface ComponentHealth {
  name: string;
  status: "healthy" | "degraded" | "down";
  detail?: string;
}

export class DiagnosticsBuffer {
  private readonly capacity: number;
  private readonly samples: DiagnosticSample[] = [];
  private components: ComponentHealth[] = [];

  constructor(capacity = 500) {
    this.capacity = Math.max(1, capacity);
  }

  record(sample: Omit<DiagnosticSample, "at"> & { at?: number }): void {
    const entry: DiagnosticSample = { ...sample, at: sample.at ?? Date.now() };
    this.samples.push(entry);
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }

  getSamples(): readonly DiagnosticSample[] {
    return this.samples;
  }

  setComponentHealth(health: ComponentHealth[]): void {
    this.components = [...health];
  }

  getComponentHealth(): readonly ComponentHealth[] {
    return this.components;
  }

  metricsFor(operation: string): OperationMetrics {
    const matching = this.samples.filter((s) => s.operation === operation);
    return aggregate(operation, matching);
  }

  allMetrics(): OperationMetrics[] {
    const ops = new Set(this.samples.map((s) => s.operation));
    return [...ops].map((op) => this.metricsFor(op)).sort((a, b) => a.operation.localeCompare(b.operation));
  }

  report(): string {
    const lines: string[] = [];
    lines.push("Diagnostics Report");
    lines.push(`Samples: ${this.samples.length}/${this.capacity}`);
    lines.push("");
    if (this.components.length > 0) {
      lines.push("Component Health:");
      for (const c of this.components) {
        lines.push(`  ${c.name}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`);
      }
      lines.push("");
    }
    lines.push("Operation Metrics:");
    for (const m of this.allMetrics()) {
      lines.push(
        `  ${m.operation}: calls=${m.calls} errors=${m.errors} avg=${m.avgMs.toFixed(1)}ms p95=${m.p95Ms.toFixed(1)}ms max=${m.maxMs.toFixed(1)}ms`
      );
    }
    return lines.join("\n");
  }

  clear(): void {
    this.samples.length = 0;
    this.components = [];
  }
}

function aggregate(operation: string, samples: DiagnosticSample[]): OperationMetrics {
  if (samples.length === 0) {
    return { operation, calls: 0, errors: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
  }
  const durations = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  const sum = durations.reduce((acc, v) => acc + v, 0);
  const errors = samples.filter((s) => !s.ok).length;
  const p95Index = Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1);
  return {
    operation,
    calls: samples.length,
    errors,
    avgMs: sum / samples.length,
    p95Ms: durations[p95Index],
    maxMs: durations[durations.length - 1]
  };
}
