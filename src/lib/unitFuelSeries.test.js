import { describe, it, expect } from "vitest";
import { joinUnitFuelDays } from "./unitFuelSeries";

const ledger = [
  { day: "2026-09-01", litres: 200, lost: 0, cost: 30000, lossCost: 0 },
  { day: "2026-09-02", litres: 0, lost: 45, cost: 0, lossCost: 6750 },
  { day: "2026-09-03", litres: 150, lost: 0, cost: 22500, lossCost: 0 },
];

const balance = {
  days: [
    { day: "2026-09-01", km: 380, hours: 11.5, litres: 198.4, litresPerKm: 0.52,
      litresPerHour: 17.3 },
    // The middle day did not clear the guards — every measured field null.
    { day: "2026-09-02", km: null, hours: null, litres: null, litresPerKm: null },
    { day: "2026-09-03", km: 514, hours: 13.4, litres: 263.1, litresPerKm: 0.51 },
  ],
};

describe("joinUnitFuelDays", () => {
  it("keeps every ledger day and attaches the balance where it exists", () => {
    const { rows, measured } = joinUnitFuelDays(ledger, balance);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.day)).toEqual([
      "2026-09-01", "2026-09-02", "2026-09-03",
    ]);
    expect(rows[0].km).toBe(380);
    expect(rows[0].perKm).toBe(0.52);
    expect(rows[0].hours).toBe(11.5);
    expect(measured).toBe(2);
  });

  it("carries litres per hour, and derives it when the payload predates it", () => {
    // Both rates hang off the same measured burn, and the chart draws them on
    // two different axes — a unit that works standing still has an hourly rate
    // and no distance at all, so losing this field would silently flatten the
    // only line that describes it.
    const { rows } = joinUnitFuelDays(ledger, balance);
    expect(rows[0].perHour).toBe(17.3);

    // 2026-09-03 has no litresPerHour on it: 263.1 / 13.4.
    expect(rows[2].perHour).toBeCloseTo(19.63, 2);
    expect(rows[1].perHour).toBeNull();
  });

  it("leaves an unmeasured day null rather than zero", () => {
    // The whole reason the fields are `?? null`: a 0 draws a bar to the axis
    // and reads as a unit that ran nowhere and burnt nothing.
    const { rows } = joinUnitFuelDays(ledger, balance);

    expect(rows[1].km).toBeNull();
    expect(rows[1].perKm).toBeNull();
    expect(rows[1].used).toBeNull();
    expect(rows[1].hours).toBeNull();
    // ...while the ledger half of that same day is untouched and real.
    expect(rows[1].lost).toBe(45);
    expect(rows[1].lossCost).toBe(6750);
  });

  it("still draws the ledger when the balance half is missing entirely", () => {
    // A unit with no probe, or a window before the trends table covered it.
    const { rows, measured } = joinUnitFuelDays(ledger, null);

    expect(rows).toHaveLength(3);
    expect(measured).toBe(0);
    expect(rows.every((r) => r.km === null)).toBe(true);
    expect(rows[0].litres).toBe(200);
  });

  it("reports measured 0 when the two halves disagree about day keys", () => {
    // The silent failure this function exists to surface: both halves are
    // populated and every join misses, so the chart would otherwise render a
    // full set of bars beside an empty distance axis and look fine.
    const shifted = {
      days: balance.days.map((d) => ({ ...d, day: `${d.day}T00:00:00.000Z` })),
    };
    const { rows, measured } = joinUnitFuelDays(ledger, shifted);

    expect(rows).toHaveLength(3);
    expect(measured).toBe(0);
  });

  it("ignores balance days the ledger window does not cover", () => {
    // The ledger is the spine — the axis is its window, not the union.
    const wider = {
      days: [
        { day: "2026-08-30", km: 120, hours: 5, litres: 60, litresPerKm: 0.5 },
        ...balance.days,
      ],
    };
    const { rows } = joinUnitFuelDays(ledger, wider);

    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.day === "2026-08-30")).toBe(false);
  });

  it("returns an empty series rather than throwing on no ledger", () => {
    expect(joinUnitFuelDays(null, balance)).toEqual({ rows: [], measured: 0 });
    expect(joinUnitFuelDays([], null)).toEqual({ rows: [], measured: 0 });
  });
});
