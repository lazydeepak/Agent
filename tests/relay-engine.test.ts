import { describe, expect, it, vi } from "vitest";
import { RelayEngine } from "../src/application/relay-engine.js";
import { DesktopApplicationService } from "../src/application/desktop-service.js";
import { RuntimeOrchestrator } from "../src/runtime/index.js";
import type { RuntimePairStatus, RuntimeStatusSummary } from "../src/runtime/index.js";
import type { RelayStore } from "../src/persistence/index.js";

function mockPairStatus(pairId: string): RuntimePairStatus {
  return {
    pairId,
    runtimeState: "RUNNING",
    worker: "connected",
    planner: "connected",
    recovering: false,
    workerObserved: true,
    plannerObserved: true,
    paused: false,
    enabled: true
  };
}

describe("RelayEngine", () => {
  it("receives RuntimeOrchestrator by constructor injection and preserves the shared instance", () => {
    const store = { listCycles: () => [] } as unknown as RelayStore;
    const sharedOrchestrator = new RuntimeOrchestrator({
      pairs: [],
      store
    });

    const engine = new RelayEngine({ orchestrator: sharedOrchestrator });

    const status = engine.getStatus();
    expect(status).toBeDefined();
    expect(status.pairs).toEqual([]);
  });

  it("calls orchestrator.getStatus exactly once", () => {
    const mockStatus: RuntimeStatusSummary = {
      enabled: 2,
      running: 1,
      healthy: 1,
      degraded: 0,
      failed: 0,
      pairs: []
    };

    const getStatusSpy = vi.fn().mockReturnValue(mockStatus);
    const orchestrator = { getStatus: getStatusSpy };

    const engine = new RelayEngine({ orchestrator });
    expect(getStatusSpy).not.toHaveBeenCalled();

    engine.getStatus();
    expect(getStatusSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the exact result unchanged", () => {
    const mockStatus: RuntimeStatusSummary = {
      enabled: 3,
      running: 2,
      healthy: 2,
      degraded: 0,
      failed: 0,
      pairs: [mockPairStatus("pair-alpha")]
    };

    const orchestrator = { getStatus: () => mockStatus };
    const engine = new RelayEngine({ orchestrator });

    const result = engine.getStatus();
    expect(result).toBe(mockStatus);
    expect(result.pairs[0].pairId).toBe("pair-alpha");
  });

  it("propagates errors unchanged", () => {
    const customError = new Error("Engine status failure test");
    const orchestrator = {
      getStatus: () => {
        throw customError;
      }
    };
    const engine = new RelayEngine({ orchestrator });

    expect(() => engine.getStatus()).toThrow(customError);
  });

  it("DesktopService.getStatus calls the injected RelayEngine and enriches presentation without leaking to engine", () => {
    const mockStatus: RuntimeStatusSummary = {
      enabled: 1,
      running: 1,
      healthy: 1,
      degraded: 0,
      failed: 0,
      pairs: [mockPairStatus("test-pair")]
    };

    const getStatusSpy = vi.fn().mockReturnValue(mockStatus);
    const orchestrator = { getStatus: getStatusSpy };
    const engine = new RelayEngine({ orchestrator });
    const engineSpy = vi.spyOn(engine, "getStatus");

    const service = new DesktopApplicationService({
      configPath: "/dummy/pairs.json",
      relayEngine: engine
    });

    const enrichedStatus = service.getStatus();

    expect(engineSpy).toHaveBeenCalledTimes(1);
    expect(getStatusSpy).toHaveBeenCalledTimes(1);
    expect(enrichedStatus.running).toBe(1);
    expect(enrichedStatus.pairs[0].pairId).toBe("test-pair");
    // Verify presentation enrichment
    expect(enrichedStatus.pairs[0].hasRelayHistory).toBe(false);
    // Verify original engine status remained untouched
    expect((mockStatus.pairs[0] as any).hasRelayHistory).toBeUndefined();
  });

  it("DesktopService does not construct a replacement engine or orchestrator when RelayEngine is injected", () => {
    const mockStatus: RuntimeStatusSummary = {
      enabled: 0,
      running: 0,
      healthy: 0,
      degraded: 0,
      failed: 0,
      pairs: []
    };

    const orchestrator = { getStatus: vi.fn().mockReturnValue(mockStatus) };
    const injectedEngine = new RelayEngine({ orchestrator });

    const service = new DesktopApplicationService({
      configPath: "/dummy/pairs.json",
      relayEngine: injectedEngine
    });

    // Call getStatus multiple times
    service.getStatus();
    service.getStatus();

    // Verify injected engine was preserved and not replaced
    expect((service as any).relayEngine).toBe(injectedEngine);
    // Verify DesktopService did not construct an orchestrator internally
    expect((service as any).orchestrator).toBeUndefined();
  });
});
