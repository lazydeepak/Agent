// Regression: proposalData must be defined and wired, not left undefined
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
const app = readFileSync("tauri-client/src/App.tsx", "utf8");
describe("proposalData regression", () => {
  it("has proposalData state", () => {
    expect(app).toContain('const [proposalData, setProposalData]');
  });
  it("has handleApprove and handleReject", () => {
    expect(app).toContain("handleApprove");
    expect(app).toContain("handleReject");
  });
  it("uses proposalData in render", () => {
    expect(app).toContain("proposalData.length");
  });
});
