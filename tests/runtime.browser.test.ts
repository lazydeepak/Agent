import { describe, expect, it } from "vitest";
import { LiveChatGPTBrowserAdapter } from "../src/adapters/chatgpt/index.js";
import type { ChatGPTBrowserDriver, ChatGPTReadinessSnapshot } from "../src/adapters/chatgpt/index.js";
import { LockRegistry } from "../src/runtime/scheduler.js";
import type { PlannerIdentity, RelayableMessage } from "../src/types.js";

const actualConversationUrl = "https://chatgpt.com/c/planner-conversation-1";
const otherConversationUrl = "https://chatgpt.com/c/planner-conversation-2";

const plannerFor = (overrides: Partial<PlannerIdentity> = {}): PlannerIdentity => ({
  type: "chatgpt-browser",
  conversationId: "planner-conversation-1",
  conversationUrl: actualConversationUrl,
  ...overrides
});

describe("shared browser lock", () => {
  it("serializes browser operations across pairs sharing one CDP target", async () => {
    const driver = new ScriptedBrowserDriver();
    const locks = new LockRegistry();
    const lock = locks.lockFor("cdp:http://127.0.0.1:9222");

    const adapterA = new LiveChatGPTBrowserAdapter({ cdpUrl: "http://127.0.0.1:9222", driver, lock });
    const adapterB = new LiveChatGPTBrowserAdapter({ cdpUrl: "http://127.0.0.1:9222", driver, lock });
    const plannerA = plannerFor();
    const plannerB = plannerFor({ conversationId: "planner-conversation-2", conversationUrl: otherConversationUrl });

    const tasks: Promise<unknown>[] = [];
    for (let index = 0; index < 10; index += 1) {
      tasks.push(adapterA.checkReadiness(plannerA));
      tasks.push(adapterB.checkReadiness(plannerB));
      tasks.push(adapterA.sendWorkerMessage(plannerA, message(`a-${index}`)));
      tasks.push(adapterB.sendWorkerMessage(plannerB, message(`b-${index}`)));
      tasks.push(adapterA.getLatestPlannerMessage(plannerA));
      tasks.push(adapterB.observePlannerConversation(plannerB));
    }

    await Promise.all(tasks);

    expect(driver.maxActive()).toBe(1);
    expect(driver.opCount()).toBe(70);
    expect(new Set(driver.navigatedUrls())).toEqual(new Set([actualConversationUrl, otherConversationUrl]));
  });

  it("never makes one adapter wait forever behind a busy lock", async () => {
    const driver = new ScriptedBrowserDriver(1);
    const lock = new LockRegistry().lockFor("profile:shared-temp-profile");
    const adapterA = new LiveChatGPTBrowserAdapter({ userDataDir: "/tmp/shared-profile", driver, lock });
    const adapterB = new LiveChatGPTBrowserAdapter({ userDataDir: "/tmp/shared-profile", driver, lock });
    const plannerA = plannerFor();
    const plannerB = plannerFor({ conversationId: "planner-conversation-2", conversationUrl: otherConversationUrl });

    const pending: Array<{ startedAt: string }> = [];
    const tasks = Array.from({ length: 20 }, async (_, index) => {
      const adapter = index % 2 === 0 ? adapterA : adapterB;
      const planner = index % 2 === 0 ? plannerA : plannerB;
      pending.push({ startedAt: new Date().toISOString() });
      await adapter.checkReadiness(planner);
    });

    await Promise.all(tasks);
    expect(driver.createdOrder().length).toBe(20);
    expect(driver.createdOrder()[0]).toBe("readiness-0");
  });

  it("keeps navigation scoped to the pair's own conversation", async () => {
    const driver = new ScriptedBrowserDriver();
    const lock = new LockRegistry().lockFor("cdp:http://127.0.0.1:9222");
    const adapter = new LiveChatGPTBrowserAdapter({ cdpUrl: "http://127.0.0.1:9222", driver, lock });

    await adapter.checkReadiness(plannerFor());
    await adapter.checkReadiness(plannerFor({ conversationId: "planner-conversation-2", conversationUrl: otherConversationUrl }));

    expect(driver.navigatedUrls()).toEqual([actualConversationUrl, otherConversationUrl]);
    expect(driver.navigatedUrls()).not.toContain("https://chatgpt.com/c/unrelated-conversation");
  });

  it("flags a conversation mismatch as planner failure for that pair only", async () => {
    const driver = new ScriptedBrowserDriver();
    const lock = new LockRegistry().lockFor("cdp:http://127.0.0.1:9222");

    const adapterA = new LiveChatGPTBrowserAdapter({ cdpUrl: "http://127.0.0.1:9222", driver, lock });
    const adapterB = new LiveChatGPTBrowserAdapter({ cdpUrl: "http://127.0.0.1:9222", driver, lock });
    driveMismatchedConversation(driver, "planner-conversation-1");

    const checksA = await adapterA.checkReadiness(plannerFor());
    const checksB = await adapterB.checkReadiness(
      plannerFor({ conversationId: "planner-conversation-2", conversationUrl: otherConversationUrl })
    );

    const conversationCheckA = checksA.find((check) => check.name === "planner.conversationReachable");
    const conversationCheckB = checksB.find((check) => check.name === "planner.conversationReachable");
    expect(conversationCheckA?.status).toBe("FAIL");
    expect(conversationCheckB?.status).toBe("PASS");

    const observationA = await adapterA.observePlannerConversation(plannerFor());
    expect(observationA.conversationReachable).toBe(false);
  });
});

