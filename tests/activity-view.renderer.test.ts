import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

async function readDesktop(relative: string): Promise<string> {
  return readFile(new URL(`../desktop/${relative}`, import.meta.url), "utf8");
}

describe("activity log view surface", () => {
  it("exposes an activity nav entry alongside dashboard and projects", async () => {
    const html = await readDesktop("renderer/index.html");
    expect(html).toMatch(/id="nav-home"/);
    expect(html).toMatch(/id="nav-all-sessions"/);
    expect(html).toMatch(/id="nav-activity"/);
    expect(html).toMatch(/id="nav-activity-count"/);
    expect(html).toMatch(/<span class="sidebar-item-label">Activity<\/span>/);
  });

  it("renders an activity panel with scope, level, and search filters", async () => {
    const html = await readDesktop("renderer/index.html");
    expect(html).toMatch(/id="activity-panel"/);
    expect(html).toMatch(/<h2>Activity Log<\/h2>/);
    expect(html).toMatch(/id="activity-list"/);
    expect(html).toMatch(/id="activity-summary"/);
    expect(html).toMatch(/id="activity-scope"/);
    expect(html).toMatch(/id="activity-level"/);
    expect(html).toMatch(/id="activity-search"/);
    expect(html).toMatch(/id="activity-refresh"/);
    expect(html).toMatch(/id="activity-clear"/);
    expect(html).toMatch(/id="activity-follow"/);
  });

  it("registers a third view mode and toggles the activity panel", async () => {
    const renderer = await readDesktop("renderer/renderer.ts");
    expect(renderer).toMatch(/type ViewMode = "sessions" \| "home" \| "activity"/);
    expect(renderer).toMatch(/classList\.toggle\("active", view === "activity"\)/);
    expect(renderer).toMatch(/classList\.add\("view-activity"\)/);
    expect(renderer).toMatch(/classList\.remove\("view-home", "view-activity"\)/);
    expect(renderer).toMatch(/activityPanel\?\.classList\.remove\("hidden"\)/);
    expect(renderer).toMatch(/nav-activity"\)[\s\S]{0,400}setView\("activity"\)/);
  });

  it("wires the activity controls once during boot", async () => {
    const renderer = await readDesktop("renderer/renderer.ts");
    expect(renderer).toMatch(/wireActivityView\(\)/);
    expect(renderer).toMatch(/noteActivityEvent\(event\)/);
    const view = await readDesktop("renderer/activity-view.ts");
    expect(view).toMatch(/export function wireActivityView/);
  });

  it("reads the log only through the typed desktop bridge", async () => {
    const view = await readDesktop("renderer/activity-view.ts");
    expect(view).toMatch(/window\.desktop\.getTimeline\(undefined, MAX_ACTIVITY_EVENTS\)/);
    expect(view).toMatch(/window\.desktop\.clearTimeline\(\)/);
    // The renderer must never reach the log file, the store, or Node builtins directly.
    expect(view).not.toMatch(/node:fs/);
    expect(view).not.toMatch(/node:sqlite/);
    expect(view).not.toMatch(/supervisor\.ndjson/);
    expect(view).not.toMatch(/\brequire\(/);
  });

  it("classifies failure-shaped event types as errors", async () => {
    const view = await readDesktop("renderer/activity-view.ts");
    expect(view).toMatch(/type\.includes\("ERROR"\)/);
    expect(view).toMatch(/type\.includes\("FAILED"\)/);
    expect(view).toMatch(/ERROR_TYPES\.has\(type\)/);
    expect(view).toMatch(/badge-failed/);
    expect(view).toMatch(/badge-degraded/);
    // The predicate is shared with the dashboard Error Log so both views agree.
    const renderer = await readDesktop("renderer/renderer.ts");
    expect(renderer).toMatch(/e\.type\.includes\("ERROR"\)/);
  });

  it("tails live events with a bounded buffer and newest-first order", async () => {
    const view = await readDesktop("renderer/activity-view.ts");
    expect(view).toMatch(/const MAX_ACTIVITY_EVENTS = \d+/);
    expect(view).toMatch(/events\.length > MAX_ACTIVITY_EVENTS/);
    expect(view).toMatch(/\.slice\(\)\s*\.reverse\(\)/);
  });

  it("styles the activity view as a full-width scrolling panel", async () => {
    const css = await readDesktop("renderer/styles.css");
    expect(css).toMatch(/\.layout\.view-activity #dashboard-panel\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.layout\.view-activity #activity-panel\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(css).toMatch(/\.activity-list\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.activity-row--error/);
    expect(css).toMatch(/\.activity-details\s*\{[^}]*white-space:\s*pre-wrap/);
  });
});