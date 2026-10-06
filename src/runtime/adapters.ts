import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChatGPTBrowserAdapter, LiveChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import type { ChatGPTBrowserAdapter } from "../adapters/chatgpt/index.js";
import {
  HttpOpenCodeEventSource,
  LiveOpenCodeAdapter,
  StaticOpenCodeAdapter
} from "../adapters/opencode/index.js";
import type { OpenCodeEventSource, OpenCodeSessionManager } from "../adapters/opencode/index.js";
import type { LockRegistry } from "./scheduler.js";
import type { ChatGPTBrowserConfig, OpenCodeServerConfig, SessionPair } from "../types.js";

export interface RuntimeAdapterOptions {
  opencode?: OpenCodeServerConfig;
  chatgpt?: ChatGPTBrowserConfig;
  liveOpenCode?: boolean;
  liveChatGPT?: boolean;
  browserLocks?: LockRegistry;
}

export interface PairAdapters {
  worker: OpenCodeSessionManager;
  planner: ChatGPTBrowserAdapter;
  workerEvents?: OpenCodeEventSource;
}

export function createPairAdapters(pair: SessionPair, options: RuntimeAdapterOptions = {}): PairAdapters {
  // Endpoints come from persisted pair configuration or operator-supplied runtime options.
  const openCodeOptions = { ...pair.worker.server, ...options.opencode, allowInsecureAuth: true };
  const liveOpenCode = shouldUseLiveOpenCode(options, pair);
  const worker = liveOpenCode ? new LiveOpenCodeAdapter(openCodeOptions) : new StaticOpenCodeAdapter();
  const eventBaseUrl = openCodeOptions.baseUrl ?? process.env.AGENT_RELAY_OPENCODE_BASE_URL;
  const workerEvents =
    liveOpenCode && eventBaseUrl && openCodeOptions.apiProtocol !== "legacy"
      ? new HttpOpenCodeEventSource({ ...openCodeOptions, baseUrl: eventBaseUrl })
      : undefined;

  let planner: ChatGPTBrowserAdapter;
  if (shouldUseLiveChatGPT(options, pair)) {
    const lock = options.browserLocks?.lockFor(browserLockKey(pair));
    planner = new LiveChatGPTBrowserAdapter({ ...pair.planner.browser, ...options.chatgpt, lock });
  } else {
    planner = new FakeChatGPTBrowserAdapter();
  }

  return { worker, planner, workerEvents };
}

export function browserLockKey(pair: SessionPair): string {
  const browser = pair.planner.browser;
  if (browser?.cdpUrl) {
    // Normalize so `…:9222` and `…:9222/` share the same FIFO lock.
    return `cdp:${browser.cdpUrl.replace(/\/+$/, "")}`;
  }
  if (browser?.userDataDir) {
    return `profile:${browser.userDataDir}`;
  }
  if (browser?.executablePath) {
    return `profile:${join(tmpdir(), "agent-relay-chatgpt-profile")}`;
  }
  return "none";
}

function shouldUseLiveOpenCode(options: RuntimeAdapterOptions, pair: SessionPair): boolean {
  return options.liveOpenCode || Boolean(options.opencode?.baseUrl) || Boolean(pair.worker.server?.baseUrl);
}

function shouldUseLiveChatGPT(options: RuntimeAdapterOptions, pair: SessionPair): boolean {
  return options.liveChatGPT || hasChatGPTBrowserConfig(options.chatgpt) || hasChatGPTBrowserConfig(pair.planner.browser);
}

function hasChatGPTBrowserConfig(config?: ChatGPTBrowserConfig): boolean {
  return Boolean(config?.cdpUrl ?? config?.executablePath ?? config?.userDataDir);
}
