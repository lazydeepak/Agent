export interface ProcessListOutput {
  format: "ps" | "list";
  text: string;
}

export function findRunningInstances(psOutput: string | ProcessListOutput, ownPid: number): number[];
