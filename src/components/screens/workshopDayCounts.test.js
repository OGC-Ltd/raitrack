import { describe, it, expect } from "vitest";
import { dayCounts } from "./WorkshopStats";

describe("dayCounts", () => {
  it("counts a FactorySuite check-in apart from a walk-in", () => {
    const c = dayCounts({
      capacity: 3, booked: 1,
      bookings: [{ status: "arrived" }],
      unbookedArrivals: [{ id: "a", fsJobCards: [{ cardNumber: "JC-2026-0337" }] }, { id: "b", fsJobCards: [] }, { id: "c" }],
    });
    expect(c.fsIns).toBe(1);
    expect(c.walkIns).toBe(2);
    expect(c.arrived).toBe(1);
  });
});
