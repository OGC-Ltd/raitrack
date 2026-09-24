import { describe, it, expect } from "vitest";
import { fleetDayOf, fleetDayBounds, dayBreakdown, eventLabel, unexplainedMatters } from "./fuelDay";

describe("fleet days", () => {
  it("puts 01:23 EAT on its own Kenyan day, not the UTC one before", () => {
    expect(fleetDayOf("2026-09-24T22:23:06.000Z")).toBe("2026-09-25");
    expect(fleetDayBounds("2026-09-25")).toEqual({
      from: "2026-09-24T21:00:00.000Z", to: "2026-09-25T21:00:00.000Z",
    });
  });
});

// MUFINDI - DZ 20 on 2026-09-25, as served.
const tank = {
  initialMl: 298222, currentMl: 240000, engineBurnMl: 54978,
  engineSeconds: 7879, engineRateLPerHour: 25.12, distanceM: 675,
};
const drops = [
  { id: "d4", beganAt: "2026-09-24T22:23:06Z", stolenMl: 34930, verdict: "DRAIN", drainCause: "UNEXPLAINED_BURN", recoveredMl: 34201 },
  { id: "d2", beganAt: "2026-09-24T21:43:00Z", stolenMl: 26750, verdict: "REDISTRIBUTION", recoveredMl: 49398 },
  { id: "d1", beganAt: "2026-09-24T21:28:00Z", stolenMl: 23330, verdict: "DRAIN", drainCause: "HIGH_BURN", recoveredMl: 0 },
];

describe("dayBreakdown", () => {
  it("balances the tank: opening + refuelled − closing is what was used", () => {
    const b = dayBreakdown({ tank, drops });
    expect(b.opening).toBeCloseTo(298.222, 3);
    expect(b.closing).toBe(240);
    expect(b.used).toBeCloseTo(58.222, 3);
    expect(b.engine).toBeCloseTo(54.978, 3);
    expect(b.unexplained).toBeCloseTo(3.244, 3);
    expect(b.engineHours).toBeCloseTo(2.19, 2);
    expect(b.distanceKm).toBeCloseTo(0.675, 3);
  });

  it("counts a refuel only when the fuel arrived", () => {
    const fillings = [
      { id: "f1", filledAt: "2026-09-25T05:00:00Z", filledMl: 100000, verdict: "REFILL" },
      { id: "f2", filledAt: "2026-09-25T06:00:00Z", filledMl: 40000, verdict: "REDISTRIBUTION" },
    ];
    const b = dayBreakdown({ tank, fillings });
    expect(b.refuelled).toBe(100);
    expect(b.refuelCount).toBe(1);
    expect(b.used).toBeCloseTo(158.222, 3);
    // Both are still listed: the reported-but-not-arrived one is an event too.
    expect(b.events.map((e) => e.id)).toEqual(["f1", "f2"]);
  });

  it("lists the events in time order, refuels and drops together", () => {
    const b = dayBreakdown({ tank, drops, fillings: [{ id: "f", filledAt: "2026-09-24T21:35:00Z", filledMl: 1000, verdict: "REFILL" }] });
    expect(b.events.map((e) => e.id)).toEqual(["d1", "f", "d2", "d4"]);
  });

  it("leaves a figure blank rather than guessing an end", () => {
    const b = dayBreakdown({ tank: { ...tank, currentMl: null } });
    expect(b.used).toBeNull();
    expect(b.unexplained).toBeNull();
    expect(dayBreakdown({ tank: null }).opening).toBeNull();
  });
});

describe("eventLabel", () => {
  it("says what the level did, never theft", () => {
    expect(eventLabel({ type: "drop", verdict: "REDISTRIBUTION" })).toBe("Level dipped and came back");
    expect(eventLabel({ type: "drop", verdict: "DRAIN", cause: "HIGH_BURN" })).toBe("Burn above normal");
    expect(eventLabel({ type: "drop", verdict: "DRAIN", cause: "SIPHON" })).toBe("Drop while parked");
    expect(eventLabel({ type: "refuel", verdict: "REFILL" })).toBe("Refuelled");
  });
});

describe("unexplainedMatters", () => {
  it("ignores a few litres of disagreement and flags a real gap", () => {
    expect(unexplainedMatters({ unexplained: 3.2, engine: 55 })).toBe(false);
    expect(unexplainedMatters({ unexplained: 12, engine: 55 })).toBe(true);
    expect(unexplainedMatters({ unexplained: 8, engine: 120 })).toBe(false);
  });
});
