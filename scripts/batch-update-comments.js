/**
 * Batch comment/index updater for agent-relay codebase.
 * Adds module-level explanation headers to all src/*.ts files
 * and notes that next phase is building a code index.
 * Run with: node scripts/batch-update-comments.js
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = "src";

function describe(filePath) {
  const p = filePath.replace(/\\/g, "/");
  const parts = p.split("/");
  if (p.endsWith("/index.ts")) {
    const dir = parts[parts.length - 2];
    if (dir === "opencode") return "OpenCode adapter exports (session management, readiness, event source).";
    if (dir === "chatgpt") return "ChatGPT browser adapter exports.";
    if (dir === "relay") return "Relay core exports (identity, verification, ledger).";
    if (dir === "persistence") return "Persistence / SQLite store exports.";
    if (dir === "supervisor") return "Supervisor / observation loop exports.";
    if (dir === "validator") return "Validation / readiness exports.";
    if (dir === "recovery") return "Recovery engine exports.";
    if (dir === "runtime") return "Pair runtime orchestration exports.";
    if (dir === "application") return "Application service exports (desktop, control plane, project pairs).";
    if (dir === "util") return "Shared utilities (canonicalization, async primitives).";
    if (dir === "contracts") return "Shared DTO / contract types.";
    return `Module exports for ${dir}.`;
  }
  if (p.includes("cli.ts")) return "CLI entrypoint — parses args and starts runtime / service.";
  if (p.includes("desktop-service")) return "Electron desktop service integration.";
  if (p.includes("control-plane")) return "Control-plane adapter for worker/planner pairs.";
  if (p.includes("project-pair")) return "Project-pair identity / ownership service.";
  if (p.includes("pair-runtime")) return "Per-pair concurrent runtime supervisor.";
  if (p.includes("worker-progress")) return "Worker progress tracking service.";
  if (p.includes("worker-transcript")) return "Worker transcript / session summary service.";
  if (p.includes("worker-session")) return "Worker session management service.";
  if (p.includes("adapters.ts")) return "Adapter registry / factory.";
  if (p.includes("cli-args")) return "CLI argument parsing schema.";
  if (p.includes("remote-server")) return "Optional HTTP control API (service start only).";
  if (p.includes("observ")) return "Observation / event correlation utilities.";
  if (p.includes("readiness")) return "Readiness checks for worker/planner pairs.";
  if (p.includes("canonical")) return "Canonicalization helpers (URL, identity, hash).";
  if (p.includes("async")) return "Async primitives (timeout, retry, bounded backoff).";
  return `Source module for ${parts[parts.length - 1]}.`;
}

function files(dir, list = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory() && entry !== "node_modules" && entry !== ".git") files(full, list);
    else if (stat.isFile() && entry.endsWith(".ts") && !entry.endsWith(".d.ts")) list.push(full);
  }
  return list;
}

const all = files(SRC);
let changed = 0;
for (const f of all) {
  const rel = relative(".", f);
  const content = readFileSync(f, "utf8");
  if (content.startsWith("/**") && content.includes("NEXT: build code index") && content.includes("Module:")) {
    continue; // already updated
  }
  const desc = describe(rel);
  const header = `/**
 * Agent-relay codebase — module explanation / info.
 * File: ${rel}
 * Purpose: ${desc}
 * NEXT: build code index (upcoming phase — index symbols / files / functions for faster lookup).
 */
`;
  // Only prepend if first line isn't already a doc block that contains this
  const newContent = header + content;
  writeFileSync(f, newContent);
  changed += 1;
}
console.log(`Updated ${changed}/${all.length} .ts files with module explanation + NEXT note.`);
