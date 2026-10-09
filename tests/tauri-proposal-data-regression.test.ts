// Regression: proposalData must be defined and wired, not left undefined
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";

const tauriPath = "tauri-client/src/App.tsx";
const tauriClientExists = existsSync(tauriPath);
const app = tauriClientExists ? readFileSync(tauriPath, "utf8") : "";

describe("proposalData regression", () => {
  it.skipIf(!tauriClientExists)("has proposalData state", () => {
    expect(app).toContain('const [proposalData, setProposalData]');
  });
  it.skipIf(!tauriClientExists)("has handleApprove and handleReject", () => {
    expect(app).toContain("handleApprove");
    expect(app).toContain("handleReject");
  });
  it.skipIf(!tauriClientExists)("uses proposalData in render", () => {
    expect(app).toContain("proposalData.length");
  });
});
