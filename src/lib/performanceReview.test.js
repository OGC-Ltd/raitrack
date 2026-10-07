import { describe, it, expect } from "vitest";
import { readReview, pace, litres, pct, band, listRefs, singular } from "./performanceReview";

const unit = (ref, over = {}) => ({
  id: ref, ref, name: `MUFINDI: ${ref}`, group: "Trucks", rate: 2.6, basis: "DISTANCE",
  litres: 1000, refills: 10, usableRefills: 9, ratio: 1, excessL: 0, work: 100, status: "within", nearZeroWork: 0, ...over,
});

const review = (units, groups) => ({
  from: "2026-07-01", to: "2026-09-28", days: 90, coveredDays: 90,
  totals: { litres: 10000, refills: 100, units: units.length, unitsWithStandard: units.length, assessedUnits: units.length, excessL: 900, excessShare: 0.09, perDay: 111, perMonth: 3333 },
  months: [
    { month: "2026-07", days: 31, litres: 3100, perDay: 100 },
    { month: "2026-08", days: 31, litres: 3100, perDay: 100 },
    { month: "2026-09", days: 28, litres: 3360, perDay: 120 },
  ],
  groups, records: { near: 60, over: 10, implausible: 20, missing: 10 }, units,
});

describe("formatting", () => {
  it("litres, short and long", () => {
    expect(litres(1_500_000, { short: true })).toBe("1.50M L");
    expect(litres(87_900, { short: true })).toBe("87.9k L");
    expect(litres(1234)).toBe("1,234 L");
  });
  it("percentages, bands, lists", () => {
    expect(pct(1.64)).toBe("164%");
    expect(pct(null)).toBe("—");
    expect(band({ ratio: 1.2 })).toBe("over");
    expect(band({ ratio: 1.05 })).toBe("slight");
    expect(band({ ratio: 0.8 })).toBe("within");
    expect(listRefs([{ ref: "A" }, { ref: "B" }, { ref: "C" }])).toBe("A, B and C");
    expect(singular("Trucks")).toBe("Truck");
  });
});

describe("pace", () => {
  it("compares the last month with the full months before it", () => {
    const p = pace(review([], []).months);
    expect(p.latest.month).toBe("2026-09");
    expect(p.change).toBeCloseTo(0.2);
  });
  it("needs two months with fuel", () => {
    expect(pace([{ month: "2026-09", days: 30, litres: 10, perDay: 1 }])).toBeNull();
  });
});

describe("readReview", () => {
  const trucks = [
    unit("FT 08", { ratio: 2.28, status: "over", excessL: 900, litres: 3000 }),
    unit("FT 01", { ratio: 1.5, status: "over", excessL: 400 }),
    unit("HPT 01", { ratio: 0.77, status: "within" }),
    unit("FTT 11", { ratio: 0.97, status: "within", litres: 5000 }),
    unit("FTT 09", { ratio: null, status: "unassessed", refills: 10, nearZeroWork: 8 }),
  ];
  const ctr = [0.2, 0.25, 0.3].map((r, i) => unit(`CTR 0${i}`, { group: "CASE tractors", ratio: r, rate: 100, basis: "HOURS" }));
  const nostd = unit("FES 716", { group: "Challenger tractors", rate: null, basis: null, ratio: null, status: "unassessed", litres: 6500 });
  const groups = [
    { group: "Trucks", units: 5, assessed: 4, litres: 13000, share: 0.6, excessL: 1300, overCount: 2, ratio: 1.2 },
    { group: "CASE tractors", units: 3, assessed: 3, litres: 3000, share: 0.2, excessL: 0, overCount: 0, ratio: 0.25 },
    { group: "Challenger tractors", units: 1, assessed: 0, litres: 6500, share: 0.2, excessL: 0, overCount: 0, ratio: null },
  ];
  const r = readReview(review([...trucks, ...ctr, nostd], groups));

  it("lists the units over standard, biggest excess first", () => {
    expect(r.attention.map((u) => u.ref)).toEqual(["FT 08", "FT 01"]);
  });
  it("benchmarks the best and the busiest within standard", () => {
    const t = r.benchmarks.find((b) => b.group === "Trucks");
    expect(t.units.map((u) => u.ref)).toEqual(["HPT 01", "FTT 11"]);
    expect(t.busiestId).toBe("FTT 11");
  });
  it("calls a group whose every unit is far under standard a standards problem", () => {
    expect(r.suspectGroups).toEqual(["CASE tractors"]);
    expect(r.benchmarks.find((b) => b.group === "CASE tractors")).toBeUndefined();
  });
  it("finds silent meters and unmeasured fuel", () => {
    expect(r.meterFixes.map((u) => u.ref)).toEqual(["FTT 09"]);
    expect(r.unmeasuredL).toBe(6500);
  });
  it("writes the actions", () => {
    expect(r.actions[0]).toBe("Inspect FT 08 and FT 01 for mechanical faults, leaks or excessive idling.");
    expect(r.actions.at(-1)).toBe("Set standards for the 1 unit without one, and reset the standards for CASE tractors.");
    expect(r.reliableShare).toBeCloseTo(0.7);
  });
});
