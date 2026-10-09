/**
 * Agent-relay codebase — module explanation / info.
 * File: src/service-entry.ts
 * Purpose: Source module for service-entry.ts.
 */
import { runCli } from "./cli.js";

const MANAGED_MODE = process.env.MANAGED_SIDECAR_MODE === "1" || process.env.RELAY_MANAGED_LOCAL === "1";

(async () => {
  if (MANAGED_MODE) {
    // Narrow managed-only stdin lifecycle channel for native sidecar control.
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "SHUTDOWN") {
          // Trigger the existing graceful shutdown mechanism through the service layer.
          process.exitCode = 0;
          process.kill(process.pid, "SIGTERM");
          return;
        }
      }
    });
  }
  let args = process.argv.slice(2);
  if (MANAGED_MODE && args.length === 0) {
    args = ["service", "start"];
  }
  await runCli(args);
})();
