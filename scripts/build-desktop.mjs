/** Agent-relay script — Build Electron desktop bundle (esbuild + desktop-dist output). NEXT: build code index. */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "desktop-dist");
const rendererDir = join(out, "desktop", "renderer");

function clean() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "desktop", "renderer"), { recursive: true });
  mkdirSync(join(out, "desktop", "preload"), { recursive: true });
}

function compileCoreAndMain() {
  execSync("tsc -p tsconfig.desktop.json", { cwd: root, stdio: "inherit" });
}

async function bundlePreload() {
  await esbuild.build({
    entryPoints: [join(root, "desktop", "preload", "index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: join(out, "desktop", "preload", "preload.js"),
    external: ["electron"],
    logLevel: "info"
  });
}

async function bundleRenderer() {
  await esbuild.build({
    entryPoints: [join(root, "desktop", "renderer", "renderer.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2020",
    outfile: join(rendererDir, "renderer.js"),
    logLevel: "info"
  });
}

function copyStatic() {
  cpSync(join(root, "desktop", "renderer", "index.html"), join(rendererDir, "index.html"));
  cpSync(join(root, "desktop", "renderer", "styles.css"), join(rendererDir, "styles.css"));
}

async function main() {
  clean();
  compileCoreAndMain();
  await bundlePreload();
  await bundleRenderer();
  copyStatic();
  console.log("Desktop build complete: " + out);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
