import { createServer } from "node:http";
import fs from "node:fs";
import { join } from "node:path";
import esbuild from "esbuild";

const PORT = 3000;
const HOST = "0.0.0.0";
const ROOT = process.cwd();

const RENDERER_TS = join(ROOT, "desktop", "renderer", "renderer.ts");
const PREVIEW_BRIDGE_TS = join(ROOT, "desktop", "preview", "preview-bridge.ts");
const HTML_PATH = join(ROOT, "desktop", "renderer", "index.html");
const CSS_PATH = join(ROOT, "desktop", "renderer", "styles.css");

let cachedRendererJs: string | null = null;
let cachedPreviewBridgeJs: string | null = null;

async function bundleAssets(): Promise<void> {
  console.log("[desktop-preview] Bundling Electron desktop renderer and preview bridge...");

  const [rendererBuild, bridgeBuild] = await Promise.all([
    esbuild.build({
      entryPoints: [RENDERER_TS],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2020",
      write: false,
      logLevel: "warning"
    }),
    esbuild.build({
      entryPoints: [PREVIEW_BRIDGE_TS],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2020",
      write: false,
      logLevel: "warning"
    })
  ]);

  cachedRendererJs = rendererBuild.outputFiles[0].text;
  cachedPreviewBridgeJs = bridgeBuild.outputFiles[0].text;
  console.log(`[desktop-preview] Bundles ready: renderer.js (${cachedRendererJs.length} bytes), preview-bridge.js (${cachedPreviewBridgeJs.length} bytes)`);
}

function getHtml(): string {
  const originalHtml = fs.readFileSync(HTML_PATH, "utf8");
  // Inject the preview bridge script immediately before the renderer script
  // so window.desktop is available when DOMContentLoaded and renderer boot runs.
  // Also adjust CSP to allow the self-hosted preview bridge script.
  return originalHtml
    .replace(
      '<script defer src="./renderer.js"></script>',
      '<script src="./preview-bridge.js"></script>\n    <script defer src="./renderer.js"></script>'
    );
}

async function startServer(): Promise<void> {
  await bundleAssets();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;

      if (pathname === "/" || pathname === "/index.html") {
        const html = getHtml();
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache",
          "X-Content-Type-Options": "nosniff"
        });
        res.end(html);
        return;
      }

      if (pathname === "/styles.css") {
        const css = fs.readFileSync(CSS_PATH, "utf8");
        res.writeHead(200, {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache"
        });
        res.end(css);
        return;
      }

      if (pathname === "/renderer.js") {
        await bundleAssets();
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache"
        });
        res.end(cachedRendererJs);
        return;
      }

      if (pathname === "/preview-bridge.js") {
        await bundleAssets();
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma": "no-cache"
        });
        res.end(cachedPreviewBridgeJs);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (error) {
      console.error("[desktop-preview] Request error:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[desktop-preview] Agent Electron desktop preview running at http://${HOST}:${PORT}/`);
  });
}

startServer().catch((error) => {
  console.error("[desktop-preview] Failed to start preview server:", error);
  process.exit(1);
});
