/** Agent-relay script — Bundle service entrypoint with esbuild. NEXT: build code index. */
import esbuild from "esbuild";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "service");

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "src", "service-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: join(outDir, "service.bundle.cjs"),
  external: ["node:sqlite", "playwright-core"],
  logLevel: "info",
  define: {
    "process.env.RELAY_REMOTE_HOST": '"127.0.0.1"',
    "process.env.RELAY_REMOTE_PORT": '"8181"',
  }
});

console.log("Service bundle complete: " + outDir);
