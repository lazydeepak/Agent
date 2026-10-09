#!/usr/bin/env node
/** Agent-relay script — Prepare Tauri runtime / native dependencies. NEXT: build code index. */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, chmodSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targetTriple = process.platform === "darwin" ? "darwin" : process.platform;
const arch = process.arch;
const nodeVersion = process.version;

console.log(`Target triple: ${targetTriple}-${arch}`);
console.log(`Node version: ${nodeVersion}`);
console.log(`Repository engine: >=22.5`);

const binDir = join(root, "tauri-client", "src-tauri", "bin");
const libDir = join(root, "tauri-client", "src-tauri", "lib");
mkdirSync(binDir, { recursive: true });
mkdirSync(libDir, { recursive: true });

const nodeBinarySource = "/tmp/official-node/bin/node";
console.log(`Source node binary: ${nodeBinarySource}`);

if (!existsSync(nodeBinarySource)) {
  console.error("Source node binary not found.");
  process.exitCode = 1;
  process.exit(1);
}

// Fail-fast invariants before staging
function checkInvariant(p, reason) {
  if (!existsSync(p)) { console.error(`FAIL: missing ${reason}: ${p}`); process.exit(1); }
  const s = statSync(p);
  if (!s.isFile()) { console.error(`FAIL: not regular file ${reason}: ${p}`); process.exit(1); }
}
checkInvariant(nodeBinarySource, "node binary source");
if (process.execPath === nodeBinarySource) {
  // verify executable bit
  const s = statSync(nodeBinarySource);
  if ((s.mode & 0o111) === 0) { console.error("FAIL: node binary not executable"); process.exit(1); }
}

const nodeBinaryTarget = join(binDir, "node");
cpSync(nodeBinarySource, nodeBinaryTarget);
chmodSync(nodeBinaryTarget, 0o755);
console.log(`Copied node binary to: ${nodeBinaryTarget}`);

// Official standalone binary has no external libnode.dylib; skip library staging
console.log("Library source: none (standalone official binary)");
console.log("No companion dylib required.");

// Verify official standalone binary runs without external library
try {
  const check = execSync(`${nodeBinaryTarget} --version`, { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
  console.log(`Runtime verification: ${check.trim()}`);
} catch (e) {
  console.error("Runtime verification failed.", e);
  process.exitCode = 1;
  process.exit(1);
}

console.log("Private Node runtime prepared for Tauri packaging.");
