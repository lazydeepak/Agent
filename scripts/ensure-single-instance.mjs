#!/usr/bin/env node
// Refuses to launch a second Agent Relay dashboard against the same store.
// The in-app Electron lock is a backstop; a second instance can stall during
// native startup before app code runs, so the launch path must check first.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const APP_BUNDLE_MARKER = "desktop-dist/desktop/main/index.js";

function listProcesses() {
  if (process.platform === "win32") {
    try {
      return {
        format: "list",
        text: execFileSync("wmic", ["process", "get", "ProcessId,ParentProcessId,CommandLine", "/format:list"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"]
        })
      };
    } catch {
      return null;
    }
  }
  try {
    return {
      format: "ps",
      text: execFileSync("ps", ["-eo", "pid,ppid,command"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
    };
  } catch {
    return null;
  }
}

function parseProcessLines(output) {
  if (output.format === "list") {
    const processes = [];
    let current = {};
    const flush = () => {
      if (Number.isInteger(current.pid) && Number.isInteger(current.ppid)) {
        processes.push({ pid: current.pid, ppid: current.ppid, command: current.command ?? "" });
      }
      current = {};
    };
    for (const line of output.text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        flush();
        continue;
      }
      const match = trimmed.match(/^(CommandLine|ParentProcessId|ProcessId)=(.*)$/i);
      if (!match) continue;
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      if (key === "processid" && /^\d+$/.test(value)) current.pid = Number(value);
      else if (key === "parentprocessid" && /^\d+$/.test(value)) current.ppid = Number(value);
      else if (key === "commandline") current.command = value;
    }
    flush();
    return processes;
  }
  const processes = [];
  for (const line of output.text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) continue;
    processes.push({ pid: Number(parts[0]), ppid: Number(parts[1]), command: parts.slice(2).join(" ") });
  }
  return processes;
}

function ancestorPids(processes, ownPid) {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc.ppid]));
  const ancestors = new Set([ownPid]);
  let current = ownPid;
  for (;;) {
    const parent = byPid.get(current);
    if (parent === undefined || parent === 0 || ancestors.has(parent)) break;
    ancestors.add(parent);
    current = parent;
  }
  return ancestors;
}

/** PIDs running our dashboard bundle, excluding our own process tree. Pure and unit-tested. */
export function findRunningInstances(psOutput, ownPid) {
  const normalized = typeof psOutput === "string" ? { format: "ps", text: psOutput } : psOutput;
  const processes = parseProcessLines(normalized);
  const self = ancestorPids(processes, ownPid);
  const children = new Map();
  for (const proc of processes) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc.pid);
  }
  const queue = [ownPid];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const child of children.get(current) ?? []) {
      if (!self.has(child)) {
        self.add(child);
        queue.push(child);
      }
    }
  }
  return processes
    .filter((proc) => !self.has(proc.pid) && proc.command.includes(APP_BUNDLE_MARKER))
    .map((proc) => proc.pid);
}

function main() {
  const output = listProcesses();
  if (output === null) {
    process.stderr.write(
      "Agent Relay: could not list processes to check for a running instance; continuing.\n"
    );
    return;
  }
  const others = findRunningInstances(output, process.pid);
  if (others.length > 0) {
    process.stderr.write(
      `Agent Relay is already running (pid ${others.join(", ")}). Quit it before starting a new instance.\n`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
