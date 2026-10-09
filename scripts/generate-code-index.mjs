/**
 * Agent-relay script — deterministic code index generator.
 *
 * Produces a file/module index AND a symbol index (exported functions, classes,
 * interfaces, types, consts, re-exports) for every `src/**\/*.ts` module, plus the
 * cross-module import edges. Everything is derived by scanning source text — no AI,
 * no network, no unstable compiler API (TypeScript 7 only ships `/unstable/*`).
 *
 * Output (tracked, committed):
 *   docs/code-index.md    human-readable file map + symbol index
 *   docs/code-index.json  machine-readable structured index
 *
 * Run: node scripts/generate-code-index.mjs   (or: npm run index:code)
 * NEXT: none — this closes the "build code index" note left by the comment pass.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const SRC = "src";
const OUT_MD = "docs/code-index.md";
const OUT_JSON = "docs/code-index.json";

/** Coarse bucket for grouping modules in the index. */
function categoryOf(p) {
  if (p.includes("adapters/opencode")) return "adapter-opencode";
  if (p.includes("adapters/chatgpt")) return "adapter-chatgpt";
  if (p.includes("adapters/")) return "adapters";
  if (p.includes("cli")) return "entry";
  if (p.includes("relay/")) return "relay";
  if (p.includes("persistence/")) return "persistence";
  if (p.includes("validator/")) return "validator";
  if (p.includes("supervisor/")) return "supervisor";
  if (p.includes("recovery/")) return "recovery";
  if (p.includes("runtime/")) return "runtime";
  if (p.includes("application/")) return "application";
  if (p.includes("remote/")) return "remote";
  if (p.includes("contracts/")) return "contracts";
  if (p.includes("util/")) return "util";
  return "core";
}

const CATEGORY_ORDER = [
  "entry",
  "contracts",
  "adapters",
  "adapter-opencode",
  "adapter-chatgpt",
  "relay",
  "persistence",
  "validator",
  "supervisor",
  "recovery",
  "runtime",
  "application",
  "remote",
  "util",
  "core"
];

/** Pull the human purpose out of the module header added by the comment pass. */
function extractPurpose(content) {
  const m = content.match(/^\s*\*\s*Purpose:\s*(.+)$/m);
  return m ? m[1].trim() : "";
}

function hasModuleHeader(content) {
  return content.includes("Agent-relay codebase — module explanation");
}

const EXPORT_KINDS = [
  ["export abstract class", "class"],
  ["export class", "class"],
  ["export interface", "interface"],
  ["export enum", "enum"],
  ["export type", "type"],
  ["export async function", "function"],
  ["export function", "function"],
  ["export const", "const"],
  ["export let", "let"],
  ["export var", "var"],
  ["export namespace", "namespace"],
  ["export module", "namespace"]
];

/**
 * Collect a declaration head starting at `start` until a top-level `{` (body/object
 * literal), `;`, or the line cap — joining continuation lines so multi-line signatures
 * stay intact. Quote-aware so brackets/braces inside string or template literals don't
 * prematurely terminate the head.
 */
function collectHead(code, start, stopChars = "{;", maxLines = 12) {
  let paren = 0;
  let brace = 0;
  let quote = null;
  let i = start;
  let lines = 0;
  let out = "";
  while (i < code.length && lines < maxLines) {
    const c = code[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += code[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (paren === 0 && brace === 0 && stopChars.includes(c)) break;
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "{") brace++;
    else if (c === "}") brace--;
    out += c;
    if (c === "\n") lines++;
    i++;
  }
  return { head: out.trim(), end: i };
}

/** Parse named re-export lists: `export { a, b as c, type D } [from "..."]`. */
function parseNamedExports(listText) {
  return listText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim())
    .filter(Boolean);
}

