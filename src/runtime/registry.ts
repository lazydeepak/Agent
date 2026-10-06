import type { SessionPair } from "../types.js";

export class RegistryError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid runtime registry:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "RegistryError";
    this.issues = issues;
  }
}

export class PairRegistry {
  private readonly pairs = new Map<string, SessionPair>();

  constructor(pairs: SessionPair[] = []) {
    for (const pair of pairs) {
      this.add(pair);
    }
  }

  add(pair: SessionPair): void {
    validateUnique(pair.pairId, pair.worker.sessionId, pair.planner.conversationId, this.pairs);
    this.pairs.set(pair.pairId, pair);
  }

  remove(pairId: string): SessionPair | undefined {
    const pair = this.pairs.get(pairId);
    if (pair) {
      this.pairs.delete(pairId);
    }
    return pair;
  }

  get(pairId: string): SessionPair | undefined {
    return this.pairs.get(pairId);
  }

  has(pairId: string): boolean {
    return this.pairs.has(pairId);
  }

  list(): SessionPair[] {
    return [...this.pairs.values()].sort((a, b) => a.pairId.localeCompare(b.pairId));
  }

  enabled(): SessionPair[] {
    return this.list().filter((pair) => pair.enabled);
  }

  get size(): number {
    return this.pairs.size;
  }
}

export function validateUnique(
  pairId: string,
  sessionId: string,
  conversationId: string,
  existing: ReadonlyMap<string, SessionPair>
): void {
  for (const pair of existing.values()) {
    if (pair.worker.sessionId === sessionId) {
      throw new RegistryError([
        `Duplicate OpenCode session ownership "${sessionId}". Runtime pair "${pairId}" conflicts with pair "${pair.pairId}". One OpenCode session can belong to only one enabled pair.`
      ]);
    }
    if (pair.planner.conversationId === conversationId) {
      throw new RegistryError([
        `Duplicate ChatGPT conversation ownership "${conversationId}". Runtime pair "${pairId}" conflicts with pair "${pair.pairId}". One ChatGPT conversation can belong to only one enabled pair.`
      ]);
    }
  }
}