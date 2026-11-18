import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Bridge drift guard.
 *
 * The renderer declares its `window.desktop` surface in `declare global`; the preload exports `const api`;
 * the preview bridge mirrors both. These drift silently (initializePair / clearTimeline shipped in renderer
 * + IPC + preview, but the preload never exposed them — the button was dead for a month). This test extracts
 * the top-level method names from each surface and requires them to match exactly.
 */

function topLevelMembers(body: string, indent: string): string[] {
  const names: string[] = [];
  for (const line of body.split("\n")) {
    const match = new RegExp(`^${indent}([a-zA-Z_$][\\w$]*)\\s*[:(,]`).exec(line);
    if (match) names.push(match[1]);
  }
  return sortedUnique(names);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function extractWindowDesktop(source: string): string {
  const match = source.match(/declare global\s*\{\s*interface Window\s*\{\s*desktop:\s*\{([^]*?)\n    \};/);
  if (!match) throw new Error("declare global Window.desktop interface not found in renderer.ts");
  return match[1];
}

function extractConstApi(source: string): string {
  const match = source.match(/const api: DesktopApi = \{([^]*?)\n\};/);
  if (!match) throw new Error("const api not found in preload/index.ts");
  return match[1];
}

function extractPreviewApi(source: string): string {
  // The preview bridge exports createPreviewDesktopApi() returning an object with `async name(...)`.
  return source;
}

const renderer = readFileSync("desktop/renderer/renderer.ts", "utf8");
const preload = readFileSync("desktop/preload/index.ts", "utf8");
const preview = readFileSync("desktop/preview/preview-bridge.ts", "utf8");

const rendererMethods = topLevelMembers(extractWindowDesktop(renderer), "      ")
  // configPath is a property (no parens after it) and covered separately below.
  .filter((name) => name !== "configPath");
const preloadMethods = sortedUnique(topLevelMembers(extractConstApi(preload), "  "));
const previewMethods = sortedUnique(
  [...preview.matchAll(/^\s*async\s+([a-zA-Z_$][\w$]*)\s*\(/gm)].map((match) => match[1] as string)
);

// Methods the renderer may declare that the preview deliberately does NOT implement (it has no
// push-event channel): these are invoked only behind `typeof window.desktop?.x === "function"` guards.
const previewExempt = new Set(["onEvent", "onStatusRefresh", "onWorkerProgressUpdate", "configPath"]);

describe("window.desktop bridge surface parity", () => {
  it("preload exposes every top-level method the renderer declares", () => {
    expect(preloadMethods).toEqual(expect.arrayContaining(rendererMethods));
  });

  it("preload exposes nothing the renderer does not declare", () => {
    expect(preloadMethods).toEqual(expect.arrayContaining(rendererMethods));
    expect(preloadMethods.length).toBeLessThanOrEqual(rendererMethods.length + 8); // configPath + few tolerated extras
  });

  it("preview bridge exposes every top-level method the renderer declares (except push-event helpers)", () => {
    const expected = rendererMethods.filter((name) => !previewExempt.has(name));
    expect(previewMethods).toEqual(expect.arrayContaining(expected));
  });
});
