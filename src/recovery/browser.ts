import type { BrowserOwnership } from "../types.js";

export interface BrowserStatus {
  ownership: BrowserOwnership;
  reachable: boolean;
  reason?: string;
}

export interface BrowserManager {
  readonly ownership: BrowserOwnership;
  status(): Promise<BrowserStatus>;
  reconnect(): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  relaunch?(): Promise<void>;
  openConversation?(conversationUrl: string): Promise<void>;
}

export class ExternalBrowserManager implements BrowserManager {
  readonly ownership: BrowserOwnership = "external";

  async status(): Promise<BrowserStatus> {
    return {
      ownership: "external",
      reachable: true,
      reason: "External browser is not managed by Agent Relay; reconnect-only handling applies."
    };
  }

  async reconnect(): Promise<void> {
    // Agent Relay connects per operation and holds no external browser handle.
  }

  async relaunch(): Promise<void> {
    throw new Error("Refusing to relaunch an externally owned browser.");
  }

  async openConversation(conversationUrl: string): Promise<void> {
    // Navigation is allowed but requires a driver; without one it is a no-op.
    void conversationUrl;
  }
}

export interface ManagedBrowserHandle {
  stop(): Promise<void>;
}

export interface ManagedBrowserLens {
  launch(): Promise<ManagedBrowserHandle>;
}

export class ManagedBrowserManager implements BrowserManager {
  readonly ownership: BrowserOwnership = "managed";
  private handle: ManagedBrowserHandle | undefined;

  constructor(private readonly lens: ManagedBrowserLens) {}

  async status(): Promise<BrowserStatus> {
    return {
      ownership: "managed",
      reachable: this.handle !== undefined,
      reason: this.handle === undefined ? "Managed browser has not been launched." : undefined
    };
  }

  async reconnect(): Promise<void> {
    if (!this.handle) {
      await this.start();
    }
  }

  async relaunch(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async start(): Promise<void> {
    if (this.handle) {
      return;
    }
    this.handle = await this.lens.launch();
  }

  async stop(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    if (handle) {
      await handle.stop();
    }
  }

  async openConversation(conversationUrl: string): Promise<void> {
    if (!this.handle) {
      await this.start();
    }
    void conversationUrl;
  }
}

export function browserManagerFor(
  config: { cdpUrl?: string; executablePath?: string } | undefined,
  lens?: ManagedBrowserLens
): BrowserManager {
  if (config?.cdpUrl) {
    return new ExternalBrowserManager();
  }
  if (lens) {
    return new ManagedBrowserManager(lens);
  }
  return new ExternalBrowserManager();
}