import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

async function readDesktop(relative: string): Promise<string> {
  return readFile(new URL(`../desktop/${relative}`, import.meta.url), "utf8");
}

describe("project pairs dashboard surface", () => {
  it("renders a single projects panel holding the dashboard", async () => {
    const html = await readDesktop("renderer/index.html");
    expect(html).toMatch(/id="project-pairs-panel"/);
    expect(html).toMatch(/id="project-pairs-list"/);
    expect(html).toMatch(/id="no-project-pairs"/);
    expect(html).not.toMatch(/id="pairs-panel"/);
    expect(html).not.toMatch(/id="pairs-list"/);
    expect(html.indexOf('id="project-pairs-panel"')).toBeGreaterThan(-1);
  });

  it("exposes an add project pair button", async () => {
    const html = await readDesktop("renderer/index.html");
    expect(html).toMatch(/id="add-project-pair"/);
    expect(html).toMatch(/\+ Add Project/);
    expect(html).toMatch(/<h2>Projects<\/h2>/);
    expect(html).toMatch(/No projects configured/);
    expect(html).toMatch(/id="expand-all"/);
    expect(html).toMatch(/id="collapse-all"/);
    expect(html).toMatch(/id="add-pair"/);
  });

  it("provides an in-app modal for naming and binding a project pair", async () => {
    const html = await readDesktop("renderer/index.html");
    expect(html).toMatch(/id="project-pair-modal"/);
    expect(html).toMatch(/id="project-pair-name"/);
    expect(html).toMatch(/id="project-pair-repo"/);
    expect(html).toMatch(/id="project-pair-repo-detect"/);
    expect(html).toMatch(/id="project-pair-repo-start-server"/);
    expect(html).toMatch(/id="project-pair-repo-active"/);
    expect(html).toMatch(/id="project-pair-repo-options"/);
    expect(html).toMatch(/id="project-pair-chatgpt"/);
    expect(html).toMatch(/id="project-pair-chatgpt-detect"/);
    expect(html).toMatch(/id="project-pair-chatgpt-start-browser"/);
    expect(html).toMatch(/id="project-pair-chatgpt-options"/);
    expect(html).toMatch(/id="project-pair-create"/);
    expect(html).toMatch(/id="project-pair-cancel"/);
  });

  it("wires the project pair flow in the renderer without native prompts", async () => {
    const renderer = await readDesktop("renderer/renderer.ts");
    expect(renderer).toMatch(/function renderProjectPairs/);
    expect(renderer).toMatch(/function refreshProjectPairs/);
    expect(renderer).toMatch(/function openProjectPairModal/);
    expect(renderer).toMatch(/function confirmProjectPairCreation/);
    expect(renderer).toMatch(/function removeProjectPair/);
    expect(renderer).toMatch(/window\.desktop\.listProjectPairs\(\)/);
    expect(renderer).toMatch(/window\.desktop\.createProjectPair\(input\)/);
    expect(renderer).toMatch(/window\.desktop\.removeProjectPair\(projectPairId\)/);
    expect(renderer).toMatch(/window\.desktop\.discoverWorkerSessions\(\)/);
    expect(renderer).toMatch(/window\.desktop\.discoverOpenCodeProjects\(\)/);
    expect(renderer).toMatch(/window\.desktop\.discoverChatGptProjects\(\)/);
    expect(renderer).toMatch(/window\.desktop\.startPlannerBrowser\(\)/);
    expect(renderer).toMatch(/window\.desktop\.startWorkerServer\(\{ repoPath \}\)/);
    expect(renderer).toMatch(/project-pair-repo-start-server/);
    expect(renderer).toMatch(/project-pair-chatgpt-start-browser/);
    expect(renderer).not.toMatch(/window\.prompt\(/);
  });

  it("opens session creation on a project picker with an automation session id", async () => {
    const wizardView = await readDesktop("renderer/wizard-view.ts");
    expect(wizardView).toMatch(/function renderProjectPicker/);
    expect(wizardView).toMatch(/"wiz-project"/);
    expect(wizardView).toMatch(/"Automation Session ID"/);
    expect(wizardView).toMatch(/Sessions use this project/);
    const wizard = await readDesktop("renderer/wizard.ts");
    expect(wizard).toMatch(/projectPairId\?: string/);
    expect(wizard).toMatch(/Enter a valid Automation Session ID/);
  });

  it("keeps sessions visible without unfolding project details", async () => {
    const renderer = await readDesktop("renderer/renderer.ts");
    const cardFn = renderer.slice(renderer.indexOf("function renderProjectPairCard"));
    const sessionsAt = cardFn.indexOf("appendPairCard(sessionList, session)");
    const detailsAt = cardFn.indexOf("renderProjectPairDetails(pair)");
    expect(sessionsAt).toBeGreaterThan(-1);
    expect(detailsAt).toBeGreaterThan(-1);
    expect(detailsAt).toBeLessThan(sessionsAt);
    expect(cardFn).toMatch(/renderProjectPairDetails\(pair\)/);
  });

  it("folds project pair cards to name plus status with expandable details", async () => {
    const renderer = await readDesktop("renderer/renderer.ts");
    expect(renderer).toMatch(/expandedProjectPairs/);
    expect(renderer).toMatch(/function renderProjectPairDetails/);
    expect(renderer).toMatch(/function projectPairPresence/);
    expect(renderer).toMatch(/Worker Agent project/);
    expect(renderer).toMatch(/Planner Agent project/);
    // The card toggle's show/hide markers live with the shared card builders (dom.ts).
    const dom = await readDesktop("renderer/dom.ts");
    expect(dom).toMatch(/"Collapse"/);
    expect(dom).toMatch(/"Details"/);
    expect(dom).toMatch(/aria-expanded/);
  });

  it("renders a single projects panel with session controls relocated", async () => {
    const html = await readDesktop("renderer/index.html");
    expect(html).not.toMatch(/id="pairs-panel"/);
    expect(html).not.toMatch(/id="pairs-list"/);
    expect(html).toMatch(/id="project-pairs-panel"/);
    expect(html).toMatch(/id="expand-all"/);
    expect(html).toMatch(/id="collapse-all"/);
    expect(html).toMatch(/id="add-pair"/);
    expect(html).toMatch(/id="add-project-pair"/);
  });

  it("nests session cards inside project cards with an unassigned fallback", async () => {
    const renderer = await readDesktop("renderer/renderer.ts");
    expect(renderer).not.toMatch(/function renderPairControls/);
    expect(renderer).not.toMatch(/function renderSessionGroup/);
    expect(renderer).not.toMatch(/function showEmpty/);
    expect(renderer).toMatch(/function renderUnassignedSessions/);
    expect(renderer).toMatch(/Unassigned/);
    expect(renderer).toMatch(/project-session-list/);
    expect(renderer).toMatch(/appendPairCard\(sessionList, session\)/);
    const css = await readDesktop("renderer/styles.css");
    expect(css).not.toMatch(/\.session-group/);
    expect(css).not.toMatch(/\.project-pair-card > \.pair-card/);
    expect(css).toMatch(/\.project-session-list\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("scrolls the project pairs container independently without breaking the grid", async () => {
    const css = await readDesktop("renderer/styles.css");
    expect(css).toMatch(/\.project-pairs-list\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/#project-pairs-panel\s*\{[^}]*grid-row:\s*1 \/ span 2/);
    expect(css).toMatch(/\.events-panel\s*\{[^}]*grid-column:\s*2/);
    expect(css).toMatch(/\.project-pair-head\s+\.pair-id\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it("groups session pairs by projectPairId and preserves isolation", async () => {
    const renderer = await readDesktop("renderer/renderer.ts");
    expect(renderer).toMatch(/pair\.projectPairId/);
    expect(renderer).toMatch(/sessionProject\.get/);
    // The session→project assignment helper now lives in the shared view-state module.
    const viewState = await readDesktop("renderer/view-state.ts");
    expect(viewState).toMatch(/refreshProjectAssignments/);
    expect(viewState).toMatch(/sessionProject/);
    // Pair cards render with pair-specific dataset and actions tied to card.pairId,
    // not routed through project identity alone (isolation preserved).
  });

  it("registers narrow project pair channels on both sides of the bridge", async () => {
    const channels = await readDesktop("shared/ipc-channels.ts");
    const preload = await readDesktop("preload/index.ts");
    for (const name of [
      "listProjectPairs",
      "createProjectPair",
      "removeProjectPair",
      "discoverOpenCodeProjects",
      "discoverChatGptProjects"
    ]) {
      expect(channels).toMatch(new RegExp(`\\b${name}: "desktop:project-pairs:`));
      expect(preload).toMatch(new RegExp(`\\b${name}[:\(]`));
    }
  });
});