/** Extract every exported symbol, re-export, and import edge in one module. */
function analyzeModule(relPath, content) {
  const symbols = [];
  const deps = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimStart();

    // Imports (any indentation-free top-level import).
    if (/^import\b/.test(line)) {
      const from = line.match(/from\s+["']([^"']+)["']/);
      const bare = line.match(/^import\s+["']([^"']+)["']/);
      const spec = from ? from[1] : bare ? bare[1] : null;
      if (spec) deps.push(spec);
      continue;
    }

    // Star re-export: export * from "./x.js"
    const star = line.match(/^export\s*\*\s*from\s+["']([^"']+)["']/);
    if (star) {
      symbols.push({ name: "*", kind: "re-export", line: i + 1, signature: line.replace(/;?\s*$/, ""), from: star[1] });
      deps.push(star[1]);
      continue;
    }

    // Named re-export, possibly multi-line: export { ... } [from "..."]
    if (/^export\s*\{/.test(line)) {
      let buf = line;
      let j = i;
      while (!buf.includes("}") && j + 1 < lines.length) {
        j++;
        buf += " " + lines[j].trim();
      }
      const inner = buf.match(/^export\s*\{([\s\S]*?)\}/);
      const from = buf.match(/from\s+["']([^"']+)["']/);
      const names = inner ? parseNamedExports(inner[1]) : [];
      for (const name of names) {
        symbols.push({ name, kind: "re-export", line: i + 1, signature: line.replace(/;?\s*$/, ""), from: from ? from[1] : undefined });
      }
      if (from) deps.push(from[1]);
      i = j;
      continue;
    }

    // export default ...
    if (/^export\s+default\b/.test(line)) {
      symbols.push({ name: "default", kind: "default", line: i + 1, signature: line.replace(/;?\s*$/, "") });
      continue;
    }

    // export declare ... — surface it but treat as its underlying kind if known.
    const kindEntry = EXPORT_KINDS.find(([prefix]) => line.startsWith(prefix + " ") || line.startsWith(prefix + "\t"));
    if (!kindEntry) continue;

    const [, kind] = kindEntry;
    const afterKeyword = line.slice(line.indexOf(kindEntry[0]) + kindEntry[0].length).trim();
    const nameMatch = afterKeyword.match(/^([A-Za-z0-9_$]+)/);
    const name = nameMatch ? nameMatch[1] : "(anonymous)";

    // Function-like const arrows and classes/functions: gather until `{` or `;`.
    const { head } = collectHead(content, indexOfLine(content, i));
    const signature = head.replace(/\s+/g, " ").trim().slice(0, 160);

    symbols.push({ name, kind, line: i + 1, signature });
  }

  return { symbols: dedupe(symbols), deps: [...new Set(deps)] };
}

/** Byte offset where the Nth (0-based) line starts. */
function indexOfLine(code, lineIndex) {
  let idx = 0;
  for (let n = 0; n < lineIndex; n++) {
    const next = code.indexOf("\n", idx);
    if (next === -1) return code.length;
    idx = next + 1;
  }
  return idx;
}

