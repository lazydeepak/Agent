/** Agent-relay script — Build Tauri UI sidecar (esbuild bundle for sidecar). NEXT: build code index. */
import { build, context } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = new URL("../tauri-client/dist/", import.meta.url);
const dev = process.argv.includes("--dev");
await mkdir(dist, { recursive: true });
await copyFile(new URL("../tauri-client/index.html", import.meta.url), new URL("index.html", dist));
const options = {
  absWorkingDir: root,
  entryPoints: ["tauri-client/src/index.tsx"],
  outfile: "tauri-client/dist/app.js",
  bundle: true,
  jsx: "automatic",
  format: "iife",
  platform: "browser",
  target: "es2020",
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
  logLevel: "info",
};
if (dev) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ servedir: fileURLToPath(dist), host: "127.0.0.1", port: 1420 });
} else {
  await build(options);
}