function message(id: string): RelayableMessage {
  return { id, source: "worker", role: "assistant", text: "Build slice", createdAt: 1_000 };
}

function driveMismatchedConversation(driver: ScriptedBrowserDriver, conversationId: string): void {
  driver.mismatchConversation(conversationId);
}

class ScriptedBrowserDriver implements ChatGPTBrowserDriver {
  private readonly navigationStack: string[] = [];
  private readonly order: string[] = [];
  private previousUrl: string | undefined;
  private totalOps = 0;
  private maxOverlap = 0;
  private overlapping = 0;
  private readonly mismatched = new Set<string>();

  constructor(private readonly delayMs = 0) {}

  mismatchConversation(conversationId: string): void {
    this.mismatched.add(conversationId);
  }

  async snapshot(planner: PlannerIdentity): Promise<ChatGPTReadinessSnapshot> {
    return this.measure(planner, (url) => ({
      browserReachable: true,
      authenticated: true,
      conversationReachable: url.includes(planner.conversationId) && !this.mismatched.has(planner.conversationId),
      composerAvailable: true,
      notGenerating: true,
      url
    }));
  }

  async latestPlannerMessage(planner: PlannerIdentity): Promise<RelayableMessage | undefined> {
    await this.enter(planner, "latest");
    try {
      await pause(this.delayMs);
      return undefined;
    } finally {
      this.exit();
    }
  }

  async sendMessage(planner: PlannerIdentity, message: RelayableMessage): Promise<void> {
    await this.enter(planner, "send");
    try {
      await pause(this.delayMs);
    } finally {
      this.exit();
    }
  }

  navigatedUrls(): string[] {
    return [...this.navigationStack];
  }

  opCount(): number {
    return this.totalOps;
  }

  maxActive(): number {
    return this.maxOverlap;
  }

  createdOrder(): string[] {
    return [...this.order];
  }

  private async measure<T>(planner: PlannerIdentity, map: (url: string) => T): Promise<T> {
    const url = await this.enter(planner, "readiness");
    try {
      await pause(this.delayMs);
      return map(url);
    } finally {
      this.exit();
    }
  }

  private async enter(planner: PlannerIdentity, operation: string): Promise<string> {
    this.totalOps += 1;
    this.overlapping += 1;
    this.maxOverlap = Math.max(this.maxOverlap, this.overlapping);
    this.order.push(`${operation}-${this.totalOps - 1}`);
    const url = planner.conversationUrl;
    if (this.previousUrl !== url) {
      this.navigationStack.push(url);
      this.previousUrl = url;
    }
    return url;
  }

  private exit(): void {
    this.overlapping -= 1;
  }
}

function pause(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
