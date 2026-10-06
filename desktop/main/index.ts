import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, shell } from "electron";
import { isAbsolute } from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopApplicationService, DesktopApplicationError } from "../../src/application/desktop-service.js";
import type { ManagedState } from "../../src/application/desktop-service.js";
import { ProjectPairService, type CreateProjectPairInput } from "../../src/application/project-pair-service.js";
import { DesktopLifecycle, type DesktopLifecycleState } from "../../src/application/desktop-lifecycle.js";
import { WorkerProgressService } from "../../src/application/worker-progress.js";
import { SqliteRelayStore, ensureDbParent, resolveDbPath } from "../../src/persistence/index.js";
import { discoverOpenCodeServerUrl } from "../../src/adapters/opencode/desktop-state.js";
import { PairConfigRepository } from "../../src/application/pair-config-repository.js";
import { RuntimeOrchestrator } from "../../src/runtime/index.js";
import { RelayEngine } from "../../src/application/relay-engine.js";
import type { SessionPair } from "../../src/types.js";
import { EVENT_CHANNEL, IPC_CHANNELS, STATUS_REFRESH_CHANNEL, WORKER_PROGRESS_CHANNEL } from "../shared/ipc-channels.js";
import type { DesktopErrorDto } from "../shared/dto.js";
import { registerIpcHandlers, type IpcContext } from "./ipc-handlers.js";
import { installNavigationGuards, openWorkerAuthWindowImpl } from "./electron-window.js";
import { parseCliOptions, type CliOptions } from "./cli-options.js";
import { ManagedTray, createManagedTray } from "./tray.js";
import {
  asAbsolutePath,
  asHttpUrl,
  asLoopbackUrl,
  asNonEmptyString,
  asPairId,
  asProjectPairId,
  asStringRecord,
  castBrowserNested,
  castCandidatePair,
  castCdpUrl,
  castCreateProjectPair,
  castCreateWorkerSession,
  castEndpointNested,
  castOpenCodeEndpoint,
  castOpenCodeEndpointTest,
  castPlannerEndpoint,
  castRecentEventsFilter,
  castStartPriming,
  castStartWorkerServer,
  castUpdatePair,
  castUrlInput,
  castWorkerModel,
  castWorkerSessionTitle
} from "./ipc-input.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const cli = parseCliOptions(process.argv.slice(2));

let service: DesktopApplicationService | undefined;
let projectPairService: ProjectPairService | undefined;
let workerProgress: WorkerProgressService | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: ManagedTray | undefined;
let quitting = false;
let lifecycle: DesktopLifecycle | undefined;
let lifecycleState: DesktopLifecycleState = "initializing";
let eventUnsubscribe: (() => void) | undefined;
let fatalReported = false;
const registeredIpcChannels: string[] = [];
let activateListener: (() => void) | undefined;
let resumeListener: (() => void) | undefined;

function requireService(): DesktopApplicationService {
  if (!service) {
    throw new DesktopApplicationError(
      "SERVICE_NOT_READY",
      "Agent Relay is still starting. Wait for the dashboard to finish loading, then retry."
    );
  }
  return service;
}

function requireWorkerProgress(): WorkerProgressService {
  if (!workerProgress) {
    throw new DesktopApplicationError(
      "WORKER_PROGRESS_UNAVAILABLE",
      "Worker progress is unavailable because the dashboard did not finish starting. Relaunch the app."
    );
  }
  return workerProgress;
}

function projectPairsConfigPath(): string {
  return join(dirname(cli.configPath), "projects.local.json");
}

function requireProjectPairService(): ProjectPairService {
  if (!projectPairService) {
    throw new DesktopApplicationError(
      "SERVICE_NOT_READY",
      "Agent Relay is still starting. Wait for the dashboard to finish loading, then retry."
    );
  }
  return projectPairService;
}

/** Single actionable error surface (dialog.showErrorBox is native on macOS/Windows/Linux). Reports at most once. */
function reportFatalErrorOnce(error: DesktopApplicationError): void {
  if (fatalReported) {
    return;
  }
  fatalReported = true;
  try {
    dialog.showErrorBox(
      "Agent Relay — startup failed",
      `${error.message}\n\nCode: ${error.code}\nCheck the database directory permissions and relaunch. Operational features are disabled.`
    );
  } catch {
    // Dialog failure must not mask the fatal state or throw during startup.
  }
}

function refreshManagedState(): void {
  if (!service || !tray) {
    return;
  }
  let state: ManagedState;
  try {
    state = service.getManagedState();
  } catch {
    state = "STOPPED";
  }
  tray.update(state);
}

