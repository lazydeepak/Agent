/** Agent-relay script — Prepare Tauri sidecar / native helpers. NEXT: build code index. */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(root, "dist", "service", "service.bundle.cjs");
const binaryName = "agent-relay-service";
const binaryScriptPath = join(root, "scripts", binaryName);
const targetDir = join(root, "tauri-client", "src-tauri", "bin");

mkdirSync(targetDir, { recursive: true });

if (!existsSync(bundlePath)) {
  console.error("Bundle missing. Run 'npm run service:bundle' first.");
  process.exitCode = 1;
  process.exit(1);
}

// Copy the executable wrapper script to the Tauri binary directory
cpSync(binaryScriptPath, join(targetDir, binaryName));
// Make executable separately to avoid cp mode range limitations
chmodSync(join(targetDir, binaryName), 0o755);
console.log("Sidecar binary prepared at: " + join(targetDir, binaryName));
console.log("Bundle reference: " + bundlePath);
console.log("Note: Full Node SEA standalone binary requires a JSON build config (--build-sea=<config.json>) rather than a direct .cjs bundle path. The wrapper script provides practical packaged execution without rewriting runtime architecture.");
