import { describe, expect, it } from "vitest";
import { parseProjectPairsConfig } from "../src/sessions/project-pairs.js";

describe("project pairs config: worker/planner keys", () => {
  it("normalizes the legacy opencode/chatgpt keys to worker/planner", () => {
    const parsed = parseProjectPairsConfig({
      projectPairs: [
        {
          projectPairId: "local-dev",
          opencode: { repoPath: "/tmp/repo", projectId: "proj-1" },
          chatgpt: { projectSlug: "g-p-abc123", projectName: "Legacy name" }
        }
      ]
    });
    expect(parsed.projectPairs[0]).toEqual({
      projectPairId: "local-dev",
      worker: { repoPath: "/tmp/repo", projectId: "proj-1" },
      planner: { projectSlug: "g-p-abc123", projectName: "Legacy name" }
    });
  });

  it("accepts the neutral worker/planner keys", () => {
    const parsed = parseProjectPairsConfig({
      projectPairs: [
        {
          projectPairId: "local-dev",
          worker: { repoPath: "/tmp/repo" },
          planner: { projectSlug: "g-p-abc123" }
        }
      ]
    });
    expect(parsed.projectPairs[0]?.worker.repoPath).toBe("/tmp/repo");
    expect(parsed.projectPairs[0]?.planner.projectSlug).toBe("g-p-abc123");
  });

  it("rejects a pair without a worker or planner block", () => {
    expect(() =>
      parseProjectPairsConfig({ projectPairs: [{ projectPairId: "local-dev", planner: { projectSlug: "g-p-a1" } }] })
    ).toThrow(/worker repoPath is required/);
    expect(() =>
      parseProjectPairsConfig({ projectPairs: [{ projectPairId: "local-dev", worker: { repoPath: "/tmp/repo" } }] })
    ).toThrow(/planner projectSlug is required/);
  });

  it("rejects duplicate worker ownership written with mixed key spellings", () => {
    expect(() =>
      parseProjectPairsConfig({
        projectPairs: [
          { projectPairId: "a", worker: { repoPath: "/tmp/repo" }, planner: { projectSlug: "g-p-aaaa" } },
          { projectPairId: "b", opencode: { repoPath: "/tmp/repo" }, chatgpt: { projectSlug: "g-p-bbbb" } }
        ]
      })
    ).toThrow(/Duplicate worker project ownership/);
  });
});
