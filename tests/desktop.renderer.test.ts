import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  appendEvent,
  controlsFor,
  filterEvents,
  peerBadgeClass,
  peerStatusLabel,
  stateDotClass,
  summarizeStatus,
  supervisorBadgeClass,
  toPairCard,
  validationSummaryClass
} from "../desktop/renderer/state.js";
import type { EventRecordDto, PairIdentityDto, PeerHealthDto, StatusSummaryDto, ValidationResultDto } from "../desktop/shared/dto.js";

const pair: PairIdentityDto = {
  pairId: "kisab-main",
  enabled: true,
  worker: { type: "opencode", sessionId: "s1", repoPath: "/repo" },
  planner: { type: "chatgpt-browser", conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" }
};

const validation: ValidationResultDto = {
  pairId: "kisab-main",
  status: "READY",
  checks: [{ name: "worker.serverReachable", status: "PASS", reason: "" }],
  validatedAt: "2026-08-29T00:00:00.000Z"
};

describe("toPairCard", () => {
  it("defaults a missing status to STOPPED", () => {
    const card = toPairCard(pair, undefined);
    expect(card.runtimeState).toBe("STOPPED");
    expect(card.paused).toBe(false);
    expect(card.workerSessionId).toBe("s1");
    expect(card.conversationId).toBe("c1");
  });

  it("surfaces runtime, supervisor, peer and validation context", () => {
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
    const card = toPairCard(pair, status, validation);
    expect(card.runtimeState).toBe("RUNNING");
    expect(card.hasRelayHistory).toBe(true);
    expect(card.supervisorState).toBe("WORKING");
    expect(card.validation?.status).toBe("READY");
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

  it("does not let an unrelated validation failure alter connected worker/planner health", () => {
    const status: PeerHealthDto = {
      pairId: "kisab-main",
      runtimeState: "RUNNING",
      supervisorState: "WORKING",
      worker: "connected",
      planner: "connected",
      workerActivity: "idle",
      recovering: false,
      workerObserved: true,
      plannerObserved: true,
      paused: false,
      enabled: true
    };
    const failedValidation: ValidationResultDto = {
      pairId: "kisab-main",
      status: "NOT_READY",
      checks: [{ name: "worker.serverReachable", status: "FAIL", reason: "unrelated check failed" }],
      validatedAt: "2026-08-29T00:00:00.000Z"
    };
    const card = toPairCard(pair, status, failedValidation);
    expect(card.worker).toBe("connected");
    expect(card.workerActivity).toBe("idle");
    expect(card.validation?.status).toBe("NOT_READY");
  });
});

describe("controlsFor", () => {
  it("enables start on a stopped enabled pair", () => {
    const controls = controlsFor("STOPPED", false, true);
    expect(controls.canStart).toBe(true);
    expect(controls.canStop).toBe(false);
    expect(controls.canValidate).toBe(true);
  });

  it("hides start while running and enables stop/pause", () => {
    const controls = controlsFor("RUNNING", false, true);
    expect(controls.canStart).toBe(false);
    expect(controls.canStop).toBe(true);
    expect(controls.canPause).toBe(true);
    expect(controls.canResume).toBe(false);
  });

  it("maps disconnected/failure runtime states to the stopped cluster", () => {
    expect(controlsFor("ERROR", false, true).canStart).toBe(true);
    expect(controlsFor("DISCONNECTED", false, true).canStart).toBe(true);
    expect(controlsFor("FAILED", false, true).canStart).toBe(true);
  });

  it("enables resume on a paused running pair", () => {
    const controls = controlsFor("RUNNING", true, true);
    expect(controls.canResume).toBe(true);
    expect(controls.canPause).toBe(false);
  });

  it("never exposes start for a disabled pair", () => {
    expect(controlsFor("STOPPED", false, false).canStart).toBe(false);
    expect(controlsFor("RUNNING", false, false).canStart).toBe(false);
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

  it("classifies supervisor badges", () => {
    expect(supervisorBadgeClass("WORKING")).toBe("badge-ok");
    expect(supervisorBadgeClass("STUCK")).toBe("badge-failed");
    expect(supervisorBadgeClass("PAUSED")).toBe("badge-paused");
    expect(supervisorBadgeClass(undefined)).toBe("badge-neutral");
  });

  it("classifies peer health badges", () => {
    expect(peerBadgeClass("connected")).toBe("badge-ok");
    expect(peerBadgeClass("degraded")).toBe("badge-degraded");
    expect(peerBadgeClass("failed")).toBe("badge-failed");
    expect(peerBadgeClass("unknown")).toBe("badge-neutral");
  });

  it("labels a reachable idle worker as Connected · Idle, not degraded", () => {
    expect(peerStatusLabel("connected", "idle", false)).toBe("Connected · Idle");
  });

  it("labels an actively generating worker as Connected · Working", () => {
    expect(peerStatusLabel("connected", "working", false)).toBe("Connected · Working");
  });

  it("labels a failed peer under active recovery as Connection lost · Recovering…", () => {
    expect(peerStatusLabel("failed", undefined, true, "transport")).toBe("Connection lost · Recovering…");
  });

  it("labels a transport-level failure distinctly from a session-level failure", () => {
    expect(peerStatusLabel("failed", undefined, false, "transport")).toBe("Transport unavailable");
    expect(peerStatusLabel("failed", undefined, false, "session")).toBe("Session unavailable");
  });

  it("marks a recovering worker badge as degraded-styled even though health is failed", () => {
    expect(peerBadgeClass("failed", true)).toBe("badge-degraded");
  });

  it("classifies validation summaries", () => {
    expect(validationSummaryClass("READY")).toBe("check-pass");
    expect(validationSummaryClass("NOT_READY")).toBe("check-fail");
    expect(validationSummaryClass(undefined)).toBe("check-fail");
  });
});

describe("event helpers", () => {
  it("appends and caps events, newest first", () => {
    const events: EventRecordDto[] = [];
    const e1 = { time: "2026-08-29T00:00:01.000Z", type: "A" };
    const e2 = { time: "2026-08-29T00:00:02.000Z", type: "B" };
    const e3 = { time: "2026-08-29T00:00:03.000Z", type: "C" };

    let next = appendEvent(events, e3, 2);
    next = appendEvent(next, e1, 2);
    next = appendEvent(next, e2, 2);

    expect(next).toHaveLength(2);
    expect(next[0]?.type).toBe("C");
    expect(next[1]?.type).toBe("B");
  });

  it("filters events by pair including global events", () => {
    const events: EventRecordDto[] = [
      { time: "t1", type: "PAIR_VALIDATED", pairId: "kisab-main" },
      { time: "t2", type: "GLOBAL", pairId: undefined },
      { time: "t3", type: "PAIR_VALIDATED", pairId: "b-main" }
    ];
    expect(filterEvents(events, "kisab-main").map((e) => e.type)).toEqual(["PAIR_VALIDATED", "GLOBAL"]);
    expect(filterEvents(events)).toHaveLength(3);
  });

  it("summarizes status counts", () => {
    const status: StatusSummaryDto = { enabled: 2, running: 1, healthy: 1, degraded: 0, failed: 1, pairs: [] };
    expect(summarizeStatus(status)).toContain("1 running");
    expect(summarizeStatus(status)).toContain("1 failed");
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
    const workerSession = await readFile(new URL("../desktop/renderer/worker-session.ts", import.meta.url), "utf8");
    expect(pairCard).toMatch(/Open worker session/);
    expect(workerSession).toMatch(/showWorkerTranscript\(pairId\)/);
    const transcript = await readFile(new URL("../desktop/renderer/worker-transcript.ts", import.meta.url), "utf8");
    expect(transcript).toMatch(/window\.desktop\.getWorkerTranscript\(pairId\)/);
    expect(transcript).toMatch(/text\.textContent = message\.text/);
    expect(transcript).not.toMatch(/innerHTML|openWorkerSession\(/);
  });

  it("wires the show-worker-on-start preference to start actions", async () => {
    const renderer = await readFile(new URL("../desktop/renderer/renderer.ts", import.meta.url), "utf8");
    expect(renderer).toMatch(/SHOW_WORKER_ON_START_KEY/);
    expect(renderer).toMatch(/showWorkerOnStartPref\(\)/);
  });

  it("uses explicit Resume and ChatGPT-first start choices", async () => {
    const pairCard = await readFile(new URL("../desktop/renderer/pair-card.ts", import.meta.url), "utf8");
    expect(pairCard).toMatch(/primingRadio\(card\.pairId, "resume", "Resume"/);
    expect(pairCard).toMatch(/hasRelayHistory \? "resume" : "from-planner"/);
    expect(pairCard).not.toMatch(/"standard", "Standard"/);
  });

  it("provides a stopped-pair worker model selector with an explicit planner notification option", async () => {
    const workerSession = await readFile(new URL("../desktop/renderer/worker-session.ts", import.meta.url), "utf8");
    expect(workerSession).toMatch(/function renderWorkerModelControl/);
    expect(workerSession).toMatch(/notify\.type = "checkbox"/);
    expect(workerSession).toMatch(/Notify ChatGPT/);
    expect(workerSession).toMatch(/Switch .* worker to .* This applies from the next worker turn/);
  });

  it("uses an in-app two-step modal for naming and confirming worker session creation", async () => {
    const html = await readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
    const renderer = await readFile(new URL("../desktop/renderer/renderer.ts", import.meta.url), "utf8");
    expect(html).toMatch(/id="worker-session-modal"/);
    expect(html).toMatch(/id="worker-session-name"/);
    expect(html).toMatch(/id="worker-session-confirm"/);
    const workerSession = await readFile(new URL("../desktop/renderer/worker-session.ts", import.meta.url), "utf8");
    expect(workerSession).toMatch(/function renderWorkerSessionModal/);
    expect(workerSession).toMatch(/workerSessionCreation\.confirmed \? "Create session" : "Continue"/);
    expect(renderer).not.toMatch(/window\.prompt\("Name the new OpenCode worker session/);
  });

  it("forces a fresh worker-progress fetch and rejects stale request responses", async () => {
    // The worker progress panel lives in its own module now; the renderer still forces a refresh
    // when the user asks for one.
    const progressView = await readFile(new URL("../desktop/renderer/progress-view.ts", import.meta.url), "utf8");
    expect(progressView).toMatch(/refreshWorkerProgress\(state\.activeProgressPair,\s*true\)/);
    expect(progressView).toMatch(/progressRequestGenerations\.get\(pairId\)\s*!==\s*generation/);
    expect(progressView).toMatch(/dto\.sessionId\s*!==\s*currentSessionId/);
  });
});
