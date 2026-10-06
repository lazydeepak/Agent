import { FakeChatGPTBrowserAdapter, LiveChatGPTBrowserAdapter } from "./adapters/chatgpt/index.js";
import {
  FakeOpenCodeAdapter,
  LiveOpenCodeAdapter,
  type OpenCodeSessionSummary
} from "./adapters/opencode/index.js";
import {
  RelayStoreError,
  SqliteRelayStore,
  ensureDbParent,
  resolveDbPath,
  type RelayStore
} from "./persistence/index.js";
import { formatRelayResult, relayPlannerToWorker, relayWorkerToPlanner } from "./relay/index.js";
import { browserManagerFor } from "./recovery/index.js";
import { isRecoveryPolicy } from "./recovery/index.js";
import { bindOpenCodeSession, ConfigError, loadPairsConfig } from "./sessions/pairs.js";
import {
  JsonLineSupervisorLogger,
  Supervisor,
  isTerminalFailure
} from "./supervisor/index.js";
import { LockRegistry, RuntimeOrchestrator, createPairAdapters, type RuntimeStatusSummary } from "./runtime/index.js";
import type { RelayResult } from "./relay/index.js";
import type {
  ChatGPTBrowserConfig,
  OpenCodeServerConfig,
  RelayableMessage,
  RelayRecord,
  SessionPair
} from "./types.js";
import { formatReadinessReport } from "./validator/report.js";
import { validatePair } from "./validator/readiness.js";
import { LOCAL_AGENT_PLANNER_PROMPT, LOCAL_AGENT_PLANNER_PROMPT_VERSION } from "./application/local-agent-planner-prompt.js";
import { PairConfigRepository } from "./application/pair-config-repository.js";
import { LocalDesktopToolLauncher } from "./application/desktop-tool-manager.js";
import type { SupervisorRecoveryOptions } from "./supervisor/supervisor.js";
import { CliError, parseArgs, hasChatGPTBrowserConfig, type ParsedArgs } from "./cli-args.js";
import { HeadlessService } from "./application/headless-service.js";

export { parseArgs } from "./cli-args.js";
export type { ParsedArgs } from "./cli-args.js";