function dedupe(symbols) {
  const seen = new Set();
  const out = [];
  for (const s of symbols) {
    const key = `${s.kind}:${s.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function classifyDep(spec) {
  if (spec.startsWith(".")) return "internal";
  if (spec.startsWith("node:")) return "node";
  return "external";
}

function collect(dir, list = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collect(full, list);
    else if (stat.isFile() && entry.endsWith(".ts") && !entry.endsWith(".d.ts")) list.push(full);
  }
  return list;
}

function main() {
  const files = collect(SRC).sort();
  const modules = files.map((f) => {
    const rel = relative(".", f).replace(/\\/g, "/");
    const content = readFileSync(f, "utf8");
    const { symbols, deps } = analyzeModule(rel, content);
    return {
      path: rel,
      dir: dirname(rel),
      category: categoryOf(rel),
      purpose: extractPurpose(content) || "(no purpose header)",
      hasHeader: hasModuleHeader(content),
      symbolCount: symbols.length,
      symbols,
      dependencies: deps.map((spec) => ({ spec, kind: classifyDep(spec) }))
    };
  });

  const byCategory = new Map();
  for (const m of modules) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category).push(m);
  }

  const totalSymbols = modules.reduce((n, m) => n + m.symbolCount, 0);
  const generated = new Date().toISOString();

  const json = {
    schema: "agent-relay-code-index-v1",
    generated,
    scope: "file/module + symbol index",
    source: `src/**/*.ts (${modules.length} modules)`,
    totals: {
      modules: modules.length,
      symbols: totalSymbols,
      modulesMissingHeader: modules.filter((m) => !m.hasHeader).length
    },
    categories: CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      modules: byCategory.get(c).length
    })),
    modules: modules.map((m) => ({
      ...m,
      symbols: m.symbols
    }))
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(json, null, 2) + "\n");

  const md = [];
  md.push("# Agent-Relay Code Index");
  md.push("");
  md.push(`> Deterministic index of every \`src/**/*.ts\` module and its exported symbols.`);
  md.push(`> Generated: ${generated}  `);
  md.push(`> Regenerate: \`npm run index:code\`  `);
  md.push(`> **${modules.length} modules · ${totalSymbols} exported symbols**`);
  md.push("");
  md.push("This file is generated from source text — do not hand-edit. The narrative companion");
  md.push("(the comment pass that added module headers) lives in [`module-index.md`](./module-index.md).");
  md.push("");

  // --- File map ---
  md.push("## File map");
  md.push("");
  md.push("| Module | Category | Purpose | Symbols |");
  md.push("|---|---|---|---:|");
  for (const m of modules) {
    md.push(`| \`${m.path}\` | ${m.category} | ${escapeCell(m.purpose)} | ${m.symbolCount} |`);
  }
  md.push("");

  // --- Category summary ---
  md.push("## Categories");
  md.push("");
  md.push("| Category | Modules |");
  md.push("|---|---:|");
  for (const c of CATEGORY_ORDER) {
    if (!byCategory.has(c)) continue;
    md.push(`| ${c} | ${byCategory.get(c).length} |`);
  }
  md.push("");

  // --- Symbol index ---
  md.push("## Symbol index");
  md.push("");
  md.push("Exported symbols per module, with the source line and a trimmed signature.");
  md.push("");
  for (const c of CATEGORY_ORDER) {
    if (!byCategory.has(c)) continue;
    md.push(`### ${c}`);
    md.push("");
    for (const m of byCategory.get(c).sort((a, b) => a.path.localeCompare(b.path))) {
      md.push(`#### \`${m.path}\``);
      if (m.purpose) md.push(`_${escapeCell(m.purpose)}_`);
      md.push("");
      if (m.symbols.length === 0) {
        md.push("- _(no exported symbols)_");
      } else {
        for (const s of m.symbols) {
          const sig = s.signature && s.signature !== s.name ? ` — \`${truncate(s.signature, 140)}\`` : "";
          const from = s.from ? ` (from \`${s.from}\`)` : "";
          md.push(`- **${s.name}** \`${s.kind}\` L${s.line}${from}${sig}`);
        }
      }
      md.push("");
    }
  }

  // --- Dependency summary ---
  const externalCounts = new Map();
  for (const m of modules) {
    for (const d of m.dependencies) {
      if (d.kind === "internal") continue;
      externalCounts.set(d.spec, (externalCounts.get(d.spec) ?? 0) + 1);
    }
  }
  md.push("## External dependencies (by import count)");
  md.push("");
  md.push("| Package | Imported by |");
  md.push("|---|---:|");
  for (const [spec, count] of [...externalCounts.entries()].sort((a, b) => b[1] - a[1])) {
    md.push(`| \`${spec}\` | ${count} |`);
  }
  md.push("");

  writeFileSync(OUT_MD, md.join("\n"));

  console.log(`Indexed ${modules.length} modules, ${totalSymbols} symbols -> ${OUT_MD} + ${OUT_JSON}`);
  const missing = modules.filter((m) => !m.hasHeader);
  if (missing.length) {
    console.log(`Note: ${missing.length} module(s) have no explanation header.`);
  }
}

function escapeCell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

main();
