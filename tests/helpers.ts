import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashText } from "../src/persistence/canonical.js";
import { StaticOpenCodeAdapter, type OpenCodeSessionManager } from "../src/adapters/opencode/index.js";
import type { BrowserManager, BrowserStatus } from "../src/recovery/index.js";
import type {
  BrowserOwnership,
  RelayableMessage,
  WorkerIdentity,
  WorkerObservation
} from "../src/types.js";
import type { SessionPair } from "../src/types.js";
import { DesktopApplicationService, type DesktopServiceOptions } from "../src/application/desktop-service.js";
import { RelayEngine } from "../src/application/relay-engine.js";
import { RuntimeOrchestrator } from "../src/runtime/index.js";
import { SqliteRelayStore, type RelayStore } from "../src/persistence/index.js";

export function makePair(overrides: Partial<SessionPair> = {}): SessionPair {
  return {
    pairId: "kisab-main",
    enabled: true,
    worker: {
      type: "opencode",
      sessionId: "ses_worker_1",
      repoPath: "/Users/lazydeepak/dev/kisab"
    },
    planner: {
      type: "chatgpt-browser",
      conversationId: "planner-conversation-1",
      conversationUrl: "https://chatgpt.com/c/planner-conversation-1"
    },
    ...overrides
  };
}

export class ControllableWorker extends StaticOpenCodeAdapter implements OpenCodeSessionManager {
  reachable = true;
  sessionExists = true;
  sessionActive: boolean | undefined;
  reportedRepoPath: string | undefined;
  private script: RelayableMessage[];
  private healthFails = 0;

  constructor(messages: RelayableMessage[] = [], private readonly expectedRepoPath = "/Users/lazydeepak/dev/kisab") {
    super(messages);
    this.script = messages;
  }

  setMessages(messages: RelayableMessage[]): void {
    this.script = messages;
  }

  setUnreachable(): void {
    this.reachable = false;
  }

  setSessionMissing(): void {
    this.sessionExists = false;
  }

  /** Force the "actively generating" observation independent of session existence. */
  setSessionActive(active: boolean): void {
    this.sessionActive = active;
  }

  setRepoMismatch(): void {
    this.reportedRepoPath = "/Users/lazydeepak/dev/other-repo";
  }

  /** Fails health checks for the next `count` calls, then recovers. */
  failHealthNext(count: number): void {
    this.healthFails = count;
  }

  override async checkServer(): Promise<unknown> {
    if (!this.reachable) {
      throw new Error("OpenCode server unreachable (test).");
    }
    if (this.healthFails > 0) {
      this.healthFails -= 1;
      throw new Error("OpenCode server not ready (test).");
    }
    return { ok: true };
  }

  override async getSession(sessionId: string) {
    if (!this.reachable) {
      throw new Error("OpenCode server unreachable (test).");
    }
    if (!this.sessionExists) {
      return undefined;
    }
    return {
      sessionId,
      repoPath: this.reportedRepoPath ?? this.expectedRepoPath
    };
  }

  override async observeWorkerSession(worker: WorkerIdentity): Promise<WorkerObservation> {
    if (!this.reachable) {
      throw new Error("OpenCode server unreachable (test).");
    }
    const latest = this.script.at(-1);
    const assistant = [...this.script].reverse().find((message) => message.role === "assistant");

    return {
      reachable: true,
      sessionExists: this.sessionExists,
      sessionActive: this.sessionActive ?? this.sessionExists,
      gathering: latest?.role === "user",
      latestMessageId: latest?.id,
      latestMessageRole: latest?.role === "user" || latest?.role === "assistant" ? latest.role : undefined,
      latestMessageCreatedAt: latest?.createdAt,
      lastAssistantMessageId: assistant?.id,
      lastAssistantMessageCreatedAt: assistant?.createdAt,
      lastAssistantMessageHash: assistant ? hashText(assistant.text) : undefined,
      detail: []
    };
  }

  override async getLatestAssistantMessage(_worker: WorkerIdentity): Promise<RelayableMessage | undefined> {
    return [...this.script].reverse().find((message) => message.role === "assistant");
  }
}

export class RecordingBrowserManager implements BrowserManager {
  readonly ownership: BrowserOwnership;
  reachable = true;
  readonly actions: string[] = [];
  private calls = { reconnect: 0, relaunch: 0, start: 0, stop: 0, openConversation: 0 };

  constructor(ownership: BrowserOwnership = "external") {
    this.ownership = ownership;
  }

  async status(): Promise<BrowserStatus> {
    return { ownership: this.ownership, reachable: this.reachable };
  }

  async reconnect(): Promise<void> {
    this.calls.reconnect += 1;
    this.actions.push("reconnect");
  }

  async start(): Promise<void> {
    this.calls.start += 1;
    this.actions.push("start");
  }

  async stop(): Promise<void> {
    this.calls.stop += 1;
    this.actions.push("stop");
  }

  async relaunch(): Promise<void> {
    if (this.ownership !== "managed") {
      throw new Error("Refusing to relaunch an externally owned browser.");
    }
    this.calls.relaunch += 1;
    this.actions.push("relaunch");
  }

  async openConversation(): Promise<void> {
    this.calls.openConversation += 1;
    this.actions.push("openConversation");
  }

  counts(): { reconnect: number; relaunch: number; start: number; stop: number; openConversation: number } {
    return { ...this.calls };
  }
}

export async function noopSleep(): Promise<void> {}

export function createTestDesktopService(
  options: Omit<DesktopServiceOptions, "relayEngine"> & { relayEngine?: RelayEngine }
): DesktopApplicationService {
  const dbPath = options.dbPath ?? join(tmpdir(), `agent-relay-test-${Math.random()}.sqlite`);
  const store = new SqliteRelayStore(dbPath);

  let pairs: SessionPair[] = [];
  if (options.configPath) {
    try {
      const content = readFileSync(options.configPath, "utf8");
      const parsed = JSON.parse(content);
      pairs = parsed.pairs ?? [];
    } catch {
      // ignore if file doesn't exist yet
    }
  }

  const launcher = options.desktopToolLauncher;
  const orchestrator = new RuntimeOrchestrator({
    pairs: [],
    store,
    relay: Boolean(options.relay),
    pollIntervalMs: options.pollIntervalMs,
    recoveryFor: options.recoveryPolicy ? (pair) => ({
      policy: options.recoveryPolicy === "none" ? "none" : "safe",
      maxAttempts: options.recoveryMaxAttempts,
      baseUrl: pair.worker.server?.baseUrl,
      startServerLauncher: options.recoveryPolicy === "safe" && launcher
        ? (repoPath, baseUrl) => launcher.startOpenCode({ repoPath, baseUrl })
        : undefined
    }) : undefined
  });
  try {
    orchestrator.reconfigurePairs(pairs);
  } catch {
    // ignore duplicate session ownership / invalid config during test setup
  }
  const relayEngine = options.relayEngine ?? new RelayEngine({ orchestrator });
  return new DesktopApplicationService({
    ...options,
    dbPath,
    relayEngine
  });
}

