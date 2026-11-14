/**
 * Agent codebase — module explanation / info.
 * File: src/application/diagnostics-capability.ts
 * Purpose: Read-only diagnostics capability gated by a permission (Bot (relay-beacon) parity).
 */

import { DiagnosticsBuffer } from "./diagnostics-buffer.js";

export interface DiagnosticsPermissionChecker {
  has(permission: string): boolean;
}

export class DiagnosticsCapability {
  constructor(
    private readonly buffer: DiagnosticsBuffer,
    private readonly permissions: DiagnosticsPermissionChecker,
    private readonly permission: string = "diagnostics.read"
  ) {}

  isAvailable(): boolean {
    return this.permissions.has(this.permission);
  }

  report(): string {
    if (!this.isAvailable()) {
      throw new Error("Diagnostics capability is disabled (missing permission).");
    }
    return this.buffer.report();
  }

  metrics() {
    if (!this.isAvailable()) {
      throw new Error("Diagnostics capability is disabled (missing permission).");
    }
    return this.buffer.allMetrics();
  }
}
