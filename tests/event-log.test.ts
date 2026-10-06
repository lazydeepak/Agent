import { describe, expect, it } from "vitest";
import { EventLog } from "../src/application/event-log.js";

describe("EventLog", () => {
  it("records events with a timestamp and notifies subscribers", () => {
    const log = new EventLog({ clock: () => new Date("2026-01-01T00:00:00.000Z") });
    const seen: string[] = [];
    const unsubscribe = log.subscribe((event) => seen.push(event.type));

    log.record("PAIR_STARTED", { pairId: "local-dev", reason: "manual" });
    unsubscribe();
    log.record("PAIR_STOPPED", { pairId: "local-dev" });

    expect(seen).toEqual(["PAIR_STARTED"]);
    expect(log.recent()).toEqual([
      {
        time: "2026-01-01T00:00:00.000Z",
        type: "PAIR_STARTED",
        pairId: "local-dev",
        reason: "manual"
      },
      { time: "2026-01-01T00:00:00.000Z", type: "PAIR_STOPPED", pairId: "local-dev" }
    ]);
  });

  it("keeps only the most recent events", () => {
    const log = new EventLog({ maxEvents: 3 });
    for (let index = 0; index < 5; index += 1) {
      log.record(`EVENT_${index}`);
    }
    expect(log.recent().map((event) => event.type)).toEqual(["EVENT_2", "EVENT_3", "EVENT_4"]);
  });

  it("filters by pair but keeps events without a pair", () => {
    const log = new EventLog();
    log.record("A", { pairId: "one" });
    log.record("GLOBAL");
    log.record("B", { pairId: "two" });
    expect(log.recent({ pairId: "one" }).map((event) => event.type)).toEqual(["A", "GLOBAL"]);
  });

  it("honours an explicit limit", () => {
    const log = new EventLog();
    log.record("A");
    log.record("B");
    log.record("C");
    expect(log.recent({ limit: 2 }).map((event) => event.type)).toEqual(["B", "C"]);
  });

  it("returns copies so callers cannot mutate retained events", () => {
    const log = new EventLog();
    log.record("A", { details: { count: 1 } });
    const [first] = log.recent();
    first!.details!.count = 99;
    expect(log.recent()[0]!.details!.count).toBe(1);
  });

  it("clears events and listeners on shutdown", () => {
    const log = new EventLog();
    let notifications = 0;
    log.subscribe(() => {
      notifications += 1;
    });
    log.record("A");
    log.clear();
    log.record("B");
    expect(notifications).toBe(1);
    expect(log.all()).toHaveLength(1);
  });
});
