import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, bindOpenCodeSession, loadPairsConfig, parsePairsConfig } from "../src/sessions/pairs.js";
import { makePair } from "./helpers.js";

const tempDirs: string[] = [];

describe("parsePairsConfig", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  it("accepts the canonical session-pair schema", () => {
    const config = parsePairsConfig({ pairs: [makePair()] });

    expect(config.pairs[0]).toMatchObject({
      pairId: "kisab-main",
      enabled: true,
      worker: {
        type: "opencode",
        sessionId: "ses_worker_1",
        repoPath: "/Users/lazydeepak/dev/kisab"
      },
      planner: {
        type: "chatgpt-browser",
        conversationId: "planner-conversation-1",
        conversationUrl: "https://chatgpt.com/c/planner-conversation-1"
      }
    });
  });

  it("rejects missing required config", () => {
    expect(() =>
      parsePairsConfig({
        pairs: [
          {
            pairId: "kisab-main",
            enabled: true,
            worker: {
              type: "opencode",
              sessionId: "ses_worker_1"
            },
            planner: {
              type: "chatgpt-browser",
              conversationId: "planner-conversation-1",
              conversationUrl: "https://chatgpt.com/c/planner-conversation-1"
            }
          }
        ]
      })
    ).toThrow(/worker.repoPath/i);
  });

  it("rejects unsupported adapter types", () => {
    expect(() =>
      parsePairsConfig({
        pairs: [
          makePair({
            worker: {
              type: "shell" as "opencode",
              sessionId: "ses_worker_1",
              repoPath: "/Users/lazydeepak/dev/kisab"
            }
          })
        ]
      })
    ).toThrow(/Worker type must be one of: opencode/);
  });

  it("rejects malformed pair IDs", () => {
    expect(() => parsePairsConfig({ pairs: [makePair({ pairId: "Kisab Main" })] })).toThrow(
      /pairId must use lowercase/
    );
  });

  it("rejects duplicate pair IDs", () => {
    expect(() =>
      parsePairsConfig({
        pairs: [
          makePair(),
          makePair({
            worker: {
              type: "opencode",
              sessionId: "ses_worker_2",
              repoPath: "/Users/lazydeepak/dev/other"
            },
            planner: {
              type: "chatgpt-browser",
              conversationId: "planner-conversation-2",
              conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
            }
          })
        ]
      })
    ).toThrow(/Duplicate pairId "kisab-main"/);
  });

  it("rejects duplicate OpenCode session ownership", () => {
    expect(() =>
      parsePairsConfig({
        pairs: [
          makePair(),
          makePair({
            pairId: "kisab-secondary",
            planner: {
              type: "chatgpt-browser",
              conversationId: "planner-conversation-2",
              conversationUrl: "https://chatgpt.com/c/planner-conversation-2"
            }
          })
        ]
      })
    ).toThrow(/Duplicate OpenCode session ownership "ses_worker_1"/);
  });

  it("rejects duplicate ChatGPT conversation ownership", () => {
    expect(() =>
      parsePairsConfig({
        pairs: [
          makePair(),
          makePair({
            pairId: "kisab-secondary",
            worker: {
              type: "opencode",
              sessionId: "ses_worker_2",
              repoPath: "/Users/lazydeepak/dev/other"
            }
          })
        ]
      })
    ).toThrow(/Duplicate ChatGPT conversation ownership "planner-conversation-1"/);
  });

  it("rejects mismatched configured and URL-derived ChatGPT conversation IDs", () => {
    expect(() =>
      parsePairsConfig({
        pairs: [
          makePair({
            planner: {
              type: "chatgpt-browser",
              conversationId: "planner-conversation-1",
              conversationUrl: "https://chatgpt.com/c/different-conversation"
            }
          })
        ]
      })
    ).toThrow(/does not match conversationUrl id "different-conversation"/);
  });

  it("accepts an empty pairs config as a valid configuration", () => {
    const config = parsePairsConfig({ pairs: [] });
    expect(config).toEqual({ pairs: [] });
  });

  it("raises explicit configuration errors for a malformed shape", () => {
    try {
      parsePairsConfig({ n: 5 });
      throw new Error("Expected config parsing to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues[0]).toMatch(/n|pairs/i);
    }
  });

  it("accepts optional live OpenCode server settings", () => {
    const config = parsePairsConfig({
      pairs: [
        makePair({
          worker: {
            type: "opencode",
            sessionId: "ses_worker_1",
            repoPath: "/Users/lazydeepak/dev/kisab",
            server: {
              baseUrl: "http://127.0.0.1:4096",
              username: "opencode",
              passwordEnv: "OPENCODE_SERVER_PASSWORD"
            }
          }
        })
      ]
    });

    expect(config.pairs[0]?.worker.server?.baseUrl).toBe("http://127.0.0.1:4096");
  });

  it("accepts optional live ChatGPT browser settings", () => {
    const config = parsePairsConfig({
      pairs: [
        makePair({
          planner: {
            type: "chatgpt-browser",
            conversationId: "planner-conversation-1",
            conversationUrl: "https://chatgpt.com/c/planner-conversation-1",
            browser: {
              cdpUrl: "http://127.0.0.1:9222",
              userDataDir: "/Users/lazydeepak/.agent-relay/chatgpt-profile",
              timeoutMs: 10000
            }
          }
        })
      ]
    });

    expect(config.pairs[0]?.planner.browser?.cdpUrl).toBe("http://127.0.0.1:9222");
  });

  it("normalizes trailing slashes on endpoints so pairs on one server match locks", () => {
    const config = parsePairsConfig({
      pairs: [
        makePair({
          pairId: "a",
          worker: {
            type: "opencode",
            sessionId: "s_a",
            repoPath: "/Users/x/a",
            server: { baseUrl: "http://127.0.0.1:4096/" }
          },
          planner: {
            type: "chatgpt-browser",
            conversationId: "c_a",
            conversationUrl: "https://chatgpt.com/c/c_a",
            browser: { cdpUrl: "http://127.0.0.1:9222/" }
          }
        })
      ]
    });

    expect(config.pairs[0]?.worker.server?.baseUrl).toBe("http://127.0.0.1:4096");
    expect(config.pairs[0]?.planner.browser?.cdpUrl).toBe("http://127.0.0.1:9222");
  });

  it("rejects pairs that share an OpenCode endpoint but disagree on credentials", () => {
    expect(() =>
      parsePairsConfig({
        pairs: [
          makePair({
            pairId: "a",
            worker: {
              type: "opencode",
              sessionId: "s_a",
              repoPath: "/Users/x/a",
              server: {
                baseUrl: "http://127.0.0.1:4096",
                username: "opencode",
                passwordEnv: "OPENCODE_SERVER_PASSWORD"
              }
            }
          }),
          makePair({
            pairId: "b",
            worker: {
              type: "opencode",
              sessionId: "s_b",
              repoPath: "/Users/x/b",
              server: { baseUrl: "http://127.0.0.1:4096/" }
            }
          })
        ]
      })
    ).toThrow(ConfigError);
  });

  it("accepts pairs that share an OpenCode endpoint with consistent credentials", () => {
    const config = parsePairsConfig({
      pairs: [
        makePair({
          pairId: "a",
          worker: {
            type: "opencode",
            sessionId: "s_a",
            repoPath: "/Users/x/a",
            server: {
              baseUrl: "http://127.0.0.1:4096",
              username: "opencode",
              passwordEnv: "OPENCODE_SERVER_PASSWORD"
            }
          }
        }),
        makePair({
          pairId: "b",
          worker: {
            type: "opencode",
            sessionId: "s_b",
            repoPath: "/Users/x/b",
            server: {
              baseUrl: "http://127.0.0.1:4096/",
              username: "opencode",
              passwordEnv: "OPENCODE_SERVER_PASSWORD"
            }
          },
          planner: {
            type: "chatgpt-browser",
            conversationId: "c_b",
            conversationUrl: "https://chatgpt.com/c/c_b"
          }
        })
      ]
    });

    expect(config.pairs).toHaveLength(2);
    expect(config.pairs.map((pair) => pair.worker.server?.baseUrl)).toEqual([
      "http://127.0.0.1:4096",
      "http://127.0.0.1:4096"
    ]);
  });

  it("accepts persisted planner automation kickoff metadata", () => {
    const config = parsePairsConfig({
      pairs: [
        makePair({
          planner: {
            type: "chatgpt-browser",
            conversationId: "planner-conversation-1",
            conversationUrl: "https://chatgpt.com/c/planner-conversation-1",
            automation: { promptVersion: "1", seededAt: "2026-09-01T12:00:00.000Z" }
          }
        })
      ]
    });
    expect(config.pairs[0]?.planner.automation?.promptVersion).toBe("1");
  });

  it("loads an empty pairs config from disk without a schema failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-config-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    await writeFile(configPath, `${JSON.stringify({ pairs: [] })}\n`, "utf8");

    const config = await loadPairsConfig(configPath);
    expect(config.pairs).toEqual([]);
  });

  it("binds a pair to a new OpenCode session in the config file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-config-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    await writeFile(configPath, JSON.stringify({ pairs: [makePair()] }), "utf8");

    await bindOpenCodeSession(configPath, "kisab-main", "ses_worker_2");

    const written = JSON.parse(await readFile(configPath, "utf8")) as {
      pairs: Array<{ worker: { sessionId: string } }>;
    };
    expect(written.pairs[0]?.worker.sessionId).toBe("ses_worker_2");
  });
});
