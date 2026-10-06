import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OpenCodeDesktopStateError,
  openCodeDesktopStateDirectories,
  parseOpenCodeDesktopWindowState,
  scanOpenCodeDesktopActiveSession
} from "../src/adapters/opencode/desktop-state.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("OpenCode Desktop active session discovery", () => {
  it("extracts the recent active session and its metadata from window state", () => {
    const key = "sidecar\n/server/c2lkZWNhcg/session/ses_active123";
    expect(
      parseOpenCodeDesktopWindowState({
        "tabs.recent": JSON.stringify({ key }),
        "tabs.info": JSON.stringify({
          [key]: { title: "Agent Relay work", directory: "/Users/dev/agent-relay" }
        })
      })
    ).toEqual({
      sessionId: "ses_active123",
      title: "Agent Relay work",
      repoPath: "/Users/dev/agent-relay"
    });
  });

  it("rejects malformed, missing, and non-session recent-tab state", () => {
    expect(parseOpenCodeDesktopWindowState({ "tabs.recent": "{" })).toBeUndefined();
    expect(parseOpenCodeDesktopWindowState({ "tabs.recent": JSON.stringify({ key: "/settings" }) })).toBeUndefined();
    expect(parseOpenCodeDesktopWindowState({})).toBeUndefined();
  });

  it("scans the newest compatible OpenCode window state file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-opencode-state-"));
    tempDirs.push(directory);
    const key = "sidecar\n/server/c2lkZWNhcg/session/ses_current";
    await writeFile(join(directory, "opencode.window.test.dat"), JSON.stringify({
      "tabs.recent": JSON.stringify({ key }),
      "tabs.info": JSON.stringify({ [key]: { title: "Current", directory: "/repo/current" } })
    }));

    await expect(
      scanOpenCodeDesktopActiveSession({ stateDirectories: [directory], isRunning: async () => true })
    ).resolves.toEqual({ sessionId: "ses_current", title: "Current", repoPath: "/repo/current" });
  });

  it("requires the desktop app to be running and an active session to be selected", async () => {
    await expect(
      scanOpenCodeDesktopActiveSession({ stateDirectories: [], isRunning: async () => false })
    ).rejects.toMatchObject({ code: "OPENCODE_DESKTOP_NOT_RUNNING" });
    await expect(
      scanOpenCodeDesktopActiveSession({ stateDirectories: [], isRunning: async () => true })
    ).rejects.toMatchObject({ code: "OPENCODE_DESKTOP_SESSION_NOT_FOUND" });
    expect(new OpenCodeDesktopStateError("OPENCODE_DESKTOP_SESSION_NOT_FOUND", "missing").message).toBe("missing");
  });

  it("resolves stable platform-specific OpenCode state directories", () => {
    expect(openCodeDesktopStateDirectories("darwin", {}, "/Users/me")[0]).toBe(
      "/Users/me/Library/Application Support/ai.opencode.desktop"
    );
    expect(openCodeDesktopStateDirectories("linux", { XDG_CONFIG_HOME: "/config" }, "/home/me")[0]).toBe(
      "/config/ai.opencode.desktop"
    );
    expect(openCodeDesktopStateDirectories("win32", { APPDATA: "C:\\Data" }, "C:\\Users\\me")[0]).toContain(
      "ai.opencode.desktop"
    );
  });
});
