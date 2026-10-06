import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDesktopService } from "./helpers.js";
import { ProjectPairService } from "../src/application/project-pair-service.js";
import { ControlPlaneAdapter } from "../src/application/control-plane-adapter.js";

const tempDirs: string[] = [];

async function cleanup() {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
}

describe("TAURI_PROJECT_PAIR_MANAGEMENT — persistence and isolation", () => {
  it("project edit persists across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-edit-project-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "edit.sqlite");
    const projectPairsPath = join(directory, "projects.local.json");

    const svc1 = createTestDesktopService({ configPath, dbPath });
    await svc1.init();
    const adapter1 = new ControlPlaneAdapter(svc1, new ProjectPairService({ configPath: projectPairsPath }));

    await adapter1.dispatch({ type: "createProjectPair", payload: { projectPairId: "persist-edit-proj", worker: { repoPath: "/repo/edit" }, planner: { projectSlug: "g-p-edit" } } });
    await adapter1.dispatch({ type: "updateProjectPair", payload: { projectPairId: "persist-edit-proj", planner: { projectName: "Edited Name" } } });
    await svc1.shutdown();

    const svc2 = createTestDesktopService({ configPath, dbPath });
    await svc2.init();
    const adapter2 = new ControlPlaneAdapter(svc2, new ProjectPairService({ configPath: projectPairsPath }));
    const pairs = await adapter2.dispatch({ type: "listProjectPairs" }) as any[];
    const found = pairs.find((p: any) => p.projectPairId === "persist-edit-proj");
    expect(found?.planner?.projectName).toBe("Edited Name");
    await svc2.shutdown();
    await rm(directory, { force: true, recursive: true }).catch(() => undefined);
  });

  it("pair edit persists across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-edit-pair-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "edit-pair.sqlite");

    const svc1 = createTestDesktopService({ configPath, dbPath });
    await svc1.init();
    const adapter1 = new ControlPlaneAdapter(svc1, new ProjectPairService({ configPath: join(directory, "projects.local.json") }));

    await adapter1.dispatch({ type: "createPair", payload: { pairId: "persist-edit-pair", worker: { sessionId: "s1", repoPath: "/repo/edit" }, planner: { conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" } } });
    await adapter1.dispatch({ type: "updatePair", payload: { pairId: "persist-edit-pair", enabled: false } });
    await svc1.shutdown();

    const svc2 = createTestDesktopService({ configPath, dbPath });
    await svc2.init();
    const adapter2 = new ControlPlaneAdapter(svc2, new ProjectPairService({ configPath: join(directory, "projects.local.json") }));
    const detail = await adapter2.dispatch({ type: "getPair", payload: { pairId: "persist-edit-pair" } }) as any;
    expect(detail?.enabled).toBe(false);
    await svc2.shutdown();
    await rm(directory, { force: true, recursive: true }).catch(() => undefined);
  });

  it("archive project does not destroy unrelated pairs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-archive-isolation-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "archive.sqlite");
    const projectPairsPath = join(directory, "projects.local.json");

    const svc = createTestDesktopService({ configPath, dbPath });
    await svc.init();
    const adapter = new ControlPlaneAdapter(svc, new ProjectPairService({ configPath: projectPairsPath }));

    await adapter.dispatch({ type: "createProjectPair", payload: { projectPairId: "archive-proj-a", worker: { repoPath: "/repo/a" }, planner: { projectSlug: "g-p-a" } } });
    await adapter.dispatch({ type: "createProjectPair", payload: { projectPairId: "archive-proj-b", worker: { repoPath: "/repo/b" }, planner: { projectSlug: "g-p-b" } } });
    await adapter.dispatch({ type: "archiveProjectPair", payload: { projectPairId: "archive-proj-a" } });

    const remaining = await adapter.dispatch({ type: "listProjectPairs" }) as any[];
    const names = remaining.map((p: any) => p.projectPairId);
    expect(names).not.toContain("archive-proj-a");
    expect(names).toContain("archive-proj-b");

    await svc.shutdown();
    await rm(directory, { force: true, recursive: true }).catch(() => undefined);
  });

  it("pair archive (removePair) preserves isolation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-pair-archive-"));
    tempDirs.push(directory);
    const configPath = join(directory, "pairs.json");
    const dbPath = join(directory, "pair-archive.sqlite");

    const svc = createTestDesktopService({ configPath, dbPath });
    await svc.init();
    const adapter = new ControlPlaneAdapter(svc, new ProjectPairService({ configPath: join(directory, "projects.local.json") }));

    await adapter.dispatch({ type: "createPair", payload: { pairId: "archive-pair-1", worker: { sessionId: "s1", repoPath: "/repo/one" }, planner: { conversationId: "c1", conversationUrl: "https://chatgpt.com/c/c1" } } });
    await adapter.dispatch({ type: "createPair", payload: { pairId: "archive-pair-2", worker: { sessionId: "s2", repoPath: "/repo/two" }, planner: { conversationId: "c2", conversationUrl: "https://chatgpt.com/c/c2" } } });
    await adapter.dispatch({ type: "archivePair", payload: { pairId: "archive-pair-1" } });

    const pairs = await adapter.dispatch({ type: "listPairs" }) as any[];
    expect(pairs.some((p: any) => p.pairId === "archive-pair-1")).toBe(false);
    expect(pairs.some((p: any) => p.pairId === "archive-pair-2")).toBe(true);

    await svc.shutdown();
    await rm(directory, { force: true, recursive: true }).catch(() => undefined);
  });
});