async function startAllFromTray(): Promise<void> {
  if (!service) {
    return;
  }
  try {
    await service.startAll();
    refreshManagedState();
    broadcastToRenderer(STATUS_REFRESH_CHANNEL, {});
  } catch {
    refreshManagedState();
  }
}

async function stopAllFromTray(): Promise<void> {
  if (!service) {
    return;
  }
  try {
    await service.stopAll();
  } finally {
    refreshManagedState();
    broadcastToRenderer(STATUS_REFRESH_CHANNEL, {});
  }
}

function broadcastToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * Electron does not restrict navigation by default: without these guards a rendered page can
 * navigate the window off `file://` while keeping the preload (and therefore `window.desktop`),
 * and `window.open` inherits the opener's webPreferences including the preload script.
 */

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: "Agent Relay",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f141b" : "#eef1f6",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  installNavigationGuards(mainWindow);
  mainWindow.on("close", (event) => {
    if (quitting) {
      return;
    }
    event.preventDefault();
    mainWindow?.hide();
  });
  await mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

let shutdownCompleted = false;

async function shutdown(): Promise<void> {
  if (shutdownCompleted) {
    return;
  }
  shutdownCompleted = true;
  lifecycleState = "shutting-down";
  try {
    await lifecycle?.shutdown();
  } catch {
    // Lifecycle shutdown is best-effort; local cleanup below still runs.
  } finally {
    workerProgress?.dispose();
    workerProgress = undefined;
    if (!lifecycle) {
      try {
        if (service) {
          await service.shutdown();
        }
      } catch {
        // Best-effort when the lifecycle was never constructed.
      }
    }
    try {
      eventUnsubscribe?.();
      eventUnsubscribe = undefined;
      unregisterIpcHandlers();
      if (activateListener) {
        app.removeListener("activate", activateListener);
        activateListener = undefined;
      }
      if (resumeListener) {
        powerMonitor.removeListener("resume", resumeListener);
        resumeListener = undefined;
      }
      tray?.destroy();
      tray = undefined;
    } finally {
      service = undefined;
      projectPairService = undefined;
      lifecycleState = "stopped";
    }
  }
}

function unregisterIpcHandlers(): void {
  for (const channel of registeredIpcChannels.splice(0)) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Best-effort: a missing handler must not break fatal-path cleanup.
    }
  }
}

/** Opens a dedicated, sandboxed auth window for a worker session URL, injecting the stored Basic credential for that origin only. */

function ipcContext(): IpcContext {
  return {
    handle: (channel, fn) => ipcMain.handle(channel, fn),
    requireService,
    requireWorkerProgress,
    requireProjectPairService,
    broadcastToRenderer,
    openWorkerAuthWindow: (input) => openWorkerAuthWindowImpl(input),
    openExternalUrl: async (url) => {
      await shell.openExternal(url, { activate: true });
    }
  };
}

/** Operational side effects. Runs only after the store and worker progress are proven valid. */
function registerOperationalHandlers(): void {
  registerIpcHandlers(ipcContext());

  const svc = requireService();
  eventUnsubscribe = svc.subscribeEvents((event) => {
    broadcastToRenderer(EVENT_CHANNEL, event);
    if (event.type === "PAIR_RUNTIME_STARTED" || event.type === "PAIR_RUNTIME_STOPPED" || event.type === "PAIR_RUNTIME_FAILED" || event.type === "SCHEDULER_MODE_CHANGED") {
      refreshManagedState();
    }
    if (event.pairId) {
      const current = service?.getPairDetail(event.pairId);
      if (!current) return;
      if (event.type.includes("WORKER_MESSAGE") || event.type.startsWith("RECOVERY_") || event.type === "SESSION_RECONNECTED" || event.type === "PAIR_RUNTIME_STARTED" || event.type === "PAIR_RUNTIME_STOPPED") {
        workerProgress?.scheduleRefresh(event.pairId, current.worker.sessionId, resolvePairOpenCodeOptions(current));
      }
    }
  });

  tray = createManagedTray({
    onOpenDashboard: showWindow,
    onStartAll: () => void startAllFromTray(),
    onStopAll: () => void stopAllFromTray(),
    onQuit: requestQuit
  });

  activateListener = () => {
    showWindow();
  };
  app.on("activate", activateListener);

  resumeListener = () => {
    refreshManagedState();
    broadcastToRenderer(STATUS_REFRESH_CHANNEL, { reason: "system-resumed" });
  };
  powerMonitor.on("resume", resumeListener);
}

