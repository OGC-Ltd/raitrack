import { describe, it, expect } from "vitest";
import { daysBetween, fuelRoster, fuelByDay, fuelTotals, departmentOptions, machineState, fuelRange, periodRange, withFuelNow, reconcileFills, pumpTimeMs, varianceFlagged, withConsumed } from "./factoryFuel";

const line = (o) => ({
  lineId: "l", taskId: "t", planId: "p", planCode: "WP", planStatus: "APPROVED", department: "AGRICULTURE",
  day: "2026-11-13", machine: "FT-06", activity: "Haulage", workLocation: "Nursery A", shiftNo: 1,
  fullTank: false, litresRequested: null, needLitres: null, requestStatus: null, requestId: null, issuedLitres: 0, ...o,
});

const data = {
  factory: "MUFINDI PAPER MILLS", from: "2026-11-12", to: "2026-11-14",
  lines: [
    line({ day: "2026-11-14", activity: "Cane haulage", fullTank: true, needLitres: 50, requestId: "r2" }),
    line({ day: "2026-11-13", litresRequested: 40, needLitres: 30, requestId: "r1" }),
    line({ day: "2026-11-13", machine: "EX-01", department: "ROADS", planStatus: "DRAFT", litresRequested: 80, needLitres: 78 }),
  ],
  issues: [
    { id: "i1", machine: "FT-06", day: "2026-11-13", litres: 100, done: true, flags: ["Operator mismatch"], note: null },
    { id: "i2", machine: "GR-04", day: "2026-11-12", litres: 20, done: true, flags: [], note: "no GPS position was recorded", department: "ROADS" },
  ],
  machines: [
    { reference: "FT-06", name: "Truck", status: "BROKEN_DOWN", downReason: "ELECTRICAL FAULT", tankLitres: 380, plate: "T968DZY" },
    { reference: "EX-01", name: "Excavator", status: null },
  ],
};

