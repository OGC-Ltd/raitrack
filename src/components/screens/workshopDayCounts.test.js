import { describe, it, expect } from "vitest";
import { dayCounts, dayStay, dayHasRecords } from "./WorkshopStats";

const day = {
  date: "2026-11-20", capacity: 3, booked: 1,
  bookings: [{ status: "arrived", arrivedAt: "2026-11-20T06:00:00Z", repairItem: { resolvedAt: "2026-11-20T12:00:00Z" } }],
  unbookedArrivals: [
    { id: "a", fsJobCards: [{ cardNumber: "JC-2026-0337", checkedInAt: "2026-11-20T08:00:00Z", releasedAt: "2026-11-20T15:00:00Z" }] },
    { id: "b", fsJobCards: [{ cardNumber: "JC-2026-0338", checkedInAt: "2026-11-20T09:00:00Z", releasedAt: "2026-11-22T09:00:00Z" }] },
    { id: "c", fsJobCards: [], stageHistory: [{ stage: "in_workshop", at: "2026-11-20T10:00:00Z" }] },
  ],
};

describe("dayCounts", () => {
  it("books a FactorySuite check-in and counts the walk-in apart", () => {
    const c = dayCounts(day);
    expect(c.fsIns).toBe(2);
    expect(c.walkIns).toBe(1);
    expect(c.booked).toBe(3);
    expect(c.slotsTaken).toBe(1);
  });
  it("checks out only those of the day's bookings that left the same day", () => {
    expect(dayCounts(day).checkedOut).toBe(2);
  });
});

describe("dayStay", () => {
  it("reads the card first, then the booking, then the trail", () => {
    expect(dayStay(day.unbookedArrivals[0])).toEqual({ in: "2026-11-20T08:00:00Z", out: "2026-11-20T15:00:00Z" });
    expect(dayStay(day.bookings[0].repairItem, day.bookings[0])).toEqual({ in: "2026-11-20T06:00:00Z", out: "2026-11-20T12:00:00Z" });
    expect(dayStay(day.unbookedArrivals[2])).toEqual({ in: "2026-11-20T10:00:00Z", out: null });
  });
  it("takes the card checked in on the day shown when a job has several", () => {
    const hst = { fsJobCards: [
      { checkedInAt: "2026-11-18T05:01:30Z", releasedAt: "2026-11-20T04:44:16Z" },
      { checkedInAt: "2026-11-20T09:11:30Z", releasedAt: "2026-11-20T16:34:52Z" },
    ] };
    expect(dayStay(hst, null, "2026-11-18")).toEqual({ in: "2026-11-18T05:01:30Z", out: "2026-11-20T04:44:16Z" });
    expect(dayStay(hst, null, "2026-11-20")).toEqual({ in: "2026-11-20T09:11:30Z", out: "2026-11-20T16:34:52Z" });
  });
  it("knows an empty day", () => {
    expect(dayHasRecords({ bookings: [], unbookedArrivals: [] })).toBe(false);
    expect(dayHasRecords(day)).toBe(true);
  });
});
