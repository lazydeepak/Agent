import { existsSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import type { FifoMutex } from "../../util/async.js";
import type {
  ChatGPTBrowserConfig,
  PlannerIdentity,
  PlannerObservation,
  ReadinessCheck,
  RelayReceipt,
  RelayableMessage
} from "../../types.js";
import { fail, pass } from "../../util/readiness.js";
import { SubmissionNotAttemptedError } from "../../relay/delivery-error.js";
import { plannerControlMessage } from "../../relay/chatgpt-gate.js";
import { hasVisibleServiceWarning } from "./service-warning.js";

export interface ChatGPTBrowserAdapter {
  checkReadiness(planner: PlannerIdentity): Promise<ReadinessCheck[]>;
  getLatestPlannerMessage(planner: PlannerIdentity): Promise<RelayableMessage | undefined>;
  sendWorkerMessage(planner: PlannerIdentity, message: RelayableMessage): Promise<RelayReceipt>;
  observePlannerConversation?(planner: PlannerIdentity): Promise<PlannerObservation>;
  subscribePlannerEvents?(planner: PlannerIdentity, signal: AbortSignal): AsyncIterable<PlannerSessionEvent>;
}

export interface PlannerSessionEvent {
  type: "planner.message.completed";
  observedAt: string;
  messageId?: string;
}

export class FakeChatGPTBrowserAdapter implements ChatGPTBrowserAdapter {
  readonly sentMessages: Array<{ planner: PlannerIdentity; message: RelayableMessage }> = [];

  constructor(private readonly plannerMessages: RelayableMessage[] = []) {}

  async checkReadiness(planner: PlannerIdentity): Promise<ReadinessCheck[]> {
    const overrides = planner.readiness ?? {};

    return [
      fakeCheck("planner.browserReachable", overrides, "ChatGPT browser target was reachable."),
      fakeCheck("planner.authenticated", overrides, "ChatGPT browser session is authenticated."),
      fakeCheck(
        "planner.conversationReachable",
        overrides,
        `ChatGPT conversation ${planner.conversationId} was reachable.`
      ),
      fakeCheck("planner.composerAvailable", overrides, "ChatGPT composer was available."),
      fakeCheck("planner.notGenerating", overrides, "ChatGPT conversation is not generating.")
    ];
  }

  async getLatestPlannerMessage(_planner: PlannerIdentity): Promise<RelayableMessage | undefined> {
    return this.plannerMessages.at(-1);
  }

  async sendWorkerMessage(planner: PlannerIdentity, message: RelayableMessage): Promise<RelayReceipt> {
    this.sentMessages.push({ planner, message });

    return {
      pairId: "",
      sourceMessageId: message.id,
      targetId: planner.conversationId,
      delivered: true,
      deliveredAt: new Date().toISOString(),
      transport: "fake-chatgpt-browser"
    };
  }

  async observePlannerConversation(planner: PlannerIdentity): Promise<PlannerObservation> {
    const overrides = planner.readiness ?? {};
    const latest = this.plannerMessages.at(-1);

    return {
      reachable: overrideEnabled(overrides, "planner.browserReachable"),
      authenticated: overrideEnabled(overrides, "planner.authenticated"),
      conversationReachable: overrideEnabled(overrides, "planner.conversationReachable"),
      composerAvailable: overrideEnabled(overrides, "planner.composerAvailable"),
      generating: !overrideEnabled(overrides, "planner.notGenerating"),
      latestPlannerMessageId: latest?.id,
      latestPlannerControl: latest ? plannerControlMessage(latest.text) : undefined,
      latestPlannerMessageCreatedAt: latest?.createdAt,
      detail: []
    };
  }

}

export interface ChatGPTReadinessSnapshot {
  browserReachable: boolean;
  authenticated: boolean;
  conversationReachable: boolean;
  composerAvailable: boolean;
  notGenerating: boolean;
  url?: string;
  reason?: string;
}

export interface ChatGPTReadinessProbe {
  snapshot(planner: PlannerIdentity): Promise<ChatGPTReadinessSnapshot>;
}

export interface ChatGPTBrowserDriver extends ChatGPTReadinessProbe {
  latestPlannerMessage(planner: PlannerIdentity): Promise<RelayableMessage | undefined>;
  sendMessage(planner: PlannerIdentity, message: RelayableMessage): Promise<void>;
  observe?(planner: PlannerIdentity): Promise<{
    snapshot: ChatGPTReadinessSnapshot;
    latest: RelayableMessage | undefined;
  }>;
  subscribeEvents?(planner: PlannerIdentity, signal: AbortSignal): AsyncIterable<PlannerSessionEvent>;
}

export interface LiveChatGPTBrowserOptions extends ChatGPTBrowserConfig {
  probe?: ChatGPTReadinessProbe;
  driver?: ChatGPTBrowserDriver;
  lock?: FifoMutex;
}

export const DEFAULT_CHATGPT_RATE_LIMIT_BACKOFF_MS = 5 * 60_000;

export class LiveChatGPTBrowserAdapter implements ChatGPTBrowserAdapter {
  private readonly driver: ChatGPTBrowserDriver;
  private readonly lock?: FifoMutex;

  constructor(options: LiveChatGPTBrowserOptions = {}) {
    this.driver = options.driver ?? driverFromProbe(options.probe) ?? new PlaywrightChatGPTBrowserDriver(options);
    this.lock = options.lock;
  }

  async checkReadiness(planner: PlannerIdentity): Promise<ReadinessCheck[]> {
    return this.locked(() => this.driver.snapshot(planner)).then(
      (snapshot) => buildReadinessChecks(planner, snapshot),
      (error) => {
        const reason = error instanceof Error ? error.message : String(error);
        return [
          fail("planner.browserReachable", `ChatGPT browser was not reachable: ${reason}`),
          fail("planner.authenticated", "ChatGPT authentication could not be checked."),
          fail("planner.conversationReachable", "ChatGPT conversation could not be checked."),
          fail("planner.composerAvailable", "ChatGPT composer could not be checked."),
          fail("planner.notGenerating", "ChatGPT generation state could not be checked.")
        ];
      }
    );
  }

  async getLatestPlannerMessage(planner: PlannerIdentity): Promise<RelayableMessage | undefined> {
    return this.locked(() => this.driver.latestPlannerMessage(planner));
  }

  async sendWorkerMessage(planner: PlannerIdentity, message: RelayableMessage): Promise<RelayReceipt> {
    await this.locked(() => this.driver.sendMessage(planner, message));

    return {
      pairId: "",
      sourceMessageId: message.id,
      targetId: planner.conversationId,
      delivered: true,
      deliveredAt: new Date().toISOString(),
      transport: "chatgpt-browser"
    };
  }

  async observePlannerConversation(planner: PlannerIdentity): Promise<PlannerObservation> {
    const detail: string[] = [];

    if (this.driver.observe) {
      try {
        const observation = await this.locked(() => this.driver.observe!(planner));
        return observationFromSnapshot(observation.snapshot, observation.latest, detail);
      } catch (error) {
        detail.push(`snapshot: ${readableError(error)}`);
        return unreachablePlannerObservation(detail, error);
      }
    }

    let snapshot: ChatGPTReadinessSnapshot;
    try {
      snapshot = await this.locked(() => this.driver.snapshot(planner));
    } catch (error) {
      detail.push(`snapshot: ${readableError(error)}`);
      return unreachablePlannerObservation(detail, error);
    }

    let latest: RelayableMessage | undefined;
    try {
      latest = await this.locked(() => this.driver.latestPlannerMessage(planner));
    } catch (error) {
      detail.push(`latest: ${readableError(error)}`);
      if (error instanceof ChatGPTTemporaryLimitError) return unreachablePlannerObservation(detail, error);
    }

    return observationFromSnapshot(snapshot, latest, detail);
  }

  subscribePlannerEvents(planner: PlannerIdentity, signal: AbortSignal): AsyncIterable<PlannerSessionEvent> {
    return this.driver.subscribeEvents?.(planner, signal) ?? emptyPlannerEvents();
  }

  private async locked<T>(task: () => Promise<T>): Promise<T> {
    if (!this.lock) {
      return task();
    }
    return this.lock.run(task);
  }
}

export class PlaywrightChatGPTBrowserDriver implements ChatGPTBrowserDriver {
  private readonly options: ChatGPTBrowserConfig;
  private cdpBrowser: Browser | undefined;
  private cdpConnection: Promise<Browser> | undefined;
  private cdpPage: Page | undefined;
  private readonly rateLimitedUntil = new Map<string, number>();
  private observerSequence = 0;

  constructor(options: ChatGPTBrowserConfig) {
    this.options = options;
  }

  async dispose(): Promise<void> {
    const page = this.cdpPage;
    const browser = this.cdpBrowser;
    this.cdpPage = undefined;
    this.cdpBrowser = undefined;
    this.cdpConnection = undefined;
    try {
      await page?.close();
    } catch {
      // Page may already be closed or disconnected
    }
    try {
      await browser?.close();
    } catch {
      // Browser may already be closed or disconnected
    }
  }

  async snapshot(planner: PlannerIdentity): Promise<ChatGPTReadinessSnapshot> {
    return this.withPage(planner, (page) => snapshotFromPage(page, planner));
  }

  async latestPlannerMessage(planner: PlannerIdentity): Promise<RelayableMessage | undefined> {
    return this.withPage(planner, async (page) => extractLatestAssistantMessage(page, planner));
  }

  async observe(planner: PlannerIdentity): Promise<{
    snapshot: ChatGPTReadinessSnapshot;
    latest: RelayableMessage | undefined;
  }> {
    return this.withPage(planner, async (page) => {
      const snapshot = await snapshotFromPage(page, planner);
      const latest = snapshot.notGenerating ? await extractLatestAssistantMessage(page, planner) : undefined;
      return { snapshot, latest };
    });
  }

  async sendMessage(planner: PlannerIdentity, message: RelayableMessage): Promise<void> {
    let submissionAttempted = false;
    // Retry configuration for ChatGPT UI dynamism (transient UI issues)
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second base delay (exponential backoff: 1s, 2s, 4s)
    try {
      await this.withPage(planner, async (page) => {
        const composer = await findComposer(page);
        if (!composer) {
          throw new Error("ChatGPT composer was not available.");
        }

        // Retry loop for composer availability (ChatGPT UI is dynamic)
        for (let retry = 0; retry <= maxRetries; retry++) {
          try {
            if (retry > 0) {
              // Exponential backoff: 1s, 2s, 4s
              const delay = baseDelay * Math.pow(2, retry - 1);
              await page.waitForTimeout(delay);
            }
            await composer.click({ timeout: timeoutFor(planner, this.options) });
            await composer.fill(message.text, { timeout: timeoutFor(planner, this.options) });
            await page.waitForTimeout(250);
            break; // success, exit retry loop
          } catch (error) {
            if (retry === maxRetries) {
              throw error;
            }
          }
        }

        const sendButton = await findSendButton(page);
        const userCount = await page.locator('[data-message-author-role="user"]').count();
        const assistantCount = await page.locator('[data-message-author-role="assistant"]').count();
        submissionAttempted = true;
        if (sendButton) {
          await sendButton.click({ timeout: timeoutFor(planner, this.options) });
        } else {
          await composer.press("Enter", { timeout: timeoutFor(planner, this.options) });
        }
        // Require a new matching user turn AND evidence that generation began.
        // A click or an optimistic user bubble alone is not acceptance evidence.
        await page.waitForFunction(`({ userCount, assistantCount, text }) => {
          const users = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
          const latest = users.at(-1);
          const normalize = (value) => value.replaceAll(String.fromCharCode(96), "").replace(/\\s+/g, " ").trim();
          const content = latest?.querySelector?.('[data-testid="collapsible-user-message-content"]') ?? latest?.querySelector?.('.whitespace-pre-wrap') ?? latest;
          const generating = Array.from(document.querySelectorAll('button')).some((button) =>
            (button.dataset.testid === "stop-button" || /stop/i.test(button.getAttribute("aria-label") ?? "")) &&
            button.getClientRects().length > 0
          );
          if (!(users.length > userCount) || !latest) return false;
          const bubble = normalize(content.textContent ?? "");
          const sent = normalize(text ?? "");
          if (!bubble || !sent) return false;
          return (
            // Accept when rendered bubble and sent text are prefix-compatible either way.
            // ChatGPT truncates long input in the user turn bubble, so the bubble may be
            // a prefix of the original text.  Normal-length messages match exactly.
            (bubble.startsWith(sent) || sent.startsWith(bubble)) &&
            (generating || document.querySelectorAll('[data-message-author-role="assistant"]').length > assistantCount)
          );
        }`, { userCount, assistantCount, text: message.text }, { timeout: timeoutFor(planner, this.options) });
      });
    } catch (error) {
      if (!submissionAttempted) {
        throw new SubmissionNotAttemptedError(readableError(error), { cause: error });
      }
      throw error;
    }
  }

  async *subscribeEvents(planner: PlannerIdentity, signal: AbortSignal): AsyncIterable<PlannerSessionEvent> {
    const session = await this.openPage(planner);
    const page = session.page;
    const binding = `__agentRelayPlannerWake${++this.observerSequence}`;
    const observerKey = `${binding}Observer`;
    let pendingMessageId: string | undefined;
    let resolveWake: (() => void) | undefined;
    try {
      await this.preparePage(planner, page);
      await page.exposeFunction(binding, (messageId?: string) => {
        pendingMessageId = messageId;
        resolveWake?.();
      });
    } catch (error) {
      await session.cleanup();
      throw error;
    }
    const observerScript = `(() => {
      const binding = ${JSON.stringify(binding)};
      const observerKey = ${JSON.stringify(observerKey)};
      const previous = window[observerKey];
      if (previous) previous.disconnect();
      const completedMessageId = function () {
        const generating = Array.from(document.querySelectorAll('button')).some(function (node) {
          return /stop/i.test(node.getAttribute('aria-label') || '') && node.offsetParent !== null;
        });
        if (generating) return undefined;
        const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
        const node = nodes[nodes.length - 1];
        if (!node || !node.innerText.trim()) return undefined;
        return node.getAttribute('data-message-id') || 'assistant-' + (nodes.length - 1) + '-' + node.innerText.length;
      };
      let lastId = completedMessageId();
      const observer = new MutationObserver(function () {
        const nextId = completedMessageId();
        if (!nextId || nextId === lastId) return;
        lastId = nextId;
        if (typeof window[binding] === 'function') window[binding](nextId);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      window[observerKey] = observer;
    })()`;
    const installObserver = () => page.evaluate(observerScript).then(() => undefined);
    const reinstallObserver = () => {
      void installObserver().catch(() => undefined);
    };
    page.on("domcontentloaded", reinstallObserver);
    await installObserver();

    try {
      while (!signal.aborted) {
        if (!pendingMessageId) {
          await new Promise<void>((resolve) => {
            const onAbort = () => resolve();
            resolveWake = () => {
              signal.removeEventListener("abort", onAbort);
              resolve();
            };
            signal.addEventListener("abort", onAbort, { once: true });
          });
        }
        if (signal.aborted) break;
        const messageId = pendingMessageId;
        pendingMessageId = undefined;
        yield { type: "planner.message.completed", observedAt: new Date().toISOString(), messageId };
      }
    } finally {
      resolveWake = undefined;
      page.off("domcontentloaded", reinstallObserver);
      await page.evaluate((key) => {
        const host = window as unknown as Record<string, unknown>;
        (host[key] as MutationObserver | undefined)?.disconnect();
        delete host[key];
      }, observerKey).catch(() => undefined);
      await session.cleanup();
    }
  }

  private async withPage<T>(planner: PlannerIdentity, action: (page: Page) => Promise<T>): Promise<T> {
    const session = await this.openPage(planner);
    try {
      const page = session.page;
      await this.preparePage(planner, page);
      return await action(page);
    } finally {
      await session.cleanup();
    }
  }

  private async preparePage(planner: PlannerIdentity, page: Page): Promise<void> {
    const now = Date.now();
    const limitedUntil = this.rateLimitedUntil.get(planner.conversationId);
    if (limitedUntil && now < limitedUntil) {
      throw new ChatGPTTemporaryLimitError(limitedUntil);
    }

    const recoveringFromLimit = limitedUntil !== undefined;
    if (recoveringFromLimit || shouldNavigatePlannerPage(page.url(), planner.conversationId)) {
      this.rateLimitedUntil.delete(planner.conversationId);
      await page.goto(planner.conversationUrl, {
        waitUntil: "domcontentloaded",
        timeout: timeoutFor(planner, this.options)
      });
      await page.waitForLoadState("networkidle", { timeout: timeoutFor(planner, this.options) }).catch(() => {});
    }

    if (await hasTemporaryRateLimitWarning(page)) {
      const retryAt = Date.now() + DEFAULT_CHATGPT_RATE_LIMIT_BACKOFF_MS;
      this.rateLimitedUntil.set(planner.conversationId, retryAt);
      throw new ChatGPTTemporaryLimitError(retryAt);
    }
  }

  private async openPage(planner: PlannerIdentity): Promise<{
    page: Page;
    cleanup: () => Promise<void>;
  }> {
    const config = { ...planner.browser, ...this.options };

    if (config.cdpUrl) {
      const browser = await this.connectCdp(config.cdpUrl, timeoutFor(planner, this.options));
      if (this.cdpPage && this.cdpPage.isClosed() === false) {
        return {
          page: this.cdpPage,
          cleanup: async () => {}
        };
      }
      const context = browser.contexts()[0] ?? (await browser.newContext());
      this.cdpPage =
        context.pages().find((page) => conversationMatches(page.url(), planner.conversationId)) ??
        (await context.newPage());
      return {
        page: this.cdpPage,
        cleanup: async () => {
          // Keep the CDP connection and page persistent for the life of this
          // adapter so repeated observations reuse an already-open conversation
          // instead of launching a fresh page and reloading it every poll cycle.
        }
      };
    }

    const executablePath = config.executablePath ?? defaultBrowserPath();
    if (!executablePath) {
      throw new Error("ChatGPT browser executablePath or cdpUrl is required.");
    }

    const { chromium } = await import("playwright-core");
    const userDataDir = config.userDataDir ?? join(tmpdir(), "agent-relay-chatgpt-profile");
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: config.headless ?? false,
      timeout: timeoutFor(planner, this.options)
    });
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      page,
      cleanup: async () => {
        await context.close();
      }
    };
  }

  private async connectCdp(cdpUrl: string, timeout: number): Promise<Browser> {
    if (this.cdpBrowser?.isConnected()) return this.cdpBrowser;
    if (this.cdpConnection) return this.cdpConnection;
    this.cdpConnection = (async () => {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.connectOverCDP(cdpUrl, { timeout });
      this.cdpBrowser = browser;
      browser.once("disconnected", () => {
        if (this.cdpBrowser === browser) this.cdpBrowser = undefined;
      });
      return browser;
    })();
    try {
      return await this.cdpConnection;
    } finally {
      this.cdpConnection = undefined;
    }
  }
}

async function* emptyPlannerEvents(): AsyncIterable<PlannerSessionEvent> {
  return;
}

export function shouldNavigatePlannerPage(currentUrl: string, conversationId: string): boolean {
  return !conversationMatches(currentUrl, conversationId);
}

export class ChatGPTTemporaryLimitError extends Error {
  constructor(readonly retryAt: number) {
    super(`ChatGPT temporarily limited conversation access; retry after ${new Date(retryAt).toISOString()}.`);
    this.name = "ChatGPTTemporaryLimitError";
  }
}

function driverFromProbe(probe: ChatGPTReadinessProbe | undefined): ChatGPTBrowserDriver | undefined {
  if (!probe) {
    return undefined;
  }

  return {
    snapshot: (planner) => probe.snapshot(planner),
    async latestPlannerMessage() {
      return undefined;
    },
    async sendMessage() {
      throw new Error("Live ChatGPT message read/send requires a ChatGPT browser driver.");
    }
  };
}

function buildReadinessChecks(
  planner: PlannerIdentity,
  snapshot: ChatGPTReadinessSnapshot
): ReadinessCheck[] {
  return [
    snapshot.browserReachable
      ? pass("planner.browserReachable", "ChatGPT browser target was reachable.")
      : fail("planner.browserReachable", snapshot.reason ?? "ChatGPT browser target was not reachable."),
    snapshot.authenticated
      ? pass("planner.authenticated", "ChatGPT browser session appears authenticated.")
      : fail("planner.authenticated", "ChatGPT browser session appears signed out."),
    snapshot.conversationReachable
      ? pass("planner.conversationReachable", `ChatGPT conversation ${planner.conversationId} was reachable.`)
      : fail("planner.conversationReachable", `ChatGPT conversation ${planner.conversationId} was not reachable.`),
    snapshot.composerAvailable
      ? pass("planner.composerAvailable", "ChatGPT composer was available.")
      : fail("planner.composerAvailable", "ChatGPT composer was not available."),
    snapshot.notGenerating
      ? pass("planner.notGenerating", "ChatGPT conversation is not generating.")
      : fail("planner.notGenerating", "ChatGPT conversation appears to be generating.")
  ];
}

function fakeCheck(
  name: string,
  overrides: Record<string, boolean | string>,
  successReason: string
): ReadinessCheck {
  const override = overrides[name];

  if (override === undefined || override === true) {
    return pass(name, successReason);
  }

  return fail(name, typeof override === "string" ? override : `${name} failed in fake adapter.`);
}

function overrideEnabled(overrides: Record<string, boolean | string>, name: string): boolean {
  const override = overrides[name];
  return override === undefined || override === true;
}


function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function isAuthenticated(page: Page, url: string): Promise<boolean> {
  if (url.includes("/auth/login") || url.includes("/auth/signup")) {
    return false;
  }

  const signedOutControls = page.locator(
    'a[href*="/auth/login"], a[href*="/auth/signup"], button:has-text("Log in"), button:has-text("Sign up")'
  );
  const signedOutText = page.getByText(/^(Log in|Sign up)$/i);
  return (await signedOutControls.count()) === 0 && (await signedOutText.count()) === 0;
}

async function snapshotFromPage(page: Page, planner: PlannerIdentity): Promise<ChatGPTReadinessSnapshot> {
  const url = page.url();
  const authenticated = await isAuthenticated(page, url);
  const conversationReachable =
    authenticated && conversationMatches(url, planner.conversationId) && !(await hasConversationError(page));
  const composerAvailable = authenticated && (await hasComposer(page));
  const notGenerating = authenticated && !(await isGenerating(page));
  return { browserReachable: true, authenticated, conversationReachable, composerAvailable, notGenerating, url };
}

function observationFromSnapshot(
  snapshot: ChatGPTReadinessSnapshot,
  latest: RelayableMessage | undefined,
  detail: string[]
): PlannerObservation {
  return {
    reachable: snapshot.browserReachable,
    authenticated: snapshot.authenticated,
    conversationReachable: snapshot.conversationReachable,
    composerAvailable: snapshot.composerAvailable,
    generating: !snapshot.notGenerating,
    latestPlannerMessageId: latest?.id,
    latestPlannerControl: latest ? plannerControlMessage(latest.text) : undefined,
    latestPlannerMessageCreatedAt: latest?.createdAt,
    detail
  };
}

function unreachablePlannerObservation(detail: string[], error?: unknown): PlannerObservation {
  return {
    ...(error instanceof ChatGPTTemporaryLimitError ? { rateLimitedUntil: error.retryAt } : {}),
    reachable: false,
    authenticated: false,
    conversationReachable: false,
    composerAvailable: false,
    generating: false,
    detail
  };
}

function conversationMatches(url: string, conversationId: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).join("/").includes(`c/${conversationId}`);
  } catch {
    return false;
  }
}

async function hasComposer(page: Page): Promise<boolean> {
  return (await findComposer(page)) !== undefined;
}

async function findComposer(page: Page) {
  const selectors = [
    '[data-testid="prompt-textarea"]',
    '#prompt-textarea',
    'textarea[placeholder*="Message"]',
    'div[contenteditable="true"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (
      (await locator.count()) > 0 &&
      (await locator.isVisible().catch(() => false)) &&
      (await locator.isEnabled().catch(() => false))
    ) {
      return locator;
    }
  }

  return undefined;
}

async function findSendButton(page: Page) {
  const selectors = [
    '[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }

  return undefined;
}

async function hasConversationError(page: Page): Promise<boolean> {
  return hasVisibleServiceWarning(page,
    /conversation not found|unable to load conversation|something went wrong|you do not have access/i
  );
}

async function hasTemporaryRateLimitWarning(page: Page): Promise<boolean> {
  return hasVisibleServiceWarning(page, /temporary rate limit|rate limit.*try again|\bhit\b[^.!?\n]*\blimit\b|slow down|try again in/i);
}

async function isGenerating(page: Page): Promise<boolean> {
  const selectors = [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return true;
    }
  }

  return false;
}

async function extractLatestAssistantMessage(
  page: Page,
  planner: PlannerIdentity
): Promise<RelayableMessage | undefined> {
  const messageNodes = page.locator('[data-message-author-role="assistant"]');
  const count = await messageNodes.count();

  for (let index = count - 1; index >= 0; index -= 1) {
    const node = messageNodes.nth(index);
    if (!(await node.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeMessageText(await node.innerText().catch(() => ""));
    if (!text) {
      continue;
    }

    const domId = await node.getAttribute("data-message-id").catch(() => undefined);
    return {
      id: domId ?? `chatgpt-assistant-${planner.conversationId}-${index}`,
      source: "planner",
      role: "assistant",
      text,
      createdAt: Date.now()
    };
  }

  return undefined;
}

function normalizeMessageText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function timeoutFor(planner: PlannerIdentity, options: ChatGPTBrowserConfig): number {
  return options.timeoutMs ?? planner.browser?.timeoutMs ?? 15_000;
}

function defaultBrowserPath(): string | undefined {
  const candidates = defaultBrowserPathCandidates();
  return candidates.find((path) => existsSync(path));
}

function defaultBrowserPathCandidates(): string[] {
  if (platform() === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }

  if (platform() === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ];
  }

  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}
