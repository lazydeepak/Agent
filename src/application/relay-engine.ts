/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/relay-engine.ts
 * Purpose: Source module for relay-engine.ts.
 */
import type { RuntimeOrchestrator, RuntimeStatusSummary } from "../runtime/index.js";
import type { RuntimePairStatus, SessionPair } from "../types.js";
import type { PlannerSeedingService } from "./planner-seeding-service.js";

export interface RelayEngineOptions {
  orchestrator: RuntimeOrchestrator | {
    getStatus(): RuntimeStatusSummary;
    getPairStatus?(pairId: string): RuntimePairStatus | undefined;
    startPair?(pairId: string): Promise<void>;
    stopPair?(pairId: string): Promise<void>;
    pausePair?(pairId: string): void;
    resumePair?(pairId: string): void;
    startAll?(): Promise<void>;
    stopAll?(): Promise<void>;
    shutdown?(): Promise<void>;
    reconfigurePairs?(candidatePairs: SessionPair[]): void;
    listPairs?(): SessionPair[];
  };
  plannerSeeding?: PlannerSeedingService;
}

export class RelayEngine {
  private readonly orchestrator: any;
  private plannerSeeding?: PlannerSeedingService;

  constructor(options: RelayEngineOptions) {
    this.orchestrator = options.orchestrator;
    this.plannerSeeding = options.plannerSeeding;
  }

  setPlannerSeeding(plannerSeeding: PlannerSeedingService): void {
    this.plannerSeeding = plannerSeeding;
  }

  getStatus(): RuntimeStatusSummary {
    return this.orchestrator.getStatus();
  }

  getPairStatus(pairId: string): RuntimePairStatus | undefined {
    return this.orchestrator.getPairStatus(pairId);
  }

  async startPair(pairId: string, priming?: any): Promise<void> {
    if (this.plannerSeeding) {
      if (priming) {
        await this.plannerSeeding.primePair(pairId, priming);
      } else if (this.plannerSeeding.requiresInitialPlannerHandoff(pairId)) {
        await this.plannerSeeding.primePair(pairId, "from-planner");
      }
    }
    return this.orchestrator.startPair(pairId);
  }

  async stopPair(pairId: string): Promise<void> {
    return this.orchestrator.stopPair(pairId);
  }

  pausePair(pairId: string): void {
    this.orchestrator.pausePair(pairId);
  }

  resumePair(pairId: string): void {
    this.orchestrator.resumePair(pairId);
  }

  async startAll(): Promise<void> {
    if (this.plannerSeeding) {
      for (const pair of this.orchestrator.listPairs().filter((p: SessionPair) => p.enabled)) {
        if (this.plannerSeeding.requiresInitialPlannerHandoff(pair.pairId)) {
          await this.plannerSeeding.primePair(pair.pairId, "from-planner");
        }
      }
    }
    return this.orchestrator.startAll();
  }

  async stopAll(): Promise<void> {
    return this.orchestrator.stopAll();
  }

  async shutdown(): Promise<void> {
    await this.orchestrator.shutdown();
  }

  reconfigurePairs(candidatePairs: SessionPair[]): void {
    this.orchestrator.reconfigurePairs(candidatePairs);
  }

  subscribeEvents(listener: (event: any) => void): () => void {
    if (typeof this.orchestrator.subscribeEvents === "function") {
      return this.orchestrator.subscribeEvents(listener);
    }
    return () => {};
  }
}