function unregisterOperationalHandlers(): void {
  try {
    eventUnsubscribe?.();
  } catch {
    // Best-effort.
  } finally {
    eventUnsubscribe = undefined;
  }
  unregisterIpcHandlers();
  if (activateListener) {
    app.removeListener("activate", activateListener);
    activateListener = undefined;
  }
  if (resumeListener) {
    powerMonitor.removeListener("resume", resumeListener);
    resumeListener = undefined;
  }
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) {
    process.stderr.write("Agent Relay: another instance is already running; exiting.\n");
    app.exit(0);
    return;
  }
  lifecycleState = "initializing";
  process.env.AGENT_RELAY_CONFIG = cli.configPath;
  const dbPath = resolveDbPath(cli.dbPath);
  await ensureDbParent(dbPath);
  const store = new SqliteRelayStore(dbPath);
  await store.init();
  const configRepo = new PairConfigRepository(cli.configPath);
  const config = await configRepo.load();

  const discoveredOpenCodeUrl = await discoverOpenCodeServerUrl();
  const opencodeBaseUrl = cli.opencodeBaseUrl ?? discoveredOpenCodeUrl;

  const orchestrator = new RuntimeOrchestrator({
    pairs: [],
    store,
    relay: cli.relay,
    recoveryFor: () => ({ policy: "safe" }),
    adapterDefaults: {
      opencode: opencodeBaseUrl ? { baseUrl: opencodeBaseUrl } : undefined,
      chatgpt: cli.chatgptCdpUrl ? { cdpUrl: cli.chatgptCdpUrl } : undefined,
      liveOpenCode: cli.liveOpenCode,
      liveChatGPT: cli.liveChatGPT
    }
  });
  try {
    orchestrator.reconfigurePairs(config.pairs);
  } catch {
    // Handled during init/startup
  }
  const relayEngine = new RelayEngine({ orchestrator });

  service = new DesktopApplicationService({
    configPath: cli.configPath,
    dbPath: cli.dbPath,
    liveOpenCode: cli.liveOpenCode,
    liveChatGPT: cli.liveChatGPT,
    opencode: opencodeBaseUrl ? { baseUrl: opencodeBaseUrl } : undefined,
    chatgpt: cli.chatgptCdpUrl ? { cdpUrl: cli.chatgptCdpUrl } : undefined,
    relay: cli.relay,
    recoveryPolicy: "safe",
    relayEngine
  });
  projectPairService = new ProjectPairService({
    configPath: projectPairsConfigPath(),
    opencodeBaseUrl: opencodeBaseUrl,
    chatgptCdpUrl: cli.chatgptCdpUrl
  });

  const bootService = service;
  const openCodeOptions = cli.opencodeBaseUrl ? { baseUrl: cli.opencodeBaseUrl } : {};
  lifecycle = new DesktopLifecycle(
    {
      init: () => bootService.init(),
      getStore: () => bootService.getStore(),
      shutdown: () => bootService.shutdown()
    },
    {
      createWorkerProgress: (store) => {
        const progress = new WorkerProgressService(store, openCodeOptions, {
          onProgressUpdate: (pairId) => {
            broadcastToRenderer(WORKER_PROGRESS_CHANNEL, { pairId });
          }
        });
        workerProgress = progress;
        return progress;
      },
      registerOperationalHandlers,
      unregisterOperationalHandlers,
      createWindow,
      resumeManagedPairs: () => bootService.resumeManagedPairs(),
      reportFatalError: (error) => {
        reportFatalErrorOnce(error);
      }
    }
  );

  const result = await lifecycle.boot();
  lifecycleState = lifecycle.getState();
  if (result.status === "failed") {
    reportFatalErrorOnce(result.error);
    app.quit();
    return;
  }
  if (result.status === "aborted") {
    return;
  }

  lifecycleState = "ready";
  broadcastToRenderer(STATUS_REFRESH_CHANNEL, { reason: "startup-resume-complete" });
  refreshManagedState();
});

// Single-instance guard: a second dashboard must never run against the same
// SQLite store and config files. It exits on startup while this instance
// focuses its window.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (isPrimaryInstance) {
  app.on("second-instance", () => {
    showWindow();
  });
}

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  // The dashboard hides to the tray while Agent Relay runtimes keep running.
  // Quitting is only driven by the explicit Quit action or a shutdown signal.
});

const requestQuit = onceShutdown(() => {
  if (quitting) {
    return;
  }
  quitting = true;
  void shutdown().finally(() => app.quit());
});

process.on("SIGINT", requestQuit);
process.on("SIGTERM", requestQuit);

function resolvePairOpenCodeOptions(pair: SessionPair): { baseUrl?: string } | undefined {
  const serverUrl = pair.worker.server?.baseUrl;
  if (!serverUrl) return undefined;
  return { baseUrl: serverUrl };
}

function onceShutdown(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    fn();
  };
}