export async function runCli(args: string[]): Promise<void> {
  try {
    const parsedArgs = parseArgs(args);

    if (parsedArgs.command === "validate") {
      await runValidate(parsedArgs);
      return;
    }

    if (parsedArgs.command === "opencode") {
      await runOpenCode(parsedArgs);
      return;
    }

    if (parsedArgs.command === "bind-opencode") {
      await runBindOpenCode(parsedArgs);
      return;
    }

    if (parsedArgs.command === "relay") {
      await runRelay(parsedArgs);
      return;
    }

    if (parsedArgs.command === "seed") {
      await runSeed(parsedArgs);
      return;
    }

    if (parsedArgs.command === "state") {
      await runState(parsedArgs);
      return;
    }

    if (parsedArgs.command === "supervise") {
      await runSupervise(parsedArgs);
      return;
    }

    if (parsedArgs.command === "supervisor") {
      await runSupervisorCommand(parsedArgs);
      return;
    }

    if (parsedArgs.command === "recovery") {
      await runRecoveryCommand(parsedArgs);
      return;
    }

    if (parsedArgs.command === "model") {
      await runModelCommand(parsedArgs);
      return;
    }

    if (parsedArgs.command === "browser") {
      await runBrowserCommand(parsedArgs);
      return;
    }

    if (parsedArgs.command === "runtime") {
      await runRuntime(parsedArgs);
      return;
    }

    if (parsedArgs.command === "service") {
      await runService(parsedArgs);
      return;
    }

    if (parsedArgs.command === "prune") {
      await runPrune(parsedArgs);
      return;
    }

    throw new CliError(usage());
  } catch (error) {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function runValidate(args: ParsedArgs): Promise<void> {
  const config = await loadPairsConfig(args.configPath);
  const selectedPairs = selectPairs(config.pairs, args);
  const results = await Promise.all(
    selectedPairs.map((pair) =>
      validatePair(pair, {
        worker: shouldUseLiveOpenCode(args, pair)
          ? new LiveOpenCodeAdapter(workerOptionsFromCli(pair, args))
          : new FakeOpenCodeAdapter(),
        planner: shouldUseLiveChatGPT(args, pair)
          ? new LiveChatGPTBrowserAdapter({ ...pair.planner.browser, ...args.chatgpt })
          : new FakeChatGPTBrowserAdapter()
      })
    )
  );

  console.log(formatReadinessReport(results));

  if (results.some((result) => result.status === "NOT_READY")) {
    process.exitCode = 1;
  }
}

async function runOpenCode(args: ParsedArgs): Promise<void> {
  const manager = new LiveOpenCodeAdapter({ ...args.opencode, allowInsecureAuth: true });

  if (args.subcommand === "health") {
    await manager.checkServer();
    console.log("OpenCode server reachable.");
    return;
  }

  if (args.subcommand === "list") {
    const sessions = await manager.listSessions({ repoPath: args.repoPath, limit: args.limit });
    console.log(formatOpenCodeSessions(sessions));
    return;
  }

  if (args.subcommand === "status") {
    const activeSessions = await manager.listActiveSessions();
    console.log(JSON.stringify(activeSessions, null, 2));
    return;
  }

  if (args.subcommand === "create") {
    if (!args.repoPath) {
      throw new CliError("OpenCode session creation requires --repo <path>.");
    }
    const session = await manager.createSession({ repoPath: args.repoPath, title: args.title });
    console.log(formatOpenCodeSessions([session]));
    return;
  }

  throw new CliError("OpenCode command requires one of: health, list, status, create.");
}

async function runBindOpenCode(args: ParsedArgs): Promise<void> {
  if (!args.pairId || !args.sessionId) {
    throw new CliError("Usage: npm run relay -- bind-opencode <pairId> <sessionId> [--config <path>]");
  }

  await bindOpenCodeSession(args.configPath, args.pairId, args.sessionId);
  console.log(`Bound ${args.pairId} to OpenCode session ${args.sessionId}.`);
}

async function runRelay(args: ParsedArgs): Promise<void> {
  const config = await loadPairsConfig(args.configPath);
  const [pair] = selectPairs(config.pairs, args);
  if (!pair) {
    throw new ConfigError([`Unknown pairId "${args.pairId}". Check the configured pairs or use --all.`]);
  }

  const worker = new LiveOpenCodeAdapter(workerOptionsFromCli(pair, args));
  const planner = shouldUseLiveChatGPT(args, pair)
    ? new LiveChatGPTBrowserAdapter({ ...pair.planner.browser, ...args.chatgpt })
    : new FakeChatGPTBrowserAdapter(args.message ? [plannerMessageFromCli(args.message)] : []);

  if (args.subcommand === "planner-to-worker" && !args.message && !shouldUseLiveChatGPT(args, pair)) {
    throw new CliError(
      "Relay planner-to-worker requires --message <text> while ChatGPT is mocked, or --live-chatgpt for live reading."
    );
  }

  const store = await openStore(args);
  if (args.force) {
    console.log("[force] Duplicate suppression bypassed for this relay attempt.");
  }

  try {
    const result =
      args.subcommand === "planner-to-worker"
        ? await relayPlannerToWorker(pair, { worker, planner }, { force: args.force, persistence: { store } })
        : await relayWorkerToPlanner(pair, { worker, planner }, { force: args.force, persistence: { store } });

    console.log(formatRelayResult(result));

    if (result.status === "NOT_READY" || result.status === "FAILED" || result.status === "AMBIGUOUS") {
      process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

async function runSeed(args: ParsedArgs): Promise<void> {
  if (args.subcommand !== "local-agent") {
    throw new CliError("Seed command requires the local-agent subcommand.");
  }
  const config = await loadPairsConfig(args.configPath);
  const [pair] = selectPairs(config.pairs, args);
  if (!pair) {
    throw new ConfigError([`Unknown pairId "${args.pairId}". Check the configured pairs or use --all.`]);
  }

  const planner = shouldUseLiveChatGPT(args, pair)
    ? new LiveChatGPTBrowserAdapter({ ...pair.planner.browser, ...args.chatgpt })
    : new FakeChatGPTBrowserAdapter();

  const message: RelayableMessage = {
    id: `local-agent-kickoff-${pair.pairId}-v${LOCAL_AGENT_PLANNER_PROMPT_VERSION}-${Date.now()}`,
    source: "worker",
    role: "user",
    text: LOCAL_AGENT_PLANNER_PROMPT,
    createdAt: Date.now()
  };

  await planner.sendWorkerMessage(pair.planner, message);
  await new PairConfigRepository(args.configPath).updatePair(pair.pairId, { localAgentMode: true });
  console.log(
    `Local agent planner prompt v${LOCAL_AGENT_PLANNER_PROMPT_VERSION} fed to ChatGPT for ${pair.pairId}; marked local-agent mode.`
  );
}

async function runState(args: ParsedArgs): Promise<void> {
  const store = await openStore(args);
  try {
    if (args.subcommand === "init") {
      console.log(`Relay state initialized at ${resolveDbPath(args.dbPath)}.`);
      return;
    }

    if (args.subcommand === "inspect") {
      const path = resolveDbPath(args.dbPath);
      console.log(`Relay state database: ${path}`);
      const pairStates = listAllPairStates(store);
      const pending = listAllNondelivered(store);
      console.log(`Pairs with recorded state: ${pairStates.length}`);
      console.log(`Pending ambiguous attempts: ${pending}`);
      for (const pairId of pairStates) {
        console.log(`  ${pairId}`);
      }
      return;
    }

    if (args.subcommand === "pair") {
      const state = store.getPairState(args.pairId as string);
      if (!state) {
        console.log(`No relay state recorded for ${args.pairId}.`);
        return;
      }
      const records = store.listRecords(args.pairId as string);
      const ambiguous = records
        .filter((record) => record.status === "DELIVERING" || record.status === "FAILED")
        .length;
      console.log(state.pairId);
      console.log("");
      console.log("Last worker \u2192 planner:");
      console.log(formatLastDirection(state.lastWorkerMessageId, "worker-to-planner", records));
      console.log("");
      console.log("Last planner \u2192 worker:");
      console.log(formatLastDirection(state.lastPlannerMessageId, "planner-to-worker", records));
      console.log("");
      console.log(`Pending ambiguous attempts: ${ambiguous}`);
      if (state.lastError) {
        console.log(`Last error: ${state.lastError}`);
      }
      return;
    }

    if (args.subcommand === "messages") {
      const records = store.listRecords(args.pairId as string);
      if (args.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }
      if (records.length === 0) {
        console.log(`No relay messages recorded for ${args.pairId}.`);
        return;
      }
      console.log(records.map(formatRecordLine).join("\n"));
      return;
    }
  } finally {
    store.close();
  }
}

async function runPrune(args: ParsedArgs): Promise<void> {
  let configPairIds = new Set<string>();
  try {
    const config = await loadPairsConfig(args.configPath);
    configPairIds = new Set(config.pairs.map((pair) => pair.pairId));
  } catch {
    // A missing/unreadable config means every persisted pair is "orphaned".
  }

  const store = await openStore(args);
  try {
    const orphaned = store.listAllPairIds().filter((pairId) => !configPairIds.has(pairId));
    if (orphaned.length === 0) {
      console.log("No orphaned relay state to prune.");
      return;
    }

    const verb = args.force ? "Purge" : "Would prune";
    console.log(`${verb} ${orphaned.length} orphaned pair(s) with no configured pairId:`);
    for (const pairId of orphaned) {
      console.log(`  ${pairId}`);
    }

    if (!args.force) {
      console.log("Run with --force to delete.");
      return;
    }

    let purged = 0;
    for (const pairId of orphaned) {
      try {
        store.purgePairData(pairId);
        purged += 1;
      } catch (error) {
        console.error(`Failed to purge ${pairId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`Pruned ${purged} of ${orphaned.length} orphaned pair(s).`);
  } finally {
    store.close();
  }
}

async function runSupervise(args: ParsedArgs): Promise<void> {
  const config = await loadPairsConfig(args.configPath);
  const [pair] = selectPairs(config.pairs, args);
  if (!pair) {
    throw new ConfigError([`Unknown pairId "${args.pairId}". Check the configured pairs or use --all.`]);
  }

  const worker = new LiveOpenCodeAdapter(workerOptionsFromCli(pair, args));
  const planner = shouldUseLiveChatGPT(args, pair)
    ? new LiveChatGPTBrowserAdapter({ ...pair.planner.browser, ...args.chatgpt })
    : new FakeChatGPTBrowserAdapter();

  const store = await openStore(args);
  const logger = new JsonLineSupervisorLogger();

  try {
    // No --watch means a single observation and exit; `--once` is the explicit spelling of that
    // default (it is rejected together with `--watch` during argument validation).
    if (!args.watch) {
      const supervisor = new Supervisor({
        pair,
        worker,
        planner,
        store,
        logger,
        mode: "observe",
        stuckAfterMs: args.stuckAfterMs
      });
      const report = await supervisor.observeOnce();
      printSupervisorReport(report, args.json);
      if (isTerminalFailure(report.state)) {
        process.exitCode = 1;
      }
      return;
    }

    const launcher = new LocalDesktopToolLauncher();
    const supervisor = new Supervisor({
      pair,
      worker,
      planner,
      store,
      logger,
      mode: args.relay ? "relay" : "observe",
      pollIntervalMs: args.pollIntervalMs,
      stuckAfterMs: args.stuckAfterMs,
      recovery: recoveryOptions(args, pair, launcher),
      onReport: (report) => printSupervisorReport(report, args.json)
    });

    const stop = async () => {
      supervisor.stop();
      await launcher.shutdown();
    };
    const onSigint = () => { stop().catch(() => {}); };
    const onSigterm = () => { stop().catch(() => {}); };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    try {
      await supervisor.start();
    } finally {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      await launcher.shutdown();
    }
  } finally {
    logger.close();
    store.close();
  }
}

async function runSupervisorCommand(args: ParsedArgs): Promise<void> {
  const store = await openStore(args);
  const pairId = args.pairId as string;

  try {
    if (args.subcommand === "pause") {
      store.touchSupervisorState({ pairId, paused: true });
      console.log(`Paused supervision for ${pairId}.`);
      return;
    }

    if (args.subcommand === "resume") {
      store.touchSupervisorState({ pairId, paused: false });
      console.log(`Resumed supervision for ${pairId}.`);
      return;
    }

    const continuity = store.getSupervisorState(pairId);
    if (!continuity) {
      console.log(`No supervisor state recorded for ${pairId}.`);
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(continuity, null, 2));
      return;
    }

    console.log(continuity.pairId);
    console.log(`state: ${continuity.lastSupervisorState ?? "(none)"}`);
    console.log(`stateChangedAt: ${continuity.stateChangedAt ?? ""}`);
    console.log(`lastObservedAt: ${continuity.lastObservedAt ?? ""}`);
    console.log(`lastWorkerActivityAt: ${continuity.lastWorkerActivityAt ?? ""}`);
    console.log(`lastPlannerActivityAt: ${continuity.lastPlannerActivityAt ?? ""}`);
    console.log(`currentCycleWorkerMessageId: ${continuity.currentCycleWorkerMessageId ?? ""}`);
    console.log(`currentCyclePlannerMessageId: ${continuity.currentCyclePlannerMessageId ?? ""}`);
    console.log(`lastPlannerSideSyncedMessageId: ${continuity.lastPlannerSideSyncedMessageId ?? ""}`);
    console.log(`paused: ${continuity.paused}`);
  } finally {
    store.close();
  }
}

async function openStore(args: ParsedArgs): Promise<RelayStore> {
  const dbPath = resolveDbPath(args.dbPath);
  let store: SqliteRelayStore | undefined;
  try {
    await ensureDbParent(dbPath);
    store = new SqliteRelayStore(dbPath);
    await store.init();
    return store;
  } catch (error) {
    store?.close();
    if (error instanceof RelayStoreError) {
      throw error;
    }
    throw new CliError(`Could not initialize relay state at ${dbPath}: ${errorMessage(error)}`);
  }
}

/**
 * Worker adapter options for CLI commands. The endpoint and credentials come from persisted pair
 * configuration and operator-supplied flags, so Basic auth over plain HTTP stays the operator's
 * explicit choice (see `OpenCodeClientOptions.allowInsecureAuth`).
 */
function workerOptionsFromCli(pair: SessionPair, args: ParsedArgs) {
  return { ...pair.worker.server, ...args.opencode, allowInsecureAuth: true };
}

function plannerMessageFromCli(text: string): RelayableMessage {
  return {
    id: `cli-${Date.now()}`,
    source: "planner",
    role: "user",
    text
  };
}

function listAllPairStates(store: RelayStore): string[] {
  return store.listAllPairIds();
}

function listAllNondelivered(store: RelayStore): number {
  return store.listNondelivered().length;
}

function formatLastDirection(
  lastMessageId: string | undefined,
  direction: "worker-to-planner" | "planner-to-worker",
  records: RelayRecord[]
): string {
  const record = lastMessageId
    ? records.filter((r) => r.direction === direction && r.sourceMessageId === lastMessageId).at(-1)
    : records.filter((r) => r.direction === direction).at(-1);

  if (record && record.status === "DELIVERED") {
    return `  source: ${record.sourceMessageId}\n  delivered: ${record.deliveredAt ?? record.lastAttemptAt ?? "unknown"}\n  status: ${record.status}`;
  }

  if (record) {
    return `  source: ${record.sourceMessageId}\n  status: ${record.status} (not delivered)`;
  }

  return "  (none)";
}

function formatRecordLine(record: RelayRecord): string {
  const parts = [
    `#${record.id}`,
    record.direction,
    record.sourceMessageId,
    record.status,
    record.deliveredAt ?? record.lastAttemptAt ?? record.firstSeenAt
  ];
  return parts.join("  ");
}

function printSupervisorReport(report: {
  pairId: string;
  state: string;
  previousState?: string;
  reason?: string;
  observedAt: string;
  paused: boolean;
  mode: string;
  relays: RelayResult[];
  cycle: unknown;
  snapshot: unknown;
  workerRelayStable?: boolean;
  recovery?: {
    policy: string;
    eligible: boolean;
    recovered: boolean;
    performed: boolean;
    intervention: boolean;
    action: string;
    attemptCount: number;
  };
}, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify({
        pairId: report.pairId,
        state: report.state,
        previousState: report.previousState ?? null,
        reason: report.reason ?? null,
        observedAt: report.observedAt,
        paused: report.paused,
        mode: report.mode,
        relays: report.relays.map(summarizeRelay),
        recovery: report.recovery
          ? {
              policy: report.recovery.policy,
              eligible: report.recovery.eligible,
              recovered: report.recovery.recovered,
              performed: report.recovery.performed,
              intervention: report.recovery.intervention,
              action: report.recovery.action,
              attemptCount: report.recovery.attemptCount
            }
          : null,
        workerRelayStable: report.workerRelayStable ?? null
      })
    );
    return;
  }

  const header = `${report.pairId}  ${report.state}  ${report.observedAt}`;
  console.log(report.reason ? `${header}  ${report.reason}` : header);
  for (const relay of report.relays) {
    console.log(`relay  ${relay.direction ?? ""}  ${relay.status}  ${relay.sourceMessage?.id ?? ""}`.trimEnd());
  }
  if (report.recovery?.performed) {
    const outcome = report.recovery.recovered ? "recovered" : report.recovery.intervention ? "intervention" : "failed";
    console.log(
      `recovery  ${outcome}  action=${report.recovery.action}  attempts=${report.recovery.attemptCount}`
    );
  }
}

function summarizeRelay(relay: RelayResult): {
  status: string;
  direction?: string;
  sourceMessageId?: string;
  reason?: string;
} {
  return {
    status: relay.status,
    direction: relay.direction,
    sourceMessageId: relay.sourceMessage?.id,
    reason: relay.reason
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectPairs(pairs: SessionPair[], args: ParsedArgs): SessionPair[] {
  if (args.all) {
    return pairs.filter((pair) => pair.enabled);
  }

  const pair = pairs.find((candidate) => candidate.pairId === args.pairId);
  if (!pair) {
    throw new ConfigError([`Unknown pairId "${args.pairId}". Check the configured pairs or use --all.`]);
  }

  return [pair];
}

function shouldUseLiveOpenCode(args: ParsedArgs, pair: SessionPair): boolean {
  return args.liveOpenCode || Boolean(args.opencode.baseUrl) || Boolean(pair.worker.server?.baseUrl);
}

function shouldUseLiveChatGPT(args: ParsedArgs, pair: SessionPair): boolean {
  return args.liveChatGPT || hasChatGPTBrowserConfig(args.chatgpt) || hasChatGPTBrowserConfig(pair.planner.browser);
}

async function runRecoveryCommand(args: ParsedArgs): Promise<void> {
  const config = await loadPairsConfig(args.configPath);
  const [pair] = selectPairs(config.pairs, args);
  if (!pair) {
    throw new ConfigError([`Unknown pairId "${args.pairId}". Check the configured pairs or use --all.`]);
  }

  const store = await openStore(args);
  const pairId = args.pairId as string;

  try {
    if (args.subcommand === "status") {
      const continuity = store.getSupervisorState(pairId);
      if (!continuity) {
        console.log(`No recovery state recorded for ${pairId}.`);
        return;
      }
      const metadata = {
        policy: continuity.recoveryPolicy ?? null,
        attemptCount: continuity.recoveryAttemptCount ?? null,
        lastAttemptAt: continuity.lastRecoveryAttemptAt ?? null,
        lastSuccessAt: continuity.lastRecoverySuccessAt ?? null,
        lastErrorCode: continuity.lastRecoveryErrorCode ?? null,
        lastError: continuity.lastRecoveryError ?? null
      };
      if (args.json) {
        console.log(JSON.stringify({ pairId, ...metadata }, null, 2));
        return;
      }
      console.log(pairId);
      console.log(`policy: ${metadata.policy ?? "(default safe)"}`);
      console.log(`attemptCount: ${metadata.attemptCount ?? 0}`);
      console.log(`lastAttemptAt: ${metadata.lastAttemptAt ?? ""}`);
      console.log(`lastSuccessAt: ${metadata.lastSuccessAt ?? ""}`);
      console.log(`lastErrorCode: ${metadata.lastErrorCode ?? ""}`);
      console.log(`lastError: ${metadata.lastError ?? ""}`);
      return;
    }

    const worker = new LiveOpenCodeAdapter(workerOptionsFromCli(pair, args));
    const planner = shouldUseLiveChatGPT(args, pair)
      ? new LiveChatGPTBrowserAdapter({ ...pair.planner.browser, ...args.chatgpt })
      : new FakeChatGPTBrowserAdapter();
    const logger = new JsonLineSupervisorLogger();
    const launcher = new LocalDesktopToolLauncher();

    try {
      const supervisor = new Supervisor({
        pair,
        worker,
        planner,
        store,
        logger,
        mode: "observe",
        stabilityMs: 0,
        stuckAfterMs: args.stuckAfterMs,
        recovery: recoveryOptions(args, pair, launcher)
      });
      const report = await supervisor.observeOnce();
      // A one-shot recovery transfers the freshly started OpenCode server only
      // when recovery actually recovered the bound session. On failure the
      // server stays owned and the launcher shutdown below kills it.
      if (report.recovery?.recovered === true) {
        launcher.releaseOpenCode();
      }
      printSupervisorReport(report, args.json);
      if (report.recovery?.intervention || ((report.state === "FAILED" || report.state === "DISCONNECTED") && !report.recovery?.recovered)) {
        process.exitCode = 1;
      }
    } finally {
      logger.close();
      await launcher.shutdown();
    }
  } finally {
    store.close();
  }
}

async function runBrowserCommand(args: ParsedArgs): Promise<void> {
  const config = await loadPairsConfig(args.configPath);
  const [pair] = selectPairs(config.pairs, args);
  if (!pair) {
    throw new ConfigError([`Unknown pairId "${args.pairId}". Check the configured pairs or use --all.`]);
  }

  const browser = browserManagerFor(pair.planner.browser);

  try {
    if (args.subcommand === "status") {
      const status = await browser.status();
      console.log(`${pair.pairId}`);
      console.log(`ownership: ${status.ownership}`);
      console.log(`reachable: ${status.reachable}`);
      if (status.reason) {
        console.log(`reason: ${status.reason}`);
      }
      return;
    }

    if (browser.ownership === "external") {
      throw new CliError(
        `Cannot ${args.subcommand} an externally owned browser for ${pair.pairId}. Agent Relay only reconnects to external browsers and never kills or restarts them.`
      );
    }

    if (args.subcommand === "stop") {
      if (!browser.stop) {
        throw new CliError(`Managed browser for ${pair.pairId} does not support stop.`);
      }
      await browser.stop();
      console.log(`Stopped managed browser for ${pair.pairId}.`);
      return;
    }

    if (!browser.start) {
      throw new CliError(
        "Agent Relay does not yet launch managed browsers. Use an external browser with --chatgpt-cdp-url instead."
      );
    }
    await browser.start();
    console.log(`Started managed browser for ${pair.pairId}.`);
  } finally {
    // no persistent browser handle on the CLI path
  }
}

async function runRuntime(args: ParsedArgs): Promise<void> {
  const config = await loadPairsConfig(args.configPath);
  const pairs = selectRuntimePairs(config.pairs, args);
  if (pairs.length === 0) {
    throw new CliError(
      "No runtime pairs were selected. Enable pairs in the config or pass explicit pairIds."
    );
  }
  const store = await openStore(args);
  const logger = new JsonLineSupervisorLogger();

  try {
    if (args.subcommand === "start") {
      const disabled = pairs.filter((pair) => !pair.enabled);
      if (disabled.length > 0) {
        throw new CliError(
          `Cannot start disabled pair(s): ${disabled.map((pair) => pair.pairId).join(", ")}. Enable them in the config first.`
        );
      }
      await runRuntimeStart(args, pairs, store, logger);
      return;
    }

    if (args.subcommand === "status") {
      const statuses = runtimeStatusFromPersistence(pairs, store);
      printRuntimeStatus(statuses, args.json);
      return;
    }

    const stoppedAt = new Date().toISOString();
    for (const pair of pairs) {
      store.touchRuntimeState({ pairId: pair.pairId, runtimeEnabled: false, lastRuntimeStopAt: stoppedAt });
      logger.write({
        time: stoppedAt,
        type: "PAIR_RUNTIME_STOPPED",
        pairId: pair.pairId,
        reason: "Runtime stop was requested."
      });
      console.log(`Stopped runtime for ${pair.pairId}.`);
    }
    logger.write({ time: stoppedAt, type: "RUNTIME_STOPPED", reason: "Runtime shutdown was requested." });
  } finally {
    logger.close();
    store.close();
  }
}

async function runRuntimeStart(
  args: ParsedArgs,
  pairs: SessionPair[],
  store: RelayStore,
  logger: JsonLineSupervisorLogger
): Promise<void> {
  const browserLocks = new LockRegistry();
  const launcher = new LocalDesktopToolLauncher();
  const orchestrator = new RuntimeOrchestrator({
    pairs,
    store,
    logger,
    pollIntervalMs: args.pollIntervalMs,
    stuckAfterMs: args.stuckAfterMs,
    relay: args.relay,
    recoveryFor: (pair) => recoveryOptions(args, pair, launcher),
    adapterDefaults: {
      opencode: args.opencode,
      chatgpt: args.chatgpt,
      liveOpenCode: args.liveOpenCode,
      liveChatGPT: args.liveChatGPT,
      browserLocks
    },
    onReport: (report) => {
      console.log(`${report.pairId}  ${report.state}  ${report.observedAt}`);
      for (const relay of report.relays) {
        console.log(`  relay  ${relay.direction ?? ""}  ${relay.status}  ${relay.sourceMessage?.id ?? ""}`.trimEnd());
      }
    }
  });

  const shutdown = async () => {
    const status = orchestrator.getStatus();
    if (status.failed > 0) {
      process.exitCode = 1;
    }
    await orchestrator.shutdown();
    await launcher.shutdown();
  };

  let shuttingDown = false;
  let releaseBlock: () => void = () => undefined;
  const onSignal = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await shutdown();
    } finally {
      releaseBlock();
    }
  };

  const onSigint = () => { onSignal().catch(() => {}); };
  const onSigterm = () => { onSignal().catch(() => {}); };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    let startError: unknown;
    try {
      await orchestrator.startAll();
    } catch (error) {
      startError = error;
    }

    printRuntimeStatus(orchestrator.getStatus(), args.json);
    console.log("");

    if (startError) {
      await orchestrator.shutdown();
      await launcher.shutdown();
      throw new CliError(asMessage(startError));
    }

    await new Promise<void>((resolve) => {
      releaseBlock = resolve;
      if (shuttingDown) {
        resolve();
      }
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

function selectRuntimePairs(pairs: SessionPair[], args: ParsedArgs): SessionPair[] {
  if (args.all) {
    return pairs.filter((pair) => pair.enabled);
  }

  const ids = args.pairIds ?? [];
  const unknown = ids.filter((id) => !pairs.some((pair) => pair.pairId === id));
  if (unknown.length > 0) {
    throw new ConfigError(
      unknown.map((id) => `Unknown pairId "${id}". Check the configured pairs or use --all.`)
    );
  }
  return ids
    .map((id) => pairs.find((pair) => pair.pairId === id))
    .filter((pair): pair is SessionPair => pair !== undefined);
}

function runtimeStatusFromPersistence(pairs: SessionPair[], store: RelayStore) {
  const noopLogger = {
    write(): void {},
    close(): void {}
  };
  const orchestrator = new RuntimeOrchestrator({
    pairs,
    store,
    logger: noopLogger,
    perPairLogs: false
  });
  return orchestrator.getStatus();
}

function printRuntimeStatus(status: RuntimeStatusSummary, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          enabled: status.enabled,
          running: status.running,
          healthy: status.healthy,
          degraded: status.degraded,
          failed: status.failed,
          pairs: status.pairs
        },
        null,
        2
      )
    );
    return;
  }

  const header = ["pairId", "runtime", "supervisor", "worker", "planner", "lastObservedAt"];
  const rows = status.pairs.map((pair) => [
    pair.pairId,
    runtimeStateLabel(pair.runtimeState, pair.enabled),
    pair.supervisorState ?? "(none)",
    pair.worker,
    pair.planner,
    pair.lastObservedAt ?? ""
  ]);
  const widths = header.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index].length))
  );
  const formatRow = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("   ").trimEnd();

  console.log("runtime status");
  console.log(`enabled: ${status.enabled}  running: ${status.running}  healthy: ${status.healthy}  degraded: ${status.degraded}  failed: ${status.failed}`);
  console.log("");
  console.log(formatRow(header));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

function runtimeStateLabel(state: string, enabledThroughConfig: boolean): string {
  if (state === "STOPPED") {
    return enabledThroughConfig ? "STOPPED(enabled)" : "STOPPED(off)";
  }
  return state;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recoveryOptions(
  args: ParsedArgs,
  pair: SessionPair,
  launcher: LocalDesktopToolLauncher
): SupervisorRecoveryOptions | undefined {
  if (args.recoveryPolicy === undefined) {
    return undefined;
  }
  const browser = browserManagerFor(pair.planner.browser);
  return {
    policy: args.recoveryPolicy === "none" ? "none" : "safe",
    browser,
    maxAttempts: args.recoveryMaxAttempts,
    baseUrl: args.opencode.baseUrl ?? pair.worker.server?.baseUrl ?? process.env.AGENT_RELAY_OPENCODE_BASE_URL,
    startServerLauncher:
      args.recoveryPolicy === "safe"
        ? (repoPath, baseUrl) => launcher.startOpenCode({ repoPath, baseUrl })
        : undefined
  };
}

function formatOpenCodeSessions(sessions: OpenCodeSessionSummary[]): string {
  if (sessions.length === 0) {
    return "No OpenCode sessions found.";
  }

  return sessions
    .map((session) =>
      [
        session.sessionId,
        session.title ?? "(untitled)",
        session.repoPath ?? "(unknown repo)",
        session.updatedAt ? new Date(session.updatedAt).toISOString() : "(unknown updated time)"
      ].join("  ")
    )
    .join("\n");
}

function usage(): string {
  return [
    "Usage:",
    "npm run relay -- validate <pairId|--all> [--config <path>] [--live-opencode] [--live-chatgpt]",
    "npm run relay -- opencode health --opencode-url <url>",
    "npm run relay -- opencode list [--repo <path>] [--limit <n>] --opencode-url <url>",
    "npm run relay -- opencode status --opencode-url <url>",
    "npm run relay -- opencode create --repo <path> [--title <title>] --opencode-url <url>",
    "npm run relay -- bind-opencode <pairId> <sessionId> [--config <path>]",
    "npm run relay -- relay worker-to-planner <pairId> [--config <path>] [--opencode-url <url>] [--live-chatgpt] [--force] [--db <path>]",
    "npm run relay -- relay planner-to-worker <pairId> (--message <text>|--live-chatgpt) [--config <path>] [--opencode-url <url>] [--force] [--db <path>]",
    "npm run relay -- seed local-agent <pairId> [--config <path>] [--live-chatgpt]",
    "npm run relay -- state init [--db <path>]",
    "npm run relay -- state inspect [--db <path>]",
    "npm run relay -- state pair <pairId> [--db <path>]",
    "npm run relay -- state messages <pairId> [--json] [--db <path>]",
    "npm run relay -- supervise <pairId> [--once] [--json] [--config <path>] [--db <path>]",
    "npm run relay -- supervise <pairId> --watch [--relay] [--poll-interval <ms>] [--stuck-after <ms>] [--recovery <none|safe>] [--recovery-max-attempts <n>] [--config <path>] [--db <path>]",
    "npm run relay -- supervisor pause <pairId> [--db <path>]",
    "npm run relay -- supervisor resume <pairId> [--db <path>]",
    "npm run relay -- supervisor status <pairId> [--json] [--db <path>]",
    "npm run relay -- recovery status <pairId> [--json] [--db <path>]",
    "npm run relay -- recovery retry <pairId> [--json] [--recovery <none|safe>] [--recovery-max-attempts <n>] [--config <path>] [--db <path>]",
    "npm run relay -- browser status <pairId> [--config <path>]",
    "npm run relay -- browser start|stop <pairId> [--config <path>]    (managed browsers only)",
    "npm run relay -- runtime start --all|<pairIds...> [--relay] [--poll-interval <ms>] [--stuck-after <ms>] [--recovery <none|safe>] [--recovery-max-attempts <n>] [--config <path>] [--db <path>]",
    "npm run relay -- runtime status [--all|<pairIds...>] [--json] [--config <path>] [--db <path>]",
    "npm run relay -- runtime stop --all|<pairIds...> [--config <path>] [--db <path>]",
    "npm run relay -- model list --all|<pairId> [--config <path>]",
    "npm run relay -- model switch <pairId> <providerID/id> [--config <path>]",
    "npm run relay -- model fallback <pairId> <providerID/id> [--config <path>]",
    "npm run relay -- seed local-agent <pairId> [--config <path>] [--live-chatgpt]",
    "npm run relay -- prune [--config <path>] [--db <path>] [--force]"
  ].join("\n");
}

async function runModelCommand(args: ParsedArgs): Promise<void> {
  const config = await loadPairsConfig(args.configPath);
  const allPairs = config.pairs?.filter((pair) => pair.enabled) || [];

  // Resolve target pair
  let pair: SessionPair | undefined;
  if (args.all) {
    pair = allPairs[0]; // use first pair when --all
  } else if (args.pairId) {
    pair = allPairs.find((p) => p.pairId === args.pairId);
  }

  if (!pair) {
    if (args.subcommand === "list") {
      // list can show all pairs or require --all
      throw new ConfigError([
        "Usage: agent-relay model list [--all|--pairId <pairId>] [--config <path>]"
      ]);
    }
    throw new ConfigError([
      `PairId "${args.pairId}" not found. Use --all or specify a valid pairId.`
    ]);
  }

  const worker = new LiveOpenCodeAdapter(workerOptionsFromCli(pair, args));

  if (args.subcommand === "list") {
    const models = await worker.listModels();
    if (models.length === 0) {
      console.log("No models available on this OpenCode server.");
      return;
    }
    console.log(`Available models for ${pair.pairId}:`);
    for (const model of models) {
      const enabled = model.enabled !== false ? " (enabled)" : " (disabled)";
      console.log(`  ${model.providerID}/${model.id}${enabled}`);
      if (model.name) {
        console.log(`    Name: ${model.name}`);
      }
    }
    return;
  }

  if (args.subcommand === "switch") {
    if (!args.model) {
      throw new CliError("Usage: agent-relay model switch <pairId> <providerID/id> [--config <path>]");
    }
    const [provider, id] = args.model.split("/");
    if (!provider || !id) {
      throw new CliError("Model format should be providerID/id, e.g. openai/gpt-3.5-turbo");
    }
    await worker.switchSessionModel(pair.worker, { providerID: provider, id: id });
    console.log(`Worker model switched to ${provider}/${id} for ${pair.pairId}.`);
    console.log("Pair must be stopped and restarted for the change to take effect.");
    return;
  }

  if (args.subcommand === "fallback") {
    if (!args.model) {
      throw new CliError("Usage: agent-relay model fallback <pairId> <providerID/id> [--config <path>]");
    }
    const [provider, id] = args.model.split("/");
    if (!provider || !id) {
      throw new CliError("Model format should be providerID/id, e.g. anthropic/claude-3-5-sonnet");
    }
    // Stop the pair first (required for model switch per M8 design)
    const store = await openStore(args);
    try {
      await store.touchSupervisorState({ pairId: pair.pairId, paused: true });
      // Switch the worker model
      await worker.switchSessionModel(pair.worker, { providerID: provider, id: id });
      await store.touchSupervisorState({ pairId: pair.pairId, paused: false });
    } finally {
      store.close();
    }
    console.log(`Pair ${pair.pairId} supervision paused, model switched to ${provider}/${id}.`);
    console.log("Pair must be restarted for the change to take effect.");
    console.log("Use: agent-relay runtime start --all");
    return;
  }

  throw new CliError("Usage: agent-relay model <list|switch|fallback> <pairId> [--config <path>] [--model <provider/id>]");
}

async function runService(args: ParsedArgs): Promise<void> {
  if (args.subcommand !== "start") {
    throw new CliError("Usage: npm run relay -- service start [--config <path>] [--db <path>] [--port <port>] [--token <token>]");
  }
  const service = new HeadlessService({
    configPath: args.configPath,
    dbPath: args.dbPath,
    port: args.servicePort,
    token: args.serviceToken,
  });

  let shutdownPromise: Promise<void> | undefined;

  const shutdown = async () => {
    if (!shutdownPromise) {
      shutdownPromise = service.shutdown();
    }
    await shutdownPromise;
  };

  const onSigint = () => { shutdown().catch(() => {}); };
  const onSigterm = () => { shutdown().catch(() => {}); };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    await service.start();
    const port = args.servicePort ?? Number(process.env.RELAY_REMOTE_PORT ?? 8181);
    const host = process.env.RELAY_REMOTE_HOST ?? "127.0.0.1";
    console.log(`Headless service started on http://${host}:${port}`);

    // Keep the process alive until a shutdown signal arrives and completes
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (shutdownPromise) {
          shutdownPromise.then(() => {
            clearInterval(interval);
            resolve();
          }, () => {
            clearInterval(interval);
            resolve();
          });
        }
      }, 50);
    });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await shutdown();
  }
}
