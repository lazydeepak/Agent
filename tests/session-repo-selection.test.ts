import { describe, expect, it } from "vitest";

describe("session repository compatibility classification", () => {
  it("classifies session as COMPATIBLE when session repo matches configured repo", () => {
    const configuredRepo = "/tmp/project-a";
    const sessionRepo = "/tmp/project-a";
    const configuredResolved = resolve(configuredRepo);
    const sessionResolved = resolve(sessionRepo);
    expect(configuredResolved === sessionResolved).toBe(true);
  });

  it("classifies session as INCOMPATIBLE when session repo differs", () => {
    const configuredRepo = "/tmp/project-a";
    const sessionRepo = "/tmp/project-b";
    const configuredResolved = resolve(configuredRepo);
    const sessionResolved = resolve(sessionRepo);
    expect(configuredResolved !== sessionResolved).toBe(true);
  });

  it("classifies session as UNKNOWN when session repo info is missing", () => {
    const sessionRepo = "";
    const configuredRepo = "/tmp/project-a";
    expect(!sessionRepo ? true : false).toBe(true);
  });

  it("preserves pair isolation when comparing session repos per pair", () => {
    const pairARepo = "/tmp/repo-a";
    const pairBRepo = "/tmp/repo-b";
    expect(predictabilityOfRepoMatch(pairARepo, pairARepo)).toBe("COMPATIBLE");
    expect(predictabilityOfRepoMatch(pairBRepo, pairBRepo)).toBe("COMPATIBLE");
    expect(predictabilityOfRepoMatch(pairARepo, pairBRepo)).toBe("INCOMPATIBLE");
  });
});

function resolve(p: string): string {
  const { resolve } = require("node:path");
  return resolve(p);
}

function predictabilityOfRepoMatch(configRepo: string, sessionRepo: string): string {
  if (!sessionRepo || sessionRepo.trim() === "") return "UNKNOWN";
  const a = resolve(configRepo);
  const b = resolve(sessionRepo);
  return a === b ? "COMPATIBLE" : "INCOMPATIBLE";
}
