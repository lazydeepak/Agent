import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("cli argument parsing: model command", () => {
  it("reads the model as a positional argument", () => {
    const parsed = parseArgs(["model", "switch", "local-dev", "anthropic/claude-3-5-sonnet"]);
    expect(parsed.command).toBe("model");
    expect(parsed.subcommand).toBe("switch");
    expect(parsed.pairId).toBe("local-dev");
    expect(parsed.model).toBe("anthropic/claude-3-5-sonnet");
  });

  it("reads the model from --model", () => {
    const parsed = parseArgs(["model", "fallback", "local-dev", "--model", "openai/gpt-4o"]);
    expect(parsed.subcommand).toBe("fallback");
    expect(parsed.model).toBe("openai/gpt-4o");
  });

  it("rejects a missing model for switch and fallback", () => {
    expect(() => parseArgs(["model", "switch", "local-dev"])).toThrow(/requires a model/);
    expect(() => parseArgs(["model", "fallback", "local-dev"])).toThrow(/requires a model/);
  });

  it("rejects an unknown model subcommand or missing pair", () => {
    expect(() => parseArgs(["model", "explode", "local-dev"])).toThrow(/Usage: npm run relay -- model/);
    expect(() => parseArgs(["model", "switch", "--model", "openai/gpt-4o"])).toThrow(
      /Usage: npm run relay -- model/
    );
  });

  it("allows model list with --all", () => {
    const parsed = parseArgs(["model", "list", "--all"]);
    expect(parsed.subcommand).toBe("list");
    expect(parsed.all).toBe(true);
  });
});
