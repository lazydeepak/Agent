import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDesktopService } from "./helpers.js";
import { DesktopApplicationService } from "../src/application/desktop-service.js";
import { ProjectPairService } from "../src/application/project-pair-service.js";
import { ControlPlaneAdapter } from "../src/application/control-plane-adapter.js";

const tempDirs: string[] = [];

async function cleanup() {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
}

async function makeAdapter(): Promise<{ adapter: ControlPlaneAdapter; service: DesktopApplicationService; projectPairService: ProjectPairService; configPath: string; cleanupDir: string }> {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-project-pair-baseline-"));
  tempDirs.push(directory);
  const configPath = join(directory, "pairs.json");
  const dbPath = join(directory, "test.sqlite");
  const projectPairsPath = join(directory, "projects.local.json");
  const svc = createTestDesktopService({ configPath, dbPath });
  await svc.init();
  const pps = new ProjectPairService({ configPath: projectPairsPath });
  const adapter = new ControlPlaneAdapter(svc, pps);
  return { adapter, service: svc, projectPairService: pps, configPath, cleanupDir: directory };
}

describe("TAURI_PROJECT_PAIR_BASELINE — control plane adapter", () => {
  it("creates and lists project pairs through dispatch", async () => {
    const { adapter, service, cleanupDir } = await makeAdapter();
    try {
      const created = await adapter.dispatch({
        type: "createProjectPair",
        payload: {
          worker: { repoPath: "/Users/test/repo" },
          planner: { projectSlug: "g-p-testslug" },
        },
      });
      expect(created).toBeDefined();
      expect((created as any).projectPairId).toBeDefined();
      expect((created as any).worker.repoPath).toBe("/Users/test/repo");

      const list = await adapter.dispatch({ type: "listProjectPairs" });
      const pairs = (list as any)?.projectPairs ?? list;
      expect(Array.isArray(pairs)).toBe(true);
      expect(pairs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await service.shutdown();
      await rm(cleanupDir, { force: true, recursive: true }).catch(() => undefined);
    }
  });

  it("creates a pair linked to a project pair", async () => {
    const { adapter, service, cleanupDir } = await makeAdapter();
    try {
      const proj = await adapter.dispatch({
        type: "createProjectPair",
        payload: {
          projectPairId: "test-proj-01",
          worker: { repoPath: "/Users/test/repo" },
          planner: { projectSlug: "g-p-testslug-01" },
        },
      });
      expect((proj as any).projectPairId).toBe("test-proj-01");

      const pairResult = await adapter.dispatch({
        type: "createPair",
        payload: {
          pairId: "test-pair-01",
          worker: { sessionId: "ses_01", repoPath: "/Users/test/repo" },
          planner: { conversationId: "conv_01", conversationUrl: "https://chatgpt.com/c/conv_01" },
          projectPairId: "test-proj-01",
        },
      });
      expect(pairResult).toBeDefined();
      expect((pairResult as any).pairId).toBe("test-pair-01");

      const pairs = await adapter.dispatch({ type: "listPairs" });
      const pairList = (pairs as any)?.pairs ?? pairs;
      expect(Array.isArray(pairList)).toBe(true);
      expect(pairList.length).toBeGreaterThanOrEqual(1);
      const found = pairList.find((p: any) => p.pairId === "test-pair-01");
      expect(found).toBeDefined();
      expect(found.projectPairId).toBe("test-proj-01");
    } finally {
      await service.shutdown();
      await rm(cleanupDir, { force: true, recursive: true }).catch(() => undefined);
    }
  });

  it("rejects invalid create pair payload", async () => {
    const { adapter, service, cleanupDir } = await makeAdapter();
    try {
      await expect(adapter.dispatch({ type: "createPair", payload: { pairId: "" } })).rejects.toThrow();
    } finally {
      await service.shutdown();
      await rm(cleanupDir, { force: true, recursive: true }).catch(() => undefined);
    }
  });

  it("persists project pairs across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-persist-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "persist.sqlite");
    const projectPairsPath = join(directory, "projects.local.json");

    const svc1 = createTestDesktopService({ configPath, dbPath });
    await svc1.init();
    const pps1 = new ProjectPairService({ configPath: projectPairsPath });
    const adapter1 = new ControlPlaneAdapter(svc1, pps1);

    await adapter1.dispatch({
      type: "createProjectPair",
      payload: { projectPairId: "persist-proj", worker: { repoPath: "/persist/repo" }, planner: { projectSlug: "g-p-persist" } },
    });
    await svc1.shutdown();

    const svc2 = createTestDesktopService({ configPath, dbPath });
    await svc2.init();
    const pps2 = new ProjectPairService({ configPath: projectPairsPath });
    const adapter2 = new ControlPlaneAdapter(svc2, pps2);

    const list = await adapter2.dispatch({ type: "listProjectPairs" });
    const pairs = (list as any)?.projectPairs ?? list;
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    const found = pairs.find((p: any) => p.projectPairId === "persist-proj");
    expect(found).toBeDefined();

    await svc2.shutdown();
    await rm(directory, { force: true, recursive: true }).catch(() => undefined);
  });
});
