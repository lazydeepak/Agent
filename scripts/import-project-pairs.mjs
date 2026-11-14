// Derive project pairs (projects.local.json) from session pairs (pairs.local.json).
// Usage: node scripts/import-project-pairs.mjs [--pairs config/pairs.local.json] [--out config/projects.local.json]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const pairsPath = resolve(arg("--pairs", join(root, "config", "pairs.local.json")));
const outPath = resolve(arg("--out", join(root, "config", "projects.local.json")));

const pairsConfig = JSON.parse(readFileSync(pairsPath, "utf8"));
const seen = new Set();
const projectPairs = [];
for (const p of pairsConfig.pairs ?? []) {
  const url = p.planner?.conversationUrl ?? "";
  const m = url.match(/\/g\/([^/]+)\//);
  const slug = m ? m[1] : undefined;
  if (!slug) continue;
  const repoPath = p.worker?.repoPath ?? "";
  const key = `${repoPath}::${slug}`;
  if (seen.has(key)) continue;
  seen.add(key);
  // derive a display name from the slug (strip g-p- prefix and hex)
  const nameMatch = slug.match(/^g-p-[0-9a-f]+-(.+)$/);
  const projectName = nameMatch ? nameMatch[1].replace(/-/g, " ") : undefined;
  const id = `${slug.split("-").slice(-1)[0] || "project"}-${repoPath ? repoPath.split("/").pop() : "repo"}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  projectPairs.push({
    projectPairId: p.pairId ? `${p.pairId}-project` : id,
    worker: { repoPath },
    planner: { projectSlug: slug, ...(projectName ? { projectName } : {}) }
  });
}

const out = { projectPairs };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Derived ${projectPairs.length} project pairs -> ${outPath}`);