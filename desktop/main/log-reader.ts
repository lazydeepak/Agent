import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export interface LogFileInfoDto {
  id: string;
  name: string;
  size: number;
  modifiedAt: number;
}

export interface LogTailDto {
  id: string;
  modifiedAt: number;
  lines: string[];
}

const SAFE_ID = /^(pairs\/)?[A-Za-z0-9][A-Za-z0-9._-]*\.ndjson$/;
const MAX_TAIL_BYTES = 256 * 1024;
const MAX_LINES = 400;

function logsRoot(): string {
  return resolve(process.env.AGENT_LOGS_DIR ?? "logs");
}

/** Whitelist: flat .ndjson files in logs/ and logs/pairs/ only. */
function collect(): LogFileInfoDto[] {
  const root = logsRoot();
  const out: LogFileInfoDto[] = [];
  const scan = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const id = `${prefix}${name}`;
      if (!SAFE_ID.test(id)) continue;
      const full = join(dir, name);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;
      if (!name.toLowerCase().endsWith(".ndjson")) continue;
      out.push({ id, name: id, size: stats.size, modifiedAt: stats.mtimeMs });
    }
  };
  scan(root, "");
  scan(join(root, "pairs"), "pairs/");
  out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return out;
}

export function listLogs(): LogFileInfoDto[] {
  return collect();
}

/** Reads the last MAX_TAIL_BYTES of one log file. */
export function readLogTail(id: string): LogTailDto {
  if (!SAFE_ID.test(id)) {
    throw new Error("Invalid log file id.");
  }
  const root = logsRoot();
  const full = resolve(root, id);
  if (full !== join(root, id) && !full.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid log file id.");
  }
  if (!existsSync(full)) {
    throw new Error("Log file not found.");
  }
  const stats = statSync(full);
  if (!stats.isFile()) {
    throw new Error("Log file not found.");
  }
  const start = Math.max(0, stats.size - MAX_TAIL_BYTES);
  const length = stats.size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(full, "r");
  let bytesRead = 0;
  try {
    bytesRead = readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  let text = buffer.toString("utf8", 0, bytesRead);
  if (start > 0) {
    const firstNewline = text.indexOf("\n");
    text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
  }
  const lines = text.split("\n").filter((line) => line.trim().length > 0).map(redactLine);
  return { id, modifiedAt: stats.mtimeMs, lines: lines.slice(-MAX_LINES) };
}

/** Cheap defense-in-depth for accidental base64 payloads/credentials in log lines. */
function redactLine(line: string): string {
  return line
    .replace(/(authorization\s*[:=]\s*Basic\s+)[A-Za-z0-9+/=._-]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)["'\s]*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]");
}
