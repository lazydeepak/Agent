import { dirname, join } from "node:path";
import { DesktopApplicationService } from "./desktop-service.js";
import { ProjectPairService } from "./project-pair-service.js";
import { ControlPlaneAdapter } from "./control-plane-adapter.js";
import { createRemoteServer } from "../remote/remote-server.js";
import type { RemoteServiceOptions } from "../remote/remote-server.js";
import { SqliteRelayStore, ensureDbParent, resolveDbPath } from "../persistence/index.js";
import { PairConfigRepository } from "./pair-config-repository.js";
import { RuntimeOrchestrator } from "../runtime/index.js";
import { RelayEngine } from "./relay-engine.js";

export interface HeadlessServiceOptions {
  configPath: string;
  dbPath?: string;
  token?: string;
  port?: number;
  host?: string;
  allowPublicBind?: boolean;
}

export class HeadlessService {
  private service: DesktopApplicationService | undefined;
  private projectPairService: ProjectPairService | undefined;
  private remote: { close: () => Promise<void> } | undefined;
  private shuttingDown = false;

  constructor(private readonly options: HeadlessServiceOptions) {}

  async start(): Promise<void> {
    const dbPath = resolveDbPath(this.options.dbPath);
    await ensureDbParent(dbPath);
    const store = new SqliteRelayStore(dbPath);
    await store.init();
    const configRepo = new PairConfigRepository(this.options.configPath);
    const config = await configRepo.load();
    const orchestrator = new RuntimeOrchestrator({
      pairs: [],
      store,
      relay: true,
      recoveryFor: () => ({ policy: "safe" })
    });
    try {
      orchestrator.reconfigurePairs(config.pairs);
    } catch {
      // Handled/ignored during construction if duplicate pairs
    }
    const relayEngine = new RelayEngine({ orchestrator });

    this.service = new DesktopApplicationService({
      configPath: this.options.configPath,
      dbPath: this.options.dbPath,
      relayEngine,
    });
    await this.service.init();

    const projectPairsConfigPath = join(dirname(this.options.configPath), "projects.local.json");
    this.projectPairService = new ProjectPairService({
      configPath: projectPairsConfigPath,
    });

    const token = this.options.token ?? process.env.RELAY_REMOTE_TOKEN ?? "";
    if (!token) {
      await this.shutdown();
      throw new Error(
        "RELAY_REMOTE_TOKEN is required: refusing to start the remote API without an explicit bearer token."
      );
    }

    const adapter = new ControlPlaneAdapter(this.service!, this.projectPairService!);
    const remote = createRemoteServer({
      host: this.options.host ?? process.env.RELAY_REMOTE_HOST ?? "127.0.0.1",
      port: this.options.port !== undefined ? this.options.port : Number(process.env.RELAY_REMOTE_PORT ?? 8181),
      token,
      allowPublicBind:
        this.options.allowPublicBind ??
        (process.env.RELAY_REMOTE_PUBLIC === "1" || process.env.RELAY_REMOTE_PUBLIC === "true"),
      adapter,
    });
    this.remote = remote;

    await new Promise<void>((resolve, reject) => {
      const listenPort = this.options.port === undefined ? (Number(process.env.RELAY_REMOTE_PORT ?? 8181)) : this.options.port;
      remote.server.listen(
        listenPort,
        this.options.host ?? process.env.RELAY_REMOTE_HOST ?? "127.0.0.1",
        () => resolve()
      );
      remote.server.once("error", reject);
    });

    // Emit structured readiness handshake to stdout for native sidecar parsing
    const address = remote.server.address();
    const readyPort = typeof address === "object" && address ? (address as any).port : (this.options.port ?? 8181);
    console.log(JSON.stringify({ type: "agent-relay-ready", host: this.options.host ?? process.env.RELAY_REMOTE_HOST ?? "127.0.0.1", port: readyPort }));

    await this.service.resumeManagedPairs();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.remote) {
      await this.remote.close();
      this.remote = undefined;
    }
    if (this.service) {
      await this.service.shutdown();
      this.service = undefined;
    }
  }

  getService(): DesktopApplicationService | undefined {
    return this.service;
  }

  getProjectPairService(): ProjectPairService | undefined {
    return this.projectPairService;
  }

  getRemoteClose(): (() => Promise<void>) | undefined {
    return this.remote ? () => this.remote!.close() : undefined;
  }
}
