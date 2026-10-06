import type { PairReadinessReport } from "../types.js";

export function formatReadinessReport(results: PairReadinessReport[]): string {
  return results.map(formatPairReadinessReport).join("\n\n");
}

export function formatPairReadinessReport(result: PairReadinessReport): string {
  // Format each check: PASS shows just the status, FAIL includes the reason indented
  const checkLines = result.checks.flatMap((check) => {
    const line = `${check.name.padEnd(30)} ${check.status}`;
    return check.status === "PASS" ? [line] : [line, `  ${check.reason}`];
  });

  return [`${result.pairId}  ${result.status}`, "", ...checkLines].join("\n");
}
