/** Agent-relay script — Manual persistence / SQLite test script. NEXT: build code index. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopApplicationService } from "./src/application/desktop-service.js";
import { ProjectPairService } from "./src/application/project-pair-service.js";
import { ControlPlaneAdapter } from "./src/application/control-plane-adapter.js";

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "agent-relay-persist-test-"));
  const configPath = join(directory, "pairs.json");
  const dbPath = join(directory, "test.sqlite");
  const projectPairsPath = join(directory, "projects.local.json");
  console.log("Test directory:", directory);

  // Step 1: Launch (init)
  const svc1 = new DesktopApplicationService({ configPath, dbPath });
  await svc1.init();
  const pps1 = new ProjectPairService({ configPath: projectPairsPath });
  const adapter1 = new ControlPlaneAdapter(svc1, pps1);

  // Step 2: Create Project
  const proj = await adapter1.dispatch({
    type: "createProjectPair",
    payload: {
      projectPairId: "tauri-test-project",
      worker: { repoPath: "/tauri/test/repo" },
      planner: { projectSlug: "g-p-tauri-test" },
    },
  });
  console.log("Project created:", proj);

  // Step 3: Create Pair under project
  const pairResult = await adapter1.dispatch({
    type: "createPair",
    payload: {
      pairId: "tauri-test-pair",
      worker: { sessionId: "tauri-ses-01", repoPath: "/tauri/test/repo" },
      planner: { conversationId: "tauri-conv", conversationUrl: "https://chatgpt.com/c/tauri-conv" },
      projectPairId: "tauri-test-project",
    },
  });
  console.log("Pair created:", pairResult);

  // Step 4: Confirm both appear in canonical status
  const status1 = await adapter1.dispatch({ type: "getStatus" });
  console.log("Status after creation:", JSON.stringify(status1, null, 2));

  const pairsBefore = await adapter1.dispatch({ type: "listPairs" });
  console.log("Pairs before restart:", JSON.stringify(pairsBefore, null, 2));

  // Step 5: Quit
  await svc1.shutdown();
  console.log("Service shut down.");

  // Step 6: Relaunch
  const svc2 = new DesktopApplicationService({ configPath, dbPath });
  await svc2.init();
  const pps2 = new ProjectPairService({ configPath: projectPairsPath });
  const adapter2 = new ControlPlaneAdapter(svc2, pps2);

  // Step 7: Confirm present
  const pairsAfter = await adapter2.dispatch({ type: "listPairs" });
  console.log("Pairs after restart:", JSON.stringify(pairsAfter, null, 2));

  const projAfter = await adapter2.dispatch({ type: "listProjectPairs" });
  console.log("Project pairs after restart:", JSON.stringify(projAfter, null, 2));

  const pairList = (pairsAfter as any)?.pairs ?? pairsAfter;
  const foundPair = pairList.find((p: any) => p.pairId === "tauri-test-pair");
  const projList = (projAfter as any)?.projectPairs ?? projAfter;
  const foundProj = projList.find((p: any) => p.projectPairId === "tauri-test-project");

  // Step 8: Confirm association
  if (foundPair && foundProj) {
    console.log("PERSISTENCE VERIFIED: Pair", foundPair.pairId, "exists with projectPairId", foundPair.projectPairId);
    if (foundPair.projectPairId === "tauri-test-project") {
      console.log("ISOLATION VERIFIED: Pair remains associated correctly with project.");
    } else {
      console.log("ISOLATION WARNING: Pair association changed:", foundPair.projectPairId);
    }
  } else {
    console.log("FAIL: Pair or project missing after restart.");
  }

  await svc2.shutdown();
  await rm(directory, { force: true, recursive: true }).catch(() => undefined);
}

main().catch((e) => {
  console.error("Persistence test error:", e);
  process.exit(1);
});
