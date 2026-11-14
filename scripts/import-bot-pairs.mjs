// Import pairs from Bot (relay-beacon) pairs.json into Agent's pairs.local.json format.
// Usage: node scripts/import-bot-pairs.mjs [--bot /path/to/Bot] [--out config/pairs.local.json] [--cdp http://127.0.0.1:9222]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const botDir = resolve(arg("--bot", "/Users/lazydeepak/dev/Bot"));
const outPath = resolve(arg("--out", join(root, "config", "pairs.local.json")));
const cdpUrl = arg("--cdp", "http://127.0.0.1:9222");

const botPairs = JSON.parse(readFileSync(join(botDir, "pairs.json"), "utf8"));
const pairs = [];
for (const p of botPairs.pairs ?? []) {
  if (p.deleted) continue;
  let conversationId, conversationUrl;
  try {
    const url = new URL(p.chatgpt_url);
    const segs = url.pathname.split("/").filter(Boolean);
    const idx = segs.indexOf("c");
    conversationId = idx >= 0 ? segs[idx + 1] : undefined;
    // Preserve the original project-scoped URL so project slugs survive.
    conversationUrl = p.chatgpt_url;
  } catch {
    conversationId = undefined;
    conversationUrl = p.chatgpt_url;
  }
  pairs.push({
    pairId: p.id,
    enabled: false,
    worker: {
      type: "opencode",
      sessionId: p.session_id
    },
    planner: {
      type: "chatgpt-browser",
      conversationId: conversationId ?? p.id,
      conversationUrl,
      browser: { cdpUrl }
    }
  });
}

const out = { pairs };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Imported ${pairs.length} pairs from ${botDir}/pairs.json -> ${outPath}`);