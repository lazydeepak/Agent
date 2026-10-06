export interface CliOptions {
  configPath: string;
  dbPath?: string;
  liveOpenCode?: boolean;
  liveChatGPT?: boolean;
  opencodeBaseUrl?: string;
  chatgptCdpUrl?: string;
  relay?: boolean;
}

export function parseCliOptions(args: string[]): CliOptions {

  const options: CliOptions = { configPath: "config/pairs.local.json" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[index + 1];
    if (arg === "--config" || arg === "-c") {
      options.configPath = next() ?? options.configPath;
      index += 1;
    } else if (arg === "--db") {
      options.dbPath = next();
      index += 1;
    } else if (arg === "--live-opencode") {
      options.liveOpenCode = true;
    } else if (arg === "--live-chatgpt") {
      options.liveChatGPT = true;
    } else if (arg === "--opencode-url") {
      options.opencodeBaseUrl = next();
      index += 1;
    } else if (arg === "--chatgpt-cdp-url") {
      options.chatgptCdpUrl = next();
      index += 1;
    } else if (arg === "--relay") {
      options.relay = true;
    }
  }
  return options;
}
