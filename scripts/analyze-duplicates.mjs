#!/usr/bin/env node
/**
 * Agent codebase — duplication analysis worker.
 * File: scripts/analyze-duplicates.mjs
 * Purpose: Runs jscpd (maintained copy/paste detector) over the repository, normalizes clones into
 * distinct duplication groups, caches the report to docs/duplication-report.json. Runs as part of
 * `npm run index:code` so results refresh whenever the source index is rebuilt.
 *
 * Usage: node scripts/analyze-duplicates.mjs [--min-lines N] [--out path] [--scan-dir path]
 * Exits non-zero on failure after writing a { status: "failed" } report.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const minLines = Number(arg("--min-lines", "10"));
const outPath = resolve(arg("--out", "docs/duplication-report.json"));
const scanDir = resolve(arg("--scan-dir", "src"));

if (!Number.isFinite(minLines) || minLines < 1) {
  writeReport(outPath, { status: "failed", error: `Invalid --min-lines: ${arg("--min-lines", "10")}` });
  process.exit(1);
}

// Ignored paths (dependencies, build artifacts, generated output, configured exclusions).
const IGNORED_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/desktop-dist/**",
  "**/tauri-client/**",
  "**/release/**",
  "**/.git/**",
  "**/.github/**",
  "docs/**",
  "data/**",
  "logs/**",
  "**/fonts/**",
  "**/*.snap",
  "**/jscpd-out/**",
  "**/coverage/**"
];
const IGNORE_ARG = IGNORED_PATTERNS.join(",");

async function writeReport(file, report) {
  const content = JSON.stringify(report, null, 2) + "\n";
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

function normalizeFragment(fragment) {
  return fragment
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function fileRange(file) {
  return `${file.name}:${file.start}-${file.end}`;
}

function runJscpd(targetDir, outDir) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      process.execPath,
      [
        join(process.cwd(), "node_modules", "jscpd", "run-jscpd.js"),
        "--reporters", "json",
        "--min-lines", String(minLines),
        "--min-tokens", "50",
        "--ignore-identifiers=consistent",
        "--no-gitignore",
        "--no-colors",
        "--ignore", IGNORE_ARG,
        "--output", outDir,
        targetDir
      ],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // jscpd exits 0 on success; a non-zero exit still leaves a report file.
        resolvePromise({ error, stdout, stderr, code: error ? error.code : 0 });
      }
    );
  });
}

const scanId = mkdtempSync(join(tmpdir(), "jscpd-out-"));
try {
  const result = await runJscpd(scanDir, scanId);
  const jsonPath = join(scanId, "jscpd-report.json");
  let jscpd;
  try {
    jscpd = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (readError) {
    const message = result.error
      ? [result.error.message, result.stderr, result.stdout].filter(Boolean).join("\n")
      : `jscpd did not produce a report: ${readError instanceof Error ? readError.message : String(readError)}`;
    await writeReport(outPath, {
      status: "failed",
      error: message,
      generatedAt: new Date().toISOString(),
      minLines
    });
    process.exit(1);
  }

  const totals = jscpd.statistics?.total ?? {};
  const scannedSources = totals.sources ?? 0;
  const totalLines = totals.lines ?? 0;
  const reportedDuplicatedLines = totals.duplicatedLines ?? 0;
  const clones = Array.isArray(jscpd.duplicates) ? jscpd.duplicates : [];

  // Group clones into distinct duplication groups by normalized fragment.
  const groupsByKey = new Map();
  for (const clone of clones) {
    const fragment = clone.fragment ?? "";
    const key = createHash("sha1").update(normalizeFragment(fragment)).digest("hex").slice(0, 12);
    let group = groupsByKey.get(key);
    if (!group) {
      group = { id: key, lines: clone.lines ?? 0, occurrences: new Map(), cloneCount: 0 };
      groupsByKey.set(key, group);
    }
    for (const file of [clone.firstFile, clone.secondFile]) {
      const path = `src/${file.name}`;
      const keyName = `${path}:${file.start}-${file.end}`;
      group.occurrences.set(keyName, { path, start: file.start, end: file.end });
    }
    group.cloneCount += 1;
  }

  const groups = [...groupsByKey.values()].map((group) => {
    const occurrences = [...group.occurrences.values()];
    return {
      id: group.id,
      lines: group.lines,
      occurrenceCount: occurrences.length,
      occurrences,
      duplicatedLines: group.lines * Math.max(0, occurrences.length - 1),
      cloneCount: group.cloneCount
    };
  });

  const groupCount = groups.length;
  const duplicatedLines = groups.reduce((sum, g) => sum + g.duplicatedLines, 0) || reportedDuplicatedLines;
  const totalOccurrences = clones.length;
  const percentage = totalLines > 0 ? Number(((duplicatedLines / totalLines) * 100).toFixed(2)) : 0;

  const report = {
    status: "ok",
    generatedAt: new Date().toISOString(),
    scanId,
    minLines,
    scannedSources,
    totalScannedLines: totalLines,
    reportedDuplicatedLines,
    duplicatedLines,
    duplicatedLinePercentage: percentage,
    totalOccurrences,
    groupCount,
    groups: groups.sort((a, b) => b.duplicatedLines - a.duplicatedLines)
  };
  await writeReport(outPath, report);
  process.exit(0);
} finally {
  rmSync(scanId, { recursive: true, force: true });
}
