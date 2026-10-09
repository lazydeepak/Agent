/**
 * Agent-relay codebase — module explanation / info.
 * File: src/cli-args.ts
 * Purpose: CLI argument parsing schema.
 */
import { isRecoveryPolicy } from "./recovery/index.js";
import type { ChatGPTBrowserConfig, OpenCodeServerConfig } from "./types.js";

/** CLI usage errors. Surfaced to the caller as a clean message without a stack. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export interface ParsedArgs {
  command?: string;
  subcommand?: string;
  pairId?: string;
  pairIds?: string[];
  sessionId?: string;
  all: boolean;
  force: boolean;
  json: boolean;
  watch: boolean;
  once: boolean;
  relay: boolean;
  configPath: string;
  dbPath?: string;
  liveOpenCode: boolean;
  liveChatGPT: boolean;
  repoPath?: string;
  title?: string;
  message?: string;
  limit?: number;
  pollIntervalMs?: number;
  stuckAfterMs?: number;
  recoveryPolicy?: string;
  recoveryMaxAttempts?: number;
  servicePort?: number;
  serviceToken?: string;
  opencode: OpenCodeServerConfig;
  chatgpt: ChatGPTBrowserConfig;
  model?: string;
}

export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    all: false,
    force: false,
    json: false,
    watch: false,
    once: false,
    relay: false,
    configPath: "config/pairs.example.json",
    liveOpenCode: false,
    liveChatGPT: false,
    opencode: {},
    chatgpt: {}
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--config") {
      const configPath = args[index + 1];
      if (!configPath) {
        throw new CliError("--config requires a file path.");
      }
      parsed.configPath = configPath;
      index += 1;
      continue;
    }

    if (arg === "--db") {
      const dbPath = args[index + 1];
      if (!dbPath) {
        throw new CliError("--db requires a file path.");
      }
      parsed.dbPath = dbPath;
      index += 1;
      continue;
    }

    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }

    if (arg === "--once") {
      parsed.once = true;
      continue;
    }

    if (arg === "--relay") {
      parsed.relay = true;
      continue;
    }

    if (arg === "--poll-interval") {
      parsed.pollIntervalMs = positiveInteger(args, index, "--poll-interval");
      index += 1;
      continue;
    }

    if (arg === "--stuck-after") {
      parsed.stuckAfterMs = positiveInteger(args, index, "--stuck-after");
      index += 1;
      continue;
    }

    if (arg === "--recovery") {
      const value = requiredValue(args, index, "--recovery");
      if (!isRecoveryPolicy(value)) {
        throw new CliError("--recovery must be one of: none, safe.");
      }
      parsed.recoveryPolicy = value;
      index += 1;
      continue;
    }

    if (arg === "--recovery-max-attempts") {
      parsed.recoveryMaxAttempts = positiveInteger(args, index, "--recovery-max-attempts");
      index += 1;
      continue;
    }

    if (arg === "--port") {
      parsed.servicePort = positiveInteger(args, index, "--port");
      index += 1;
      continue;
    }

    if (arg === "--token") {
      parsed.serviceToken = requiredValue(args, index, "--token");
      index += 1;
      continue;
    }

    if (arg === "--live-opencode") {
      parsed.liveOpenCode = true;
      continue;
    }

    if (arg === "--live-chatgpt") {
      parsed.liveChatGPT = true;
      continue;
    }

    if (arg === "--opencode-url") {
      parsed.opencode.baseUrl = requiredValue(args, index, "--opencode-url");
      index += 1;
      continue;
    }

    if (arg === "--opencode-username") {
      parsed.opencode.username = requiredValue(args, index, "--opencode-username");
      index += 1;
      continue;
    }

    if (arg === "--opencode-password") {
      parsed.opencode.password = requiredValue(args, index, "--opencode-password");
      index += 1;
      continue;
    }

    if (arg === "--opencode-password-env") {
      parsed.opencode.passwordEnv = requiredValue(args, index, "--opencode-password-env");
      index += 1;
      continue;
    }

    if (arg === "--chatgpt-cdp-url") {
      parsed.chatgpt.cdpUrl = requiredValue(args, index, "--chatgpt-cdp-url");
      index += 1;
      continue;
    }

    if (arg === "--chatgpt-executable") {
      parsed.chatgpt.executablePath = requiredValue(args, index, "--chatgpt-executable");
      index += 1;
      continue;
    }

    if (arg === "--chatgpt-profile") {
      parsed.chatgpt.userDataDir = requiredValue(args, index, "--chatgpt-profile");
      index += 1;
      continue;
    }

    if (arg === "--chatgpt-headless") {
      parsed.chatgpt.headless = true;
      continue;
    }

    if (arg === "--chatgpt-timeout") {
      const value = Number(requiredValue(args, index, "--chatgpt-timeout"));
      if (!Number.isInteger(value) || value < 1) {
        throw new CliError("--chatgpt-timeout must be a positive integer.");
      }
      parsed.chatgpt.timeoutMs = value;
      index += 1;
      continue;
    }

    if (arg === "--repo") {
      parsed.repoPath = requiredValue(args, index, "--repo");
      index += 1;
      continue;
    }

    if (arg === "--title") {
      parsed.title = requiredValue(args, index, "--title");
      index += 1;
      continue;
    }

    if (arg === "--model") {
      parsed.model = requiredValue(args, index, "--model");
      index += 1;
      continue;
    }

    if (arg === "--message") {
      parsed.message = requiredValue(args, index, "--message");
      index += 1;
      continue;
    }

    if (arg === "--limit") {
      const value = Number(requiredValue(args, index, "--limit"));
      if (!Number.isInteger(value) || value < 1) {
        throw new CliError("--limit must be a positive integer.");
      }
      parsed.limit = value;
      index += 1;
      continue;
    }

    if (arg === "--all") {
      parsed.all = true;
      continue;
    }

    if (!parsed.command) {
      parsed.command = arg;
      continue;
    }

    if (commandNeedsSubcommand(parsed.command) && !parsed.subcommand) {
      parsed.subcommand = arg;
      continue;
    }

    if (parsed.command === "runtime") {
      if (!parsed.pairIds) {
        parsed.pairIds = [];
      }
      parsed.pairIds.push(arg);
      continue;
    }

    if (!parsed.pairId) {
      parsed.pairId = arg;
      continue;
    }

    // `model switch|fallback <pairId> <providerID/id>`: the model is a positional argument.
    if (parsed.command === "model" && !parsed.model) {
      parsed.model = arg;
      continue;
    }

    if (!parsed.sessionId) {
      parsed.sessionId = arg;
      continue;
    }

    throw new CliError(`Unexpected argument: ${arg}`);
  }

  if (parsed.all && parsed.pairId) {
    throw new CliError("Choose either --all or a pairId, not both.");
  }

  if (parsed.command === "runtime" && parsed.all && (parsed.pairIds?.length ?? 0) > 0) {
    throw new CliError("Choose either --all or pairIds, not both.");
  }

  const runtimeSubcommands = ["start", "status", "stop"];
  if (
    parsed.command === "runtime" &&
    (parsed.subcommand === undefined || !runtimeSubcommands.includes(parsed.subcommand))
  ) {
    throw new CliError("Runtime command requires one of: start, status, stop.");
  }

  if (parsed.command === "runtime" && !parsed.all && (parsed.pairIds?.length ?? 0) === 0) {
    throw new CliError("Runtime command requires --all or at least one pairId.");
  }

  if (parsed.command === "validate" && !parsed.all && !parsed.pairId) {
    throw new CliError("Validation requires a pairId or --all.");
  }

  if (
    parsed.command === "relay" &&
    parsed.subcommand !== "worker-to-planner" &&
    parsed.subcommand !== "planner-to-worker"
  ) {
    throw new CliError("Relay command requires worker-to-planner or planner-to-worker.");
  }

  const stateSubcommand = ["init", "inspect", "pair", "messages", "attention", "ambiguous"];
  if (parsed.command === "state" && (parsed.subcommand === undefined || !stateSubcommand.includes(parsed.subcommand))) {
    throw new CliError("State command requires one of: init, inspect, pair, messages, attention, ambiguous.");
  }

  if (parsed.command === "state" && ["pair", "messages", "attention"].includes(parsed.subcommand ?? "") && !parsed.pairId) {
    throw new CliError(`State ${parsed.subcommand} requires a pairId.`);
  }

  if (parsed.command === "state" && parsed.subcommand === "init" && parsed.pairId) {
    throw new CliError("State init does not take a pairId.");
  }

  if (parsed.command === "relay" && !parsed.pairId) {
    throw new CliError("Usage: npm run relay -- relay <worker-to-planner|planner-to-worker> <pairId> [--config <path>]");
  }

  if (parsed.command === "seed" && parsed.subcommand !== "local-agent") {
    throw new CliError("Seed command requires the local-agent subcommand.");
  }

  if (parsed.command === "seed" && !parsed.pairId) {
    throw new CliError("Usage: npm run relay -- seed local-agent <pairId> [--config <path>] [--live-chatgpt]");
  }

  const modelSubcommands = ["list", "switch", "fallback"];
  if (
    parsed.command === "model" &&
    (parsed.subcommand === undefined || !modelSubcommands.includes(parsed.subcommand))
  ) {
    throw new CliError("Usage: npm run relay -- model <list|switch|fallback> <pairId> [providerID/id] [--config <path>]");
  }

  if (parsed.command === "model" && !parsed.pairId && !parsed.all) {
    throw new CliError("Usage: npm run relay -- model <list|switch|fallback> <pairId> [providerID/id] [--config <path>]");
  }

  if (parsed.command === "model" && parsed.subcommand !== "list" && !parsed.model) {
    throw new CliError(
      `model ${parsed.subcommand} requires a model in providerID/id form, e.g. anthropic/claude-3-5-sonnet.`
    );
  }

  if (
    parsed.command === "relay" &&
    parsed.subcommand === "planner-to-worker" &&
    !parsed.message &&
    !parsed.liveChatGPT &&
    !hasChatGPTBrowserConfig(parsed.chatgpt)
  ) {
    throw new CliError(
      "Relay planner-to-worker requires --message <text> while ChatGPT is mocked, or --live-chatgpt for live reading."
    );
  }

  if (parsed.command === "opencode" && !parsed.subcommand) {
    throw new CliError("OpenCode command requires one of: health, list, status, create.");
  }

  if (parsed.command === "bind-opencode" && (!parsed.pairId || !parsed.sessionId)) {
    throw new CliError("Usage: npm run relay -- bind-opencode <pairId> <sessionId> [--config <path>]");
  }

  if (parsed.command === "supervise" && !parsed.pairId) {
    throw new CliError("Usage: npm run relay -- supervise <pairId> [--watch] [--relay] [--config <path>] [--db <path>]");
  }

  if (parsed.command === "supervise" && parsed.relay && !parsed.watch) {
    throw new CliError("--relay requires --watch. A one-shot supervise is read-only.");
  }

  if (parsed.command === "supervise" && parsed.watch && parsed.once) {
    throw new CliError("supervise --watch and --once must be used exclusively.");
  }

  const supervisorSubcommands = ["pause", "resume", "status"];
  if (
    parsed.command === "supervisor" &&
    (parsed.subcommand === undefined || !supervisorSubcommands.includes(parsed.subcommand))
  ) {
    throw new CliError("Supervisor command requires one of: pause, resume, status.");
  }

  if (parsed.command === "supervisor" && !parsed.pairId) {
    throw new CliError("Supervisor command requires a pairId.");
  }

  const recoverySubcommands = ["status", "retry"];
  if (
    parsed.command === "recovery" &&
    (parsed.subcommand === undefined || !recoverySubcommands.includes(parsed.subcommand))
  ) {
    throw new CliError("Recovery command requires one of: status, retry.");
  }

  if (parsed.command === "recovery" && !parsed.pairId) {
    throw new CliError("Recovery command requires a pairId.");
  }

  const browserSubcommands = ["status", "start", "stop"];
  if (
    parsed.command === "browser" &&
    (parsed.subcommand === undefined || !browserSubcommands.includes(parsed.subcommand))
  ) {
    throw new CliError("Browser command requires one of: status, start, stop.");
  }

  if (parsed.command === "browser" && !parsed.pairId) {
    throw new CliError("Browser command requires a pairId.");
  }

  if (parsed.command === "service" && (parsed.subcommand === undefined || parsed.subcommand !== "start")) {
    throw new CliError("Usage: npm run relay -- service start [--config <path>] [--db <path>] [--port <port>] [--token <token>]");
  }

  return parsed;
}

function commandNeedsSubcommand(command?: string): boolean {
  return (
    command === "opencode" ||
    command === "relay" ||
    command === "state" ||
    command === "seed" ||
    command === "supervisor" ||
    command === "recovery" ||
    command === "browser" ||
    command === "runtime" ||
    command === "model" ||
    command === "service"
  );
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new CliError(`${flag} requires a value.`);
  }
  return value;
}

function positiveInteger(args: string[], index: number, flag: string): number {
  const value = Number(requiredValue(args, index, flag));
  if (!Number.isInteger(value) || value < 1) {
    throw new CliError(`${flag} must be a positive integer.`);
  }
  return value;
}

export function hasChatGPTBrowserConfig(config?: ChatGPTBrowserConfig): boolean {
  return Boolean(config?.cdpUrl ?? config?.executablePath ?? config?.userDataDir);
}
