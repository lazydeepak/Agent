import { describe, expect, it } from "vitest";
import { findRunningInstances } from "../scripts/ensure-single-instance.mjs";

const PS = [
  "  PID  PPID COMMAND",
  "    1     0 /sbin/launchd",
  "  100     1 /Applications/OpenCode.app/Contents/MacOS/OpenCode",
  "  200     1 sh -c electron desktop-dist/desktop/main/index.js --relay",
  "  201   200 node ./node_modules/.bin/electron desktop-dist/desktop/main/index.js --relay",
  "  202   201 /Users/x/agent-relay/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron desktop-dist/desktop/main/index.js --relay",
  "  203   202 /Users/x/agent-relay/node_modules/electron/dist/Electron Helper.app/Contents/MacOS/Electron Helper --type=renderer --app-path=/Users/x/agent-relay/desktop-dist/desktop/main",
  "  300     1 sh -c node scripts/ensure-single-instance.mjs && electron desktop-dist/desktop/main/index.js --relay",
  "  301   300 node scripts/ensure-single-instance.mjs"
].join("\n");

describe("ensure-single-instance", () => {
  it("finds other dashboard instances", () => {
    expect(findRunningInstances(PS, 301)).toEqual([200, 201, 202]);
  });

  it("excludes its own process tree", () => {
    expect(findRunningInstances(PS, 300)).toEqual([200, 201, 202]);
    expect(findRunningInstances(PS, 201)).toEqual([300]);
    expect(findRunningInstances(PS, 202)).toEqual([300]);
  });

  it("ignores renderer helpers without the bundle entry", () => {
    expect(findRunningInstances(PS, 300)).not.toContain(203);
  });

  it("returns empty when no dashboard runs", () => {
    expect(findRunningInstances("  PID  PPID COMMAND\n    1     0 /sbin/launchd\n", 1)).toEqual([]);
  });

  it("parses wmic list output on Windows", () => {
    const wmic = [
      "CommandLine=",
      "ParentProcessId=0",
      "ProcessId=4",
      "",
      "CommandLine=C:\\app\\Electron.exe desktop-dist/desktop/main/index.js --relay",
      "ParentProcessId=100",
      "ProcessId=200",
      ""
    ].join("\r\n");
    expect(findRunningInstances({ format: "list", text: wmic }, 999)).toEqual([200]);
  });
});
