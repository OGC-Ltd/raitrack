/**
 * Narrowing the sugar-haul table to a date range.
 *
 * What these pin is the argument the module makes: a range RE-DERIVES a unit's
 * figures from the runs inside it, and the three populations behind those
 * figures — paperwork, weighed, measured — stay distinct after filtering.
 * Getting that wrong does not break the page; it quietly reports a tonnage
 * nobody hauled, which is the failure worth a test.
 */

import { describe, it, expect } from "vitest";
import { fleetDay, runsInRange, aggregateRuns, unitsInRange, totalsOf } from "./sugarHauls";

/** A sales run: the office weighs it, so it carries a tonnage. */
const sale = (over = {}) => ({
  id: "d1", kind: "SALES", driver: "Duncan Mwangi", destination: "Raiply",
  dispatchedAt: "2026-09-09T06:58:00.000Z",
  returnedAt:   "2026-09-09T11:30:00.000Z",
  status: "COMPLETED", tonnes: 29, bags: 580, km: 240, litres: 96,
  ...over,
});

/** A transport run: same gate, same sugar, no weight on the payload. */
const transport = (over = {}) =>
  sale({ id: "d9", kind: "CANE", tonnes: null, bags: null, ...over });

describe("fleetDay", () => {
  it("dates an instant on the fleet's calendar, not on UTC's", () => {
    // 22:30 UTC is 01:30 the NEXT day in Nairobi. Read as UTC this run would
    // filter out of a range that plainly contains it.
    expect(fleetDay("2026-09-09T22:30:00.000Z")).toBe("2026-09-10");
    expect(fleetDay("2026-09-09T06:58:00.000Z")).toBe("2026-09-09");
  });
});

describe("runsInRange", () => {
  const runs = [
    sale({ id: "a", dispatchedAt: "2026-09-08T06:00:00.000Z" }),
    sale({ id: "b", dispatchedAt: "2026-09-09T06:00:00.000Z" }),
    sale({ id: "c", dispatchedAt: "2026-09-10T06:00:00.000Z" }),
  ];

  it("returns everything when neither end is set", () => {
    expect(runsInRange(runs, "", "")).toHaveLength(3);
  });

  it("includes both endpoints", () => {
    // A range chosen as 8th-to-9th must contain the 8th and the 9th. An
    // exclusive end is the classic off-by-one here and it loses a whole day.
    expect(runsInRange(runs, "2026-09-08", "2026-09-09").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("takes either end on its own", () => {
    expect(runsInRange(runs, "2026-09-09", "").map((r) => r.id)).toEqual(["b", "c"]);
    expect(runsInRange(runs, "", "2026-09-08").map((r) => r.id)).toEqual(["a"]);
  });

  it("dates a run by its sign-out, not its return", () => {
    // An overnight haul belongs to the day it went out — the same day the
    // tonnage chart beside this table plots it under.
    const overnight = [sale({
      id: "n", dispatchedAt: "2026-09-09T18:00:00.000Z", returnedAt: "2026-09-11T05:00:00.000Z",
    })];
    expect(runsInRange(overnight, "2026-09-10", "2026-09-11")).toHaveLength(0);
    expect(runsInRange(overnight, "2026-09-09", "2026-09-09")).toHaveLength(1);
  });
});

describe("aggregateRuns", () => {
  it("counts a transport run without letting it into the tonnage", () => {
    // The whole point of the null. A zero would hold the tonnage still while
    // the run count climbed, and halve any tonnes-per-run read off the row.
    const u = aggregateRuns("KCP 134P", [sale(), transport()]);
    expect(u.runs).toBe(2);
    expect(u.runsWeighed).toBe(1);
    expect(u.tonnes).toBe(29);
    expect(u.bags).toBe(580);
  });

  it("leaves tonnage null, not zero, when nothing was weighed", () => {
    const u = aggregateRuns("KCP 134P", [transport()]);
    expect(u.tonnes).toBeNull();
    expect(u.bags).toBeNull();
    expect(u.runs).toBe(1);
  });

  it("leaves distance null when no run produced a trip", () => {
    const u = aggregateRuns("KCP 134P", [sale({ km: null, litres: null })]);
    expect(u.km).toBeNull();
    expect(u.runsMeasured).toBe(0);
    expect(u.litresPerKm).toBeNull();
  });

  it("rates fuel as a ratio of totals, not a mean of per-run rates", () => {
    // A 2 km repositioning move and a 200 km haul are not two equal opinions
    // about what a kilometre costs. 104 L over 202 km is 0.51 — a mean of the
    // two rates would say 1.25.
    const u = aggregateRuns("KCP 134P", [
      sale({ id: "x", km: 200, litres: 100 }),
      sale({ id: "y", km: 2,   litres: 4   }),
    ]);
    expect(u.litresPerKm).toBe(0.51);
  });

  it("names the newest crew and the commonest destination", () => {
    const u = aggregateRuns("KCP 134P", [
      sale({ id: "old", dispatchedAt: "2026-09-08T06:00:00.000Z",
             driver: "Old Hand", destination: "Raiply" }),
      sale({ id: "new", dispatchedAt: "2026-09-10T06:00:00.000Z",
             driver: "New Hand", destination: "Webuye" }),
      sale({ id: "mid", dispatchedAt: "2026-09-09T06:00:00.000Z",
             driver: "Old Hand", destination: "Raiply" }),
    ]);
    expect(u.driver).toBe("New Hand");
    expect(u.destination).toBe("Raiply");
    expect(u.destinations).toBe(2);
  });
});

describe("unitsInRange", () => {
  const units = [
    { plate: "KCP 134P", history: [
      sale({ id: "a", dispatchedAt: "2026-09-08T06:00:00.000Z" }),
      sale({ id: "b", dispatchedAt: "2026-09-10T06:00:00.000Z" }),
    ] },
    { plate: "KCP 999P", history: [
      sale({ id: "c", dispatchedAt: "2026-09-08T06:00:00.000Z" }),
    ] },
  ];

  it("drops a unit with no run in the range rather than showing it empty", () => {
    // A row of dashes would claim the unit carried nothing on those days. It
    // is not a unit that carried nothing — it is one the question misses.
    const out = unitsInRange(units, "2026-09-10", "2026-09-10");
    expect(out.map((u) => u.plate)).toEqual(["KCP 134P"]);
    expect(out[0].runs).toBe(1);
  });

  it("re-derives the figures rather than scaling the window's", () => {
    // One of two runs survives, so the tonnage is that run's 29 t — not half
    // of the unit's 58 t window total, which is the same number only by luck
    // and stops being so the moment the runs differ.
    const out = unitsInRange(units, "2026-09-10", "");
    expect(out[0].tonnes).toBe(29);
    expect(out[0].km).toBe(240);
  });
});

describe("totalsOf", () => {
  it("sums the rows on screen, keeping the weighed population separate", () => {
    const rows = [
      aggregateRuns("A", [sale(), transport()]),
      aggregateRuns("B", [transport()]),
    ];
    const t = totalsOf(rows);
    expect(t.units).toBe(2);
    expect(t.runs).toBe(3);
    expect(t.runsWeighed).toBe(1);
    expect(t.tonnes).toBe(29);
  });

  it("reports a null tonnage when no row on screen was weighed", () => {
    const t = totalsOf([aggregateRuns("B", [transport()])]);
    expect(t.tonnes).toBeNull();
    expect(t.runs).toBe(1);
  });
});
