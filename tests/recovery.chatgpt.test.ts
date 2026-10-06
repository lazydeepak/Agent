import { describe, expect, it } from "vitest";
import { FakeChatGPTBrowserAdapter, type ChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import {
  ExternalBrowserManager,
  ManagedBrowserManager,
  browserManagerFor,
  recoverChatGPT,
  type ManagedBrowserHandle,
  type ManagedBrowserLens
} from "../src/recovery/index.js";
import type { PlannerIdentity, PlannerObservation, ReadinessCheck, RelayReceipt, RelayableMessage } from "../src/types.js";
import { RecordingBrowserManager, makePair, noopSleep } from "./helpers.js";

class ScriptedChatGPTAdapter implements ChatGPTBrowserAdapter {
  readonly probes: number[] = [];

  constructor(private observation: PlannerObservation) {}

  setObservation(observation: PlannerObservation): void {
    this.observation = observation;
  }

  async checkReadiness(_planner: PlannerIdentity): Promise<ReadinessCheck[]> {
    return [];
  }

  async getLatestPlannerMessage(): Promise<RelayableMessage | undefined> {
    return undefined;
  }

  async sendWorkerMessage(): Promise<RelayReceipt> {
    return { pairId: "", sourceMessageId: "", targetId: "", delivered: true, deliveredAt: "", transport: "test" };
  }

  async observePlannerConversation(): Promise<PlannerObservation> {
    this.probes.push(this.observation.reachable ? 1 : 0);
    return this.observation;
  }
}

class ManagedScriptedBrowser extends RecordingBrowserManager {
  relaunches = 0;

  constructor() {
    super("managed");
    this.reachable = false;
  }

  override async reconnect(): Promise<void> {
    this.actions.push("reconnect");
    if (!this.reachable) {
      this.reachable = true;
    }
  }

  override async relaunch(): Promise<void> {
    this.relaunches += 1;
    this.actions.push("relaunch");
    this.reachable = true;
  }

  override async openConversation(): Promise<void> {
    this.actions.push("openConversation");
  }
}

function healthyObservation(): PlannerObservation {
  return {
    reachable: true,
    authenticated: true,
    conversationReachable: true,
    composerAvailable: true,
    generating: false
  };
}

function closedPage(): PlannerObservation {
  return {
    reachable: true,
    authenticated: true,
    conversationReachable: false,
    composerAvailable: true,
    generating: false
  };
}

function signedOut(): PlannerObservation {
  return {
    reachable: true,
    authenticated: false,
    conversationReachable: false,
    composerAvailable: false,
    generating: false
  };
}

function unreachable(): PlannerObservation {
  return {
    reachable: false,
    authenticated: false,
    conversationReachable: false,
    composerAvailable: false,
    generating: false
  };
}

describe("recoverChatGPT", () => {
  it("reconnects the browser transport after a CDP disconnect", async () => {
    const adapter = new ScriptedChatGPTAdapter(unreachable());
    const browser = new RecordingBrowserManager("external");

    const outcomePromise = recoverChatGPT({
      planner: makePair().planner,
      adapter,
      browser,
      sleep: noopSleep
    });
    adapter.setObservation(healthyObservation());
    const outcome = await outcomePromise;

    expect(outcome).toEqual({ recovered: true, action: "reconnect-transport" });
    expect(browser.counts().reconnect).toBeGreaterThan(0);
    expect(browser.counts().relaunch).toBe(0);
  });

  it("reopens a closed page conversation and re-probes until healthy", async () => {
    const adapter = new ScriptedChatGPTAdapter(closedPage());
    const browser = new RecordingBrowserManager("external");

    const outcomePromise = recoverChatGPT({
      planner: makePair().planner,
      adapter,
      browser,
      sleep: noopSleep
    });
    adapter.setObservation(healthyObservation());
    const outcome = await outcomePromise;

    expect(outcome).toEqual({ recovered: true, action: "reopen-conversation" });
    expect(browser.counts().openConversation).toBeGreaterThan(0);
    expect(browser.counts().relaunch).toBe(0);
    // The first probe must have observed the failed (closed) page before recovery.
    expect(adapter.probes[0]).toBe(1);
  });

  it("surfaces an auth failure as intervention without touching the browser", async () => {
    const adapter = new ScriptedChatGPTAdapter(signedOut());
    const browser = new RecordingBrowserManager("external");

    const outcome = await recoverChatGPT({
      planner: makePair().planner,
      adapter,
      browser,
      sleep: noopSleep
    });

    expect(outcome.recovered).toBe(false);
    if (!outcome.recovered) {
      expect(outcome.code).toBe("CHATGPT_AUTH_REQUIRED");
      expect(outcome.intervention).toBe(true);
    }
    expect(browser.counts().reconnect).toBe(0);
    expect(browser.counts().openConversation).toBe(0);
  });

  it("never relaunches an externally owned browser", async () => {
    const adapter = new ScriptedChatGPTAdapter(unreachable());
    const browser = new RecordingBrowserManager("external");

    const outcome = await recoverChatGPT({
      planner: makePair().planner,
      adapter,
      browser,
      sleep: noopSleep,
      maxProbes: 3
    });

    expect(outcome.recovered).toBe(false);
    if (!outcome.recovered) {
      expect(outcome.code).toBe("CHATGPT_CDP_UNREACHABLE");
    }
    expect(browser.counts().relaunch).toBe(0);
    expect(browser.actions.some((action) => action === "relaunch")).toBe(false);
  });

  it("relaunches a managed browser exactly once even while it stays unhealthy", async () => {
    const adapter = new ScriptedChatGPTAdapter(unreachable());
    const browser = new ManagedScriptedBrowser();

    const outcome = await recoverChatGPT({
      planner: makePair().planner,
      adapter,
      browser,
      sleep: noopSleep,
      maxProbes: 3
    });

    expect(outcome.recovered).toBe(false);
    if (!outcome.recovered) {
      expect(outcome.code).toBe("CHATGPT_CDP_UNREACHABLE");
    }
    expect(browser.relaunches).toBe(1);
    expect(browser.actions.filter((action) => action === "reconnect").length).toBeGreaterThan(0);
  });

  it("recovers through a managed relaunch", async () => {
    const adapter = new ScriptedChatGPTAdapter(unreachable());
    const browser = new ManagedScriptedBrowser();

    const outcomePromise = recoverChatGPT({
      planner: makePair().planner,
      adapter,
      browser,
      sleep: noopSleep
    });
    adapter.setObservation(healthyObservation());
    const outcome = await outcomePromise;

    expect(outcome.recovered).toBe(true);
    if (outcome.recovered) {
      expect(outcome.action).toBe("relaunch-browser");
    }
    expect(browser.relaunches).toBe(1);
  });
});

describe("browser managers", () => {
  it("external manager refuses to relaunch", async () => {
    const manager = new ExternalBrowserManager();
    await expect(manager.relaunch()).rejects.toThrow(/refusing/i);
    expect(manager.ownership).toBe("external");
  });

  it("managed manager starts, stops, and relaunches through the lens", async () => {
    let launched = 0;
    const lens: ManagedBrowserLens = {
      async launch(): Promise<ManagedBrowserHandle> {
        launched += 1;
        return {
          async stop() {}
        };
      }
    };
    const manager = new ManagedBrowserManager(lens);
    expect(manager.ownership).toBe("managed");

    await manager.start();
    expect(launched).toBe(1);
    await manager.reconnect();
    expect(launched).toBe(1);
    await manager.relaunch();
    expect(launched).toBe(2);
    await manager.stop();
    expect((await manager.status()).reachable).toBe(false);
  });

  it("derives ownership from config", () => {
    expect(browserManagerFor({ cdpUrl: "http://localhost:9222" }).ownership).toBe("external");
    expect(browserManagerFor(undefined).ownership).toBe("external");
    expect(
      browserManagerFor(undefined, { async launch() { return { async stop() {} }; } }).ownership
    ).toBe("managed");
  });
});

describe("FakeChatGPTBrowserAdapter observation", () => {
  it("reports planner health through observePlannerConversation", async () => {
    const adapter = new FakeChatGPTBrowserAdapter([{ id: "p1", source: "planner", role: "user", text: "go" }]);
    const observation = await adapter.observePlannerConversation(makePair().planner);
    expect(observation).toMatchObject({
      reachable: true,
      authenticated: true,
      conversationReachable: true,
      composerAvailable: true,
      generating: false,
      latestPlannerMessageId: "p1"
    });
  });
});