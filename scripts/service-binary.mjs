/** Agent-relay script — Build service binary (bundle to executable). NEXT: build code index. */
import { execSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(root, "dist", "service", "service.bundle.cjs");
const outBinaryName = "agent-relay-service";
const outBinaryPath = join(root, outBinaryName);

if (!existsSync(bundlePath)) {
  console.error("Bundle not found: " + bundlePath + ". Run 'npm run service:bundle' first.");
  process.exitCode = 1;
  process.exit(1);
}

// Node SEA requires CommonJS entrypoint and produces a standalone executable
execSync(
  `node --build-sea=${bundlePath} --output=${outBinaryPath}`,
  { cwd: root, stdio: "inherit" }
);

console.log("Service binary complete: " + outBinaryPath);