describe("factoryFuel", () => {
  it("walks the days of a range", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("adds each machine up, department first, code in natural order", () => {
    const rows = fuelRoster(data);
    expect(rows.map((r) => r.reference)).toEqual(["FT-06", "EX-01", "GR-04"]);
    expect(rows[0]).toMatchObject({
      name: "Truck", department: "AGRICULTURE", activity: "Cane haulage", lastDay: "2026-11-14", firstDay: "2026-11-13",
      shifts: 2, days: 2, approved: 2, pending: 0, fullTanks: 1, requested: 40, need: 80, issued: 100, issues: 1, flagged: 1,
    });
    expect(rows[1]).toMatchObject({ department: "ROADS", pending: 1, requested: 80, need: 78, issued: 0 });
    // At the pump only: still a row, with the pump's department.
    expect(rows[2]).toMatchObject({ department: "ROADS", shifts: 0, issued: 20, flagged: 1, requested: null, need: null });
  });

  it("lays the range out day by day", () => {
    expect(fuelByDay(data)).toEqual([
      { day: "2026-11-12", shifts: 0, need: 0, requested: 0, issued: 20 },
      { day: "2026-11-13", shifts: 2, need: 108, requested: 120, issued: 100 },
      { day: "2026-11-14", shifts: 1, need: 50, requested: 0, issued: 0 },
    ]);
    const only = fuelRoster(data).filter((r) => r.department === "ROADS");
    expect(fuelByDay(data, only).map((d) => d.issued)).toEqual([20, 0, 0]);
  });

  it("sums the strip", () => {
    const t = fuelTotals(fuelRoster(data));
    expect(t).toMatchObject({ machines: 3, onPlans: 2, shifts: 3, approved: 2, pending: 1, need: 158, requested: 120, issued: 120,
      requests: 2, broken: 1, departments: 2 });
    expect(t.flags).toMatchObject({ "Operator mismatch": 1, note: 1, "Off plan": 0 });
  });

  it("offers each department once, with its machines and plan lines (shifts)", () => {
    expect(departmentOptions(fuelRoster(data))).toEqual([
      { key: "AGRICULTURE", label: "Agriculture", count: 1, shifts: 2 },
      { key: "ROADS", label: "Roads", count: 2, shifts: 1 },
    ]);
  });

  it("says the machine's state", () => {
    expect(machineState({ status: null })).toEqual({ label: "Available", tone: "active" });
    expect(machineState({ status: "BROKEN_DOWN" })).toEqual({ label: "Broken down", tone: "terminated" });
  });

  it("ends the range on tomorrow, the day being planned today", () => {
    expect(fuelRange(7, Date.parse("2026-11-14T10:00:00Z"))).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });
});

describe("withFuelNow", () => {
  const vehicles = [
    { id: "MUFINDI - EX 16", vehicleId: "veh_ex16", fuelLitres: 320.4, tankCapacityL: 640 },
    { id: "MUFINDI - CTR 06", vehicleId: "veh_ctr06", fuelLitres: 7184, tankCapacityL: 540 },
    { id: "MUFINDI - WL 06", vehicleId: "veh_wl06", fuelLitres: null, tankCapacityL: 300 },
  ];

  it("matches on the register's vehicleId", () => {
    const [r] = withFuelNow([{ reference: "EX-16", vehicleId: "veh_ex16", plate: "something else" }], vehicles);
    expect(r.fuelNow).toBeCloseTo(320.4);
    expect(r.fuelNowPct).toBeCloseTo(50, 0);
  });

  it("falls back to the plate, ignoring spaces, dashes and case", () => {
    const [r] = withFuelNow([{ reference: "EX-16", vehicleId: null, plate: "mufindi-ex16" }], vehicles);
    expect(r.fuelNow).toBeCloseTo(320.4);
  });

  it("keeps the litres but drops an impossible percentage, as Maintenance does", () => {
    const [r] = withFuelNow([{ reference: "CTR-06", vehicleId: "veh_ctr06" }], vehicles);
    expect(r.fuelNow).toBe(7184);
    expect(r.fuelNowPct).toBeNull();
  });

  it("gives null, not 0, with no probe reading or no unit", () => {
    const rows = withFuelNow([
      { reference: "WL-06", vehicleId: "veh_wl06" },
      { reference: "EX-99", vehicleId: null, plate: null },
    ], vehicles);
    expect(rows.map((r) => [r.fuelNow, r.fuelNowPct])).toEqual([[null, null], [null, null]]);
  });

  it("copes with no live fleet yet", () => {
    expect(withFuelNow([{ reference: "EX-16", vehicleId: "veh_ex16" }], undefined)[0].fuelNow).toBeNull();
  });
});

describe("pumpTimeMs", () => {
  it("reads FactorySuite's offsetless clock as Nairobi time", () => {
    expect(pumpTimeMs("2026-11-15T06:12:00")).toBe(Date.parse("2026-11-15T03:12:00Z"));
  });
  it("takes a time with a zone as it is, and nothing as null", () => {
    expect(pumpTimeMs("2026-11-15T06:12:00Z")).toBe(Date.parse("2026-11-15T06:12:00Z"));
    expect(pumpTimeMs(null)).toBeNull();
  });
});

describe("varianceFlagged", () => {
  it("flags past the larger of 20 L and 5% of what was issued", () => {
    expect(varianceFlagged(100, 19)).toBe(false);   // under 20 L
    expect(varianceFlagged(100, 21)).toBe(true);
    expect(varianceFlagged(1000, 45)).toBe(false);  // under 5% (50 L)
    expect(varianceFlagged(1000, -51)).toBe(true);
    expect(varianceFlagged(1000, null)).toBe(false);
    expect(varianceFlagged(180, 20.3)).toBe(false);  // shown as 20 L: not past 20 L
    expect(varianceFlagged(180, 20.6)).toBe(true);   // shown as 21 L
  });
});

describe("reconcileFills", () => {
  const fill = (id, at, litres, extra = {}) => ({
    id, vehicleId: "veh_ctr06", filledAt: at, filledMl: litres * 1000,
    initialFuelLevelMl: 537_000, finalFuelLevelMl: 537_000 + litres * 1000, verdict: "CONFIRMED", ...extra,
  });
  const machine = (issues, lines = []) => {
    const pumpIssues = issues.map((i, k) => ({ id: `i${k}`, done: true, day: "2026-11-15", requestId: null, ...i }));
    return {
      reference: "CTR-06", vehicleId: "veh_ctr06", plate: "MUFINDI - CTR 06", tankLitres: 1650, lines, pumpIssues,
      issues: pumpIssues.length, issued: pumpIssues.reduce((s, i) => s + (i.litres ?? 0), 0),
    };
  };

  it("pairs a fuelling with the probe fill just after it, and works out the variance", () => {
    const [r] = reconcileFills(
      [machine([{ at: "2026-11-15T06:12:00", litres: 1100, requestId: "req1" }], [{ requestId: "req1", fullTank: true }])],
      [fill("f1", "2026-11-15T03:40:00Z", 1060)],      // 06:40 Nairobi, 28 min after
    );
    const [f] = r.fills;
    expect(f).toMatchObject({ actual: 1100, probe: 1060, variance: 40, before: 537, state: "ok", request: { full: true } });
    expect(f.expected).toBe(1113);                      // 1,650 L tank less 537 L in it
    expect(r).toMatchObject({ probeFilled: 1060, variance: 40, varianceFlags: 0 });
  });

  it("flags a variance past tolerance", () => {
    const [r] = reconcileFills([machine([{ at: "2026-11-15T06:12:00", litres: 300 }])],
      [fill("f1", "2026-11-15T03:30:00Z", 250)]);
    expect(r.fills[0]).toMatchObject({ variance: 50, state: "over" });
    expect(r.varianceFlags).toBe(1);
  });

  it("leaves a fill outside the window unpaired, and does not list it", () => {
    const [r] = reconcileFills([machine([{ at: "2026-11-15T06:12:00", litres: 300 }])],
      [fill("f1", "2026-11-15T09:00:00Z", 300)]);      // 12:00 Nairobi, nearly 6 h later
    expect(r.fills.map((f) => f.state)).toEqual(["no-probe"]);
    expect(r.varianceFlags).toBe(1);
    expect(r).toMatchObject({ pumpMatched: null, probeFilled: null, variance: null });
  });

  it("uses each probe fill once, nearest first", () => {
    const [r] = reconcileFills(
      [machine([{ at: "2026-11-15T06:00:00", litres: 200 }, { at: "2026-11-15T06:30:00", litres: 150 }])],
      [fill("a", "2026-11-15T03:05:00Z", 200), fill("b", "2026-11-15T03:35:00Z", 150)],
    );
    const pairs = r.fills.map((f) => [f.actual, f.probeFill?.id]).sort();
    expect(pairs).toEqual([[150, "b"], [200, "a"]]);
  });

  it("never matches a reading that was no real fill", () => {
    const [r] = reconcileFills([machine([{ at: "2026-11-15T06:12:00", litres: 300 }])],
      [fill("f1", "2026-11-15T03:30:00Z", 300, { verdict: "REDISTRIBUTION" })]);
    expect(r.fills[0]).toMatchObject({ state: "no-probe", probe: null, variance: null });
  });

  it("matches the real fill past a nearer reading that was no real fill", () => {
    const [r] = reconcileFills([machine([{ at: "2026-11-15T06:12:00", litres: 300 }])], [
      fill("noise", "2026-11-15T03:13:00Z", 20, { verdict: "REDISTRIBUTION" }),
      fill("real", "2026-11-15T03:50:00Z", 290),
    ]);
    expect(r.fills[0]).toMatchObject({ state: "ok", probe: 290, variance: 10 });
    expect(r.fills[0].probeFill.id).toBe("real");
  });

  it("matches on the plate when the register has no vehicleId", () => {
    const m = { ...machine([{ at: "2026-11-15T06:12:00", litres: 300 }]), vehicleId: null };
    const [r] = reconcileFills([m], [{ ...fill("f1", "2026-11-15T03:30:00Z", 300), vehicleId: "other", vehicle: { registrationPlate: "Mufindi-CTR06" } }]);
    expect(r.fills[0].state).toBe("ok");
  });

  it("compares fuellings only: a probe fill with no fuelling is neither listed nor counted", () => {
    const [r] = reconcileFills(
      [machine([{ at: "2026-11-16T10:01:00", litres: 71 }])],
      [fill("pumped", "2026-11-16T07:20:00Z", 58),      // 10:20 Nairobi, after the fuelling
       fill("a", "2026-11-16T17:29:00Z", 28),           // 20:29, no fuelling near it
       fill("b", "2026-11-12T06:49:00Z", 15)],
    );
    expect(r.fills).toHaveLength(1);
    expect(r).toMatchObject({ pumpMatched: 71, probeFilled: 58, variance: 13, varianceFlags: 0 });
  });

  it("totals pump and probe over the fuellings both recorded", () => {
    const [r] = reconcileFills(
      [machine([{ at: "2026-11-15T06:00:00", litres: 200 }, { at: "2026-11-16T06:00:00", litres: 100 }])],
      [fill("a", "2026-11-15T03:20:00Z", 190)],          // only the first fuelling has a probe fill
    );
    expect(r).toMatchObject({ pumpMatched: 200, probeFilled: 190, variance: 10, varianceFlags: 1 });
  });

  it("leaves both totals blank with nothing issued and no probe fill", () => {
    const [r] = reconcileFills([machine([])], []);
    expect(r).toMatchObject({ probeFilled: null, variance: null, varianceOver: false });
  });

  it("says unknown, not missing, when the fillings could not be read", () => {
    const [r] = reconcileFills([machine([{ at: "2026-11-15T06:12:00", litres: 300 }])], null);
    expect(r.fills[0].state).toBe("unknown");
    expect(r.varianceFlags).toBe(0);
  });

  it("ignores a fuelling still in progress", () => {
    const [r] = reconcileFills([machine([{ at: "2026-11-15T06:12:00", litres: null, done: false }])], []);
    expect(r.fills).toEqual([]);
  });
});

describe('withConsumed', () => {
  const td = (day, o) => ({ vehicleId: 'v1', day, openingL: null, closingL: null, fillL: 0, drainL: 0, ...o });
  const row = (o) => ({ reference: 'EX-21', vehicleId: 'v1', plate: null, firstDay: '2026-11-13', lastDay: '2026-11-15', fuelNow: null, ...o });

  it('balances the period: start + fills - drains - end', () => {
    const days = [td('2026-11-13', { openingL: 300, fillL: 200 }), td('2026-11-14', { fillL: 100, drainL: 20 }), td('2026-11-15', { closingL: 250 })];
    const [r] = withConsumed([row({})], days, [], '2026-11-18');
    expect(r.consumed).toBe(300 + 300 - 20 - 250);
  });

  it('ends on the live reading when the period runs to today, and stops at today', () => {
    const days = [td('2026-11-17', { openingL: 400, fillL: 100 }), td('2026-11-18', { fillL: 50 }), td('2026-11-19', { fillL: 999 })];
    const [r] = withConsumed([row({ firstDay: '2026-11-17', lastDay: '2026-11-19', fuelNow: 300 })], days, [], '2026-11-18');
    expect(r.consumed).toBe(400 + 150 - 300);
  });

  it('matches by plate when the row has no vehicleId', () => {
    const days = [td('2026-11-13', { openingL: 100 }), td('2026-11-15', { closingL: 40 })];
    const [r] = withConsumed([row({ vehicleId: null, plate: 'KDA 101A' })], days, [{ vehicleId: 'v1', plate: 'KDA101A' }], '2026-11-18');
    expect(r.consumed).toBe(60);
  });

  it('is null with no level at either end, no unit, a future period, or a negative balance', () => {
    const days = [td('2026-11-13', { openingL: 100 }), td('2026-11-15', { closingL: 140 })];
    expect(withConsumed([row({})], [td('2026-11-15', { closingL: 40 })], [], '2026-11-18')[0].consumed).toBeNull();
    expect(withConsumed([row({ vehicleId: 'other' })], days, [], '2026-11-18')[0].consumed).toBeNull();
    expect(withConsumed([row({ firstDay: '2026-11-19', lastDay: '2026-11-19' })], days, [], '2026-11-18')[0].consumed).toBeNull();
    expect(withConsumed([row({})], days, [], '2026-11-18')[0].consumed).toBeNull();
  });
});

describe("periodRange", () => {
  const now = Date.parse("2026-11-19T22:30:00Z"); // 01:30 on the 20th in EAT
  it("reads Today as the fleet day", () => {
    expect(periodRange("today", now)).toEqual({ from: "2026-11-20", to: "2026-11-20" });
  });
  it("reads a picked day as that day", () => {
    expect(periodRange("2026-11-03", now)).toEqual({ from: "2026-11-03", to: "2026-11-03" });
  });
  it("reads a number of days as fuelRange", () => {
    expect(periodRange(7, now)).toEqual(fuelRange(7, now));
  });
});
