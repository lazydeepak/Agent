import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  controlsFor,
  stateDotClass,
  toPairCard,
} from "../desktop/renderer/state.js";
import type { PairIdentityDto, PeerHealthDto } from "../src/contracts/desktop.js";

const pair: PairIdentityDto = {
  pairId: "kisab-main",
  enabled: true,
  worker: { type: "opencode", sessionId: "s1", repoPath: "/repo" },
  planner: { type: "chatgpt-browser", conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" }
};

describe("toPairCard", () => {
  it("defaults a missing status to STOPPED", () => {
    const card = toPairCard(pair, undefined);
    expect(card.runtimeState).toBe("STOPPED");
    expect(card.paused).toBe(false);
    expect(card.workerSessionId).toBe("s1");
    expect(card.conversationId).toBe("c1");
  });

  it("surfaces runtime state", () => {
    const status: PeerHealthDto = {
      pairId: "kisab-main",
      runtimeState: "RUNNING",
      hasRelayHistory: true,
      supervisorState: "WORKING",
      worker: "connected",
      planner: "connected",
      recovering: false,
      workerObserved: true,
      plannerObserved: true,
      paused: false,
      enabled: true
    };
    const card = toPairCard(pair, status);
    expect(card.runtimeState).toBe("RUNNING");
    expect(card.hasRelayHistory).toBe(true);
  });

  it("copies endpoint metadata for diagnostics", () => {
    const pairWithEndpoints: PairIdentityDto = {
      ...pair,
      worker: { ...pair.worker, server: { baseUrl: "http://localhost:9999" } },
      planner: { ...pair.planner, browser: { cdpUrl: "http://127.0.0.1:9222" } }
    };
    const card = toPairCard(pairWithEndpoints, undefined);
    expect(card.openCodeEndpoint).toBe("http://localhost:9999");
    expect(card.cdpEndpoint).toBe("http://127.0.0.1:9222");
  });
});

describe("controlsFor", () => {
  it("enables start on a stopped enabled pair", () => {
    const controls = controlsFor("STOPPED", false, true);
    expect(controls.canStart).toBe(true);
    expect(controls.canStop).toBe(false);
  });

  it("hides start while running and enables stop/pause", () => {
    const controls = controlsFor("RUNNING", false, true);
    expect(controls.canStart).toBe(false);
    expect(controls.canStop).toBe(true);
    expect(controls.canPause).toBe(true);
    expect(controls.canResume).toBe(false);
  });

  it("enables resume on a paused running pair", () => {
    const controls = controlsFor("RUNNING", true, true);
    expect(controls.canResume).toBe(true);
    expect(controls.canPause).toBe(false);
  });
});

describe("badge and dot classifiers", () => {
  it("classifies runtime state dots", () => {
    expect(stateDotClass("RUNNING", false)).toBe("dot-ok");
    expect(stateDotClass("ERROR", false)).toBe("dot-danger");
    expect(stateDotClass("STOPPED", false)).toBe("dot-dim");
    expect(stateDotClass("STARTING", false)).toBe("dot-warn");
    expect(stateDotClass("RUNNING", true)).toBe("dot-ok");
  });
});

describe("renderer visibility styles", () => {
  it("keeps the wizard modal hidden until it is opened", async () => {
    const styles = await readFile(new URL("../desktop/renderer/styles.css", import.meta.url), "utf8");
    expect(styles).toMatch(/\.modal-overlay\.hidden\s*{\s*display:\s*none;/);
  });

  it("assigns stable ids to generated wizard inputs", async () => {
    const wizardView = await readFile(new URL("../desktop/renderer/wizard-view.ts", import.meta.url), "utf8");
    expect(wizardView).toMatch(/function textField[\s\S]*?input\.id\s*=\s*key;/);
  });

  it("exposes the open-worker-session action on pair cards", async () => {
    const pairCard = await readFile(new URL("../desktop/renderer/pair-card.ts", import.meta.url), "utf8");
    expect(pairCard).toMatch(/Open Worker Agent/);
  });

  it("wires the show-worker-on-start preference to start actions", async () => {
    const renderer = await readFile(new URL("../desktop/renderer/renderer.ts", import.meta.url), "utf8");
    expect(renderer).toMatch(/SHOW_WORKER_ON_START_KEY/);
    expect(renderer).toMatch(/showWorkerOnStartPref\(\)/);
  });

  it("uses explicit Start Relay and Stop Relay labels", async () => {
    const pairCard = await readFile(new URL("../desktop/renderer/pair-card.ts", import.meta.url), "utf8");
    expect(pairCard).toMatch(/Start Relay/);
    expect(pairCard).toMatch(/Stop Relay/);
  });
});
