/** Agent-relay script — Type definitions for single-instance process-lock check. NEXT: build code index. */
export interface ProcessListOutput {
  format: "ps" | "list";
  text: string;
}

export function findRunningInstances(psOutput: string | ProcessListOutput, ownPid: number): number[];
