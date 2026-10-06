import { describe, expect, it } from "vitest";
import { parseCliOptions } from "../desktop/main/cli-options.js";

describe("desktop CLI options parsing", () => {
  it("parses flag-value pairs and boolean flags", () => {
    const options = parseCliOptions([
      "--config", "config/custom.json",
      "--db", "data/custom.sqlite",
      "--live-opencode",
      "--relay"
    ]);
    expect(options).toEqual({
      configPath: "config/custom.json",
      dbPath: "data/custom.sqlite",
      liveOpenCode: true,
      relay: true
    });
  });

  it("supports -c as a config alias", () => {
    expect(parseCliOptions(["-c", "other.json"]).configPath).toBe("other.json");
  });

  it("defaults the config path to pairs.local.json", () => {
    const options = parseCliOptions([]);
    expect(options.configPath).toBe("config/pairs.local.json");
    expect(options.relay).toBeUndefined();
    expect(options.liveOpenCode).toBeUndefined();
  });
});