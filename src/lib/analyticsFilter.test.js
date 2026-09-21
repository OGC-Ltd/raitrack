/* The Analytics filter's arithmetic.
 *
 * Two things are worth pinning here and they are the two that were wrong in
 * earlier cuts of this page:
 *
 *   · WHICH WINDOW a control produces. The current month and a range ending
 *     today must send no `to` at all — that is the difference between the
 *     server's warm cache and a live query — and a past window must anchor at
 *     midday so a timezone nudge cannot move it a day.
 *   · WHETHER A FILTERED PAYLOAD STILL ADDS UP. `counts`, `byCategory` and
 *     `monitoring` are folds over `units` on the server; a client filter that
 *     narrowed the units and left the totals alone would draw a donut claiming
 *     218 machines above a list of 32.
 *
 * The fixture's shape and proportions are KASULU's, measured 2026-08-21:
 * 218 units, categories EX 32 / OPTIM 24 / LMV 23 / MTR 20 / CTR 18, 14 plates
 * carrying no family at all, and counts WORKING 23 / IDLING 16 / STATIONARY 21
 * / PARKED 77 / OFFLINE 81. Scaled down to what each assertion needs — a unit
 * test that has to be re-derived by hand every time the fleet moves is a test
 * nobody keeps.
 */

import { describe, it, expect } from "vitest";
import {
  windowFor, spanDays, categoriesKey, categoriesParam, isFiltered,
  filterFleetState, filterMachineStarts, filterExcavatorArea, UNPREFIXED_CODE,
  filterForOrgChange, vehiclesParam, vehiclesKey, selectionKey, unitOptions,
  hasHistory,
} from "./analyticsFilter";

const TZ = "Africa/Nairobi";
// A fixed instant so "today" is not the day the suite happens to run.
// 2026-08-21T09:00Z is 12:00 in Nairobi — mid-afternoon, well clear of either
// midnight, so the fleet day is unambiguously the 21st.
const NOW = new Date("2026-08-21T09:00:00Z");

describe("windowFor", () => {
  it("sends no anchor for the current month, so the request stays on the warm cache", () => {
    expect(windowFor({ mode: "month", month: "2026-08" }, TZ, NOW))
      .toEqual({ days: 21, to: undefined });
  });

  it("anchors a past month at midday on its last day", () => {
    expect(windowFor({ mode: "month", month: "2026-07" }, TZ, NOW))
      .toEqual({ days: 31, to: "2026-07-31T12:00:00+03:00" });
  });

  it("uses the month's own length, not a fixed 30", () => {
    expect(windowFor({ mode: "month", month: "2026-02" }, TZ, NOW).days).toBe(28);
  });

  it("sends no anchor for a range that ends today", () => {
    expect(windowFor({ mode: "range", from: "2026-08-15", to: "2026-08-21" }, TZ, NOW))
      .toEqual({ days: 7, to: undefined });
  });

  it("anchors a range that ends in the past", () => {
    expect(windowFor({ mode: "range", from: "2026-07-01", to: "2026-07-14" }, TZ, NOW))
      .toEqual({ days: 14, to: "2026-07-14T12:00:00+03:00" });
  });

  it("clamps a range running past today rather than drawing empty future days", () => {
    expect(windowFor({ mode: "range", from: "2026-08-19", to: "2026-12-31" }, TZ, NOW))
      .toEqual({ days: 3, to: undefined });
  });

  it("counts a single-day range as one day, not zero", () => {
    expect(windowFor({ mode: "range", from: "2026-07-04", to: "2026-07-04" }, TZ, NOW).days).toBe(1);
  });

  it("spans both ends inclusively", () => {
    expect(spanDays("2026-08-01", "2026-08-31")).toBe(31);
    expect(spanDays("2026-08-01", "2026-08-01")).toBe(1);
  });
});

describe("the categories parameter", () => {
  it("treats an empty selection as the whole fleet, not as an empty set", () => {
    // The parameter must be literally ABSENT: its presence is what moves the
    // request off the server's warm cache.
    expect(categoriesParam([])).toBeUndefined();
    expect(categoriesParam(undefined)).toBeUndefined();
    expect(isFiltered([])).toBe(false);
  });

  it("keys the same selection identically however it was clicked", () => {
    expect(categoriesKey(["CTR", "EX"])).toBe(categoriesKey(["EX", "CTR"]));
    expect(categoriesKey([])).toBe("all");
  });
});

/** A fleet-state payload in the shape the server sends. */
const unit = (vehicleId, category, state, extra = {}) => ({
  vehicleId, plate: `MUFINDI - ${category} ${vehicleId}`, category, state, ...extra,
});

const STATE = {
  counts: { WORKING: 3, IDLING: 1, STATIONARY: 1, PARKED: 2, OFFLINE: 2 },
  monitoring: { total: 9, reportingNow: 7, connected: 8, trackedSilent: 2, untracked: 0 },
  byCategory: [
    { category: "EX", working: 2, idling: 2, parked: 1, offline: 1 },
    { category: "CTR", working: 1, idling: 0, parked: 1, offline: 0 },
    { category: "", working: 0, idling: 0, parked: 0, offline: 1 },
  ],
  units: [
    unit("v1", "EX", "WORKING"),
    unit("v2", "EX", "WORKING"),
    unit("v3", "EX", "STATIONARY"),
    unit("v4", "EX", "PARKED"),
    unit("v5", "EX", "OFFLINE"),
    unit("v6", "EX", "IDLING"),
    unit("v7", "CTR", "WORKING"),
    unit("v8", "CTR", "PARKED"),
    // A plate carrying no family at all — 14 of KASULU's 218 look like this.
    unit("v9", "", "OFFLINE"),
  ],
};

describe("filterFleetState", () => {
  it("returns the payload untouched when nothing is selected", () => {
    expect(filterFleetState(STATE, [])).toBe(STATE);
  });

  it("narrows the units to the chosen families", () => {
    const out = filterFleetState(STATE, ["EX"]);
    expect(out.units).toHaveLength(6);
    expect(out.units.every((u) => u.category === "EX")).toBe(true);
  });

  it("recomputes counts so the donut cannot outnumber its own list", () => {
    const out = filterFleetState(STATE, ["EX"]);
    expect(out.counts).toEqual({
      WORKING: 2, IDLING: 1, STATIONARY: 1, PARKED: 1, OFFLINE: 1,
    });
    const summed = Object.values(out.counts).reduce((a, n) => a + n, 0);
    expect(summed).toBe(out.units.length);
  });

  it("recomputes byCategory, folding STATIONARY in with IDLING as the server does", () => {
    const out = filterFleetState(STATE, ["EX"]);
    expect(out.byCategory).toEqual([
      { category: "EX", working: 2, idling: 2, parked: 1, offline: 1 },
    ]);
  });

  it("recomputes monitoring from the surviving units", () => {
    const out = filterFleetState(STATE, ["EX"]);
    // OFFLINE is exactly "no ping inside the online window", the same test
    // trackedSilent counts on — so the split follows from the states.
    expect(out.monitoring).toEqual({
      total: 6, reportingNow: 5, connected: 5, trackedSilent: 1, untracked: 0,
    });
  });

  it("can select the units whose plates carry no family", () => {
    const out = filterFleetState(STATE, [UNPREFIXED_CODE]);
    expect(out.units).toHaveLength(1);
    expect(out.units[0].vehicleId).toBe("v9");
    expect(out.counts.OFFLINE).toBe(1);
  });

  it("adds up to the whole fleet when every family is selected", () => {
    const all = ["EX", "CTR", UNPREFIXED_CODE];
    const out = filterFleetState(STATE, all);
    expect(out.units).toHaveLength(STATE.units.length);
    expect(out.counts).toEqual(STATE.counts);
  });

  it("yields nothing for a family this fleet does not have", () => {
    const out = filterFleetState(STATE, ["ZZ"]);
    expect(out.units).toHaveLength(0);
    expect(out.monitoring.total).toBe(0);
  });
});

describe("filterMachineStarts", () => {
  const STARTS = {
    day: "2026-08-21",
    totalStarted: 15,
    categories: [
      { category: "EX", started: 7, slots: { pre04: 3, h04: 1, h05: 3 } },
      { category: "CTR", started: 5, slots: { pre04: 2, h04: 2, h05: 1 } },
      { category: "DZ", started: 3, slots: { pre04: 1, h04: 1, h05: 1 } },
    ],
  };

  it("passes through unfiltered", () => {
    expect(filterMachineStarts(STARTS, [])).toBe(STARTS);
  });

  it("re-sums totalStarted so the ledger matches the bars beneath it", () => {
    const out = filterMachineStarts(STARTS, ["EX", "DZ"]);
    expect(out.categories.map((c) => c.category)).toEqual(["EX", "DZ"]);
    expect(out.totalStarted).toBe(10);
  });
});

describe("filterExcavatorArea", () => {
  const AREA = {
    day: "2026-08-20",
    reachMetres: 6,
    units: [
      { vehicleId: "v1", plate: "MUFINDI - EX 1", areaM2: 4000 },
      { vehicleId: "v3", plate: "MUFINDI - EX 3", areaM2: 1500 },
      { vehicleId: "v7", plate: "MUFINDI - CTR 7", areaM2: 500 },
    ],
    totalM2: 6000,
  };

  it("passes through unfiltered", () => {
    expect(filterExcavatorArea(AREA, [], STATE)).toBe(AREA);
  });

  it("matches on fleet-state's labels rather than re-deriving a prefix", () => {
    const out = filterExcavatorArea(AREA, ["EX"], STATE);
    expect(out.units.map((u) => u.vehicleId)).toEqual(["v1", "v3"]);
    expect(out.totalM2).toBe(5500);
  });

  it("re-totals the ground so the caption matches the rows", () => {
    const out = filterExcavatorArea(AREA, ["CTR"], STATE);
    expect(out.totalM2).toBe(500);
  });
});

/**
 * Switching organisations while a vehicle-type filter is on.
 *
 * Categories are read from the fleet, so they are organisation-scoped
 * vocabulary. Carried across a switch they select nothing, and every analytics
 * request comes back empty — a page that renders perfectly and says the fleet
 * has stopped.
 */
describe("filterForOrgChange", () => {
  const withCats = {
    mode: "month",
    month: "2026-08",
    from: "2026-08-01",
    to: "2026-08-21",
    categories: ["EX", "LMV"],
  };

  it("clears the vehicle categories when the organisation changes", () => {
    expect(filterForOrgChange(withCats, true).categories).toEqual([]);
  });

  it("keeps the date window, which means the same thing everywhere", () => {
    const next = filterForOrgChange(withCats, true);
    expect(next.mode).toBe("month");
    expect(next.month).toBe("2026-08");
    expect(next.from).toBe("2026-08-01");
    expect(next.to).toBe("2026-08-21");
  });

  it("leaves the filter alone while the organisation is the same", () => {
    expect(filterForOrgChange(withCats, false)).toBe(withCats);
  });

  /* Identity, not equality. The caller applies this DURING RENDER, so a fresh
   * object when nothing needs clearing would set state on every pass and spin
   * the component forever. */
  it("returns the same object when there is nothing to clear", () => {
    const unfiltered = { ...withCats, categories: [] };
    expect(filterForOrgChange(unfiltered, true)).toBe(unfiltered);
  });

  it("survives a filter with no categories key at all", () => {
    const bare = { mode: "month", month: "2026-08" };
    expect(filterForOrgChange(bare, true)).toBe(bare);
  });
});


/* ─────────────────────────── the unit selection ─────────────────────────── */

describe("the unit selection", () => {
  it("is absent from a request when nothing is picked", () => {
    // Absent, not empty: the parameter's PRESENCE is what moves the request off
    // the server's warm entry, so an unfiltered page must not carry it at all.
    expect(vehiclesParam([])).toBeUndefined();
    expect(vehiclesParam(undefined)).toBeUndefined();
    expect(vehiclesParam(["v1", "v2"])).toBe("v1,v2");
  });

  it("keys the same units identically however they were clicked", () => {
    expect(vehiclesKey(["v2", "v1"])).toBe(vehiclesKey(["v1", "v2"]));
    expect(vehiclesKey([])).toBe("all");
  });

  it("keys the two selections apart", () => {
    // A type selection and a unit selection are different narrowings and must
    // never share a cache entry, however similar their members read.
    expect(selectionKey(["EX"], [])).not.toBe(selectionKey([], ["EX"]));
    expect(selectionKey([], [])).toBe("all|all");
  });

  it("counts either selection as filtered", () => {
    expect(isFiltered([], [])).toBe(false);
    expect(isFiltered(["EX"], [])).toBe(true);
    expect(isFiltered([], ["v1"])).toBe(true);
  });
});

describe("filterFleetState, narrowed to units", () => {
  it("keeps only the units picked", () => {
    const out = filterFleetState(STATE, [], ["v1", "v7"]);
    expect(out.units.map((u) => u.vehicleId)).toEqual(["v1", "v7"]);
  });

  it("re-folds the totals over what survived", () => {
    // The whole reason this function exists: a donut claiming nine machines
    // above a list of two is the failure being guarded against.
    const out = filterFleetState(STATE, [], ["v1", "v4"]);
    expect(out.counts.WORKING).toBe(1);
    expect(out.counts.PARKED).toBe(1);
    expect(out.monitoring.total).toBe(2);
  });

  it("intersects the two selections rather than adding them", () => {
    // v7 is a CTR. Picked as a unit but excluded by the type, it must not
    // survive — otherwise ticking a type would WIDEN a unit selection.
    const out = filterFleetState(STATE, ["EX"], ["v1", "v7"]);
    expect(out.units.map((u) => u.vehicleId)).toEqual(["v1"]);
  });

  it("answers an impossible pairing with nothing, not with the fleet", () => {
    const out = filterFleetState(STATE, ["CTR"], ["v1"]);
    expect(out.units).toEqual([]);
    expect(out.monitoring.total).toBe(0);
  });
});

describe("filterExcavatorArea, narrowed to units", () => {
  const AREA = {
    totalM2: 6000,
    units: [
      { vehicleId: "v1", plate: "MUFINDI - EX 1", areaM2: 4000 },
      { vehicleId: "v3", plate: "MUFINDI - EX 3", areaM2: 1500 },
      { vehicleId: "v7", plate: "MUFINDI - CTR 7", areaM2: 500 },
    ],
  };

  it("keeps the picked unit and re-sums the total", () => {
    const out = filterExcavatorArea(AREA, [], STATE, ["v3"]);
    expect(out.units.map((u) => u.vehicleId)).toEqual(["v3"]);
    expect(out.totalM2).toBe(1500);
  });

  it("intersects with the type selection", () => {
    const out = filterExcavatorArea(AREA, ["EX"], STATE, ["v3", "v7"]);
    expect(out.units.map((u) => u.vehicleId)).toEqual(["v3"]);
  });
});

describe("unitOptions", () => {
  it("offers every unit the fleet has, by plate", () => {
    const opts = unitOptions(STATE);
    expect(opts).toHaveLength(STATE.units.length);
    expect(opts.map((o) => o.plate)).toEqual([...opts.map((o) => o.plate)].sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    ));
  });

  it("labels a plate with no family as unprefixed rather than blank", () => {
    // A unit whose plate carries no family still has to be pickable — 14 of
    // KASULU's 218 look like this, and a filter that could not reach them would
    // make the fleet total disagree with the sum of its parts.
    const bare = unitOptions(STATE).find((o) => o.id === "v9");
    expect(bare.category).toBe(UNPREFIXED_CODE);
  });

  it("answers an absent feed with an empty list", () => {
    expect(unitOptions(null)).toEqual([]);
    expect(unitOptions({})).toEqual([]);
  });

  /* The ordering asked for 2026-09-14. A third of a fleet can be units that did
   * nothing in the window, and picking one produces a page of zeroes that reads
   * as a broken filter rather than as an answer about the unit. */
  it("lists the units that worked before the ones that did not", () => {
    const feed = { units: [
      { vehicleId: "a", plate: "AAA 001", category: "EX" },                     // silent
      { vehicleId: "b", plate: "BBB 002", category: "EX", hoursMonthAvg: 6.2 }, // worked
      { vehicleId: "c", plate: "CCC 003", category: "CTR" },                    // silent
      { vehicleId: "d", plate: "DDD 004", category: "CTR", distanceWeekAvgKm: 41 },
    ] };
    expect(unitOptions(feed).map((o) => o.plate))
      .toEqual(["BBB 002", "DDD 004", "AAA 001", "CCC 003"]);
  });

  it("keeps plate order INSIDE each tier", () => {
    // The list is scanned for a plate you already have in mind, so the position
    // of a unit within its tier must not move with the window.
    const feed = { units: [
      { vehicleId: "z", plate: "ZZZ 010", category: "EX", hoursToday: 2 },
      { vehicleId: "m", plate: "MMM 002", category: "EX", fuelBurnL: 40 },
      { vehicleId: "y", plate: "YYY 009", category: "EX" },
      { vehicleId: "n", plate: "NNN 003", category: "EX" },
    ] };
    expect(unitOptions(feed).map((o) => o.plate))
      .toEqual(["MMM 002", "ZZZ 010", "NNN 003", "YYY 009"]);
  });

  it("counts any kind of measured work as a history", () => {
    const kinds = [
      { hoursToday: 1 }, { hoursWeekAvg: 1 }, { hoursMonthAvg: 1 },
      { distanceTodayKm: 1 }, { distanceWeekAvgKm: 1 }, { distanceMonthAvgKm: 1 },
      { areaWeekAvgKm2: 0.2 }, { areaMonthAvgKm2: 0.2 },
      { fuelBurnL: 10 }, { fuelDropL: 10 },
    ];
    for (const k of kinds) {
      expect(hasHistory({ vehicleId: "v", plate: "P", ...k }), JSON.stringify(k)).toBe(true);
    }
  });

  /* A parked unit whose tracker still reports has a recent fix and nothing to
   * show. Ranking on last-seen would put it above a machine that worked all
   * month, which inverts the whole point of the ordering. */
  it("does not count a recent fix as a history", () => {
    expect(hasHistory({
      vehicleId: "v", plate: "P", state: "PARKED",
      lastSeenAt: "2026-09-14T06:00:00Z",
      hoursToday: 0, distanceTodayKm: 0,
    })).toBe(false);
  });

  it("marks the silent ones so the control can say so", () => {
    const feed = { units: [
      { vehicleId: "a", plate: "AAA 001", category: "EX", hoursMonthAvg: 3 },
      { vehicleId: "b", plate: "BBB 002", category: "EX" },
    ] };
    expect(unitOptions(feed).map((o) => o.silent)).toEqual([false, true]);
  });
});

describe("filterForOrgChange, with units picked", () => {
  const picked = {
    mode: "month", month: "2026-08", from: "2026-08-01", to: "2026-08-21",
    categories: [], vehicles: ["v1", "v2"],
  };

  /* A vehicle id is org-scoped in the strongest sense: it names a lorry the new
   * organisation does not own. Carried across, the server intersects it away
   * and the page draws a fleet that appears to have stopped. */
  it("clears the units on an organisation switch", () => {
    expect(filterForOrgChange(picked, true).vehicles).toEqual([]);
  });

  it("keeps the date window", () => {
    expect(filterForOrgChange(picked, true).month).toBe("2026-08");
  });

  it("still returns the same object when there is nothing to clear", () => {
    const clean = { ...picked, categories: [], vehicles: [] };
    expect(filterForOrgChange(clean, true)).toBe(clean);
  });
});
