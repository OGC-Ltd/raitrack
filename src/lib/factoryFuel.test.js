import { describe, it, expect } from "vitest";
import { daysBetween, fuelRoster, odometerUnit, refillMeterUnit, fuelByDay, fuelTotals, departmentOptions, machineState, fuelRange, periodRange, calendarPick, withFuelNow, reconcileFills, pumpTimeMs, varianceFlagged, varianceBand, withConsumed, refillFigures, plannedLitres, withRefillColumns, withConsumedSinceRefill, withFuelBeforeWaiting, withProbeUsed } from "./factoryFuel";

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

  it("keeps each machine's latest odometer read at the pump (19 Nov: every Kasulu fuelling carries one)", () => {
    const d = { ...data, issues: [
      { id: "a", machine: "EX-14", day: "2026-11-17", at: "2026-11-17T07:10:00", litres: 90, readings: { physical: 5070.1 } },
      { id: "b", machine: "EX-14", day: "2026-11-18", at: "2026-11-18T06:40:00", litres: 100, readings: { physical: 5086.5 } },
      { id: "c", machine: "EX-14", day: "2026-11-18", at: "2026-11-18T05:00:00", litres: 20, readings: { physical: 5080 } },
      { id: "e", machine: "EX-14", day: "2026-11-18", at: "2026-11-18T09:00:00", litres: 5, readings: { physical: null } },
      { id: "f", machine: "GR-04", day: "2026-11-18", litres: 30 },
    ] };
    const byRef = Object.fromEntries(fuelRoster(d).map((r) => [r.reference, r]));
    expect(byRef["EX-14"]).toMatchObject({ odometer: 5086.5, odometerDay: "2026-11-18", odometerAt: "2026-11-18T06:40:00" });
    expect(byRef["GR-04"]).toMatchObject({ odometer: null, odometerDay: null });
    expect(byRef["FT-06"].odometer).toBeNull();
    expect([odometerUnit("HOUR"), odometerUnit("KM_PER_LITRE"), odometerUnit(null)]).toEqual(["h", "km", ""]);
    expect([refillMeterUnit("HOUR"), refillMeterUnit("hours"), refillMeterUnit("KM_PER_LITRE"), refillMeterUnit(null)]).toEqual(["h", "h", "km", "km"]);
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

describe("varianceBand", () => {
  it("is green to 2 L, amber to 5 L, red past that, either way round", () => {
    expect(varianceBand(null)).toBe(null);
    expect(varianceBand(0)).toBe("ok");
    expect(varianceBand(2)).toBe("ok");
    expect(varianceBand(-2)).toBe("ok");
    expect(varianceBand(2.01)).toBe("warn");
    expect(varianceBand(-4.5)).toBe("warn");
    expect(varianceBand(5)).toBe("warn");
    expect(varianceBand(5.01)).toBe("bad");
    expect(varianceBand(-6.62)).toBe("bad");
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
  it("reads a calendar range, either way round", () => {
    expect(periodRange("2026-11-03..2026-11-09", now)).toEqual({ from: "2026-11-03", to: "2026-11-09" });
    expect(periodRange("2026-11-09..2026-11-03", now)).toEqual({ from: "2026-11-03", to: "2026-11-09" });
  });
});

describe("calendarPick", () => {
  it("keeps one day as a day and a range as from..to", () => {
    expect(calendarPick("2026-11-03", "2026-11-03")).toBe("2026-11-03");
    expect(calendarPick("2026-11-03")).toBe("2026-11-03");
    expect(calendarPick("2026-11-03", "2026-11-09")).toBe("2026-11-03..2026-11-09");
  });
});

describe("refillFigures", () => {
  // EX-17 on 19 Nov 2026: shift 1 from 06:00 for 8 h, a full tank, fuelled
  // 08:31–09:07 EAT with 543 L on SIV-000027.
  const ex17 = () => {
    const [row] = fuelRoster({
      factory: "MUFINDI PAPER MILLS", from: "2026-11-19", to: "2026-11-19",
      lines: [line({ day: "2026-11-19", machine: "EX-17", fullTank: true, needLitres: 240, requestId: "r17", requestLitres: 650, shiftStart: "06:00:00", plannedHours: 8 })],
      issues: [{
        id: "i17", machine: "EX-17", day: "2026-11-19", litres: 543, done: true, flags: [], note: null, requestId: "r17",
        at: "2026-11-19T09:07:33.754", startedAt: "2026-11-19T08:31:45.901", siv: "SIV-000027",
        readings: { previous: null, estimated: null, physical: 4215.2 },
        sensor: { check: "MATCH", beforeL: 77, afterL: 641.9, riseL: 564.9, gapPercent: 4 },
      }],
      machines: [{ reference: "EX-17", basis: "HOUR", vehicleId: "v17", tankLitres: 650 }],
    });
    return row;
  };
  const probe = { id: "f1", vehicleId: "v17", filledAt: "2026-11-19T06:10:00Z", filledMl: 563_100, initialFuelLevelMl: 78_800, finalFuelLevelMl: 641_900, verdict: "REFILL" };
  const tracker = {
    refills: [{
      issueId: "i17", tracked: true,
      meterBefore: { value: 4214.1, at: "2026-11-19T05:30:00Z", unit: "h" },
      meterAfter: { value: 4214.1, at: "2026-11-19T06:10:00Z", unit: "h" },
      shift: { start: "2026-11-19T03:00:00Z", end: "2026-11-19T11:00:00Z", open: false, ahead: false, consumedL: 100.4, engineHours: 4.6 },
    }],
  };

  it("gives each fuelling's seven figures: ours where the probe saw the fill, the plan, the pump and the tracker", () => {
    const [row] = reconcileFills([ex17()], [probe]);
    expect(refillFigures(row, tracker)).toEqual([{
      key: "pump-i17", id: "i17", at: Date.parse("2026-11-19T06:07:33.754Z"), day: "2026-11-19", siv: "SIV-000027",
      fuelBefore: { litres: 78.8, source: "probe" },
      fuelAfter: { litres: 641.9, source: "probe" },
      consumed: { litres: 100.4, engineHours: 4.6, open: false, ahead: false },
      planned: { full: true, litres: 650, need: 240, shiftNo: 1, shiftStart: "06:00:00", hours: 8, km: null },
      // an hour-rated excavator: its hour meter keyed in at the pump, in h (operator 2026-11-20: engine hours for them)
      odometerBefore: { value: 4215.2, at: "2026-11-19T06:07:33.754Z", unit: "h", source: "pump" },
      trackerBefore: { value: 4214.1, at: "2026-11-19T05:30:00Z", unit: "h" },
      odometerAfter: 4215.2,
      trackerAfter: { value: 4214.1, at: "2026-11-19T06:10:00Z", unit: "h" },
      trackerNow: null,
      meterAfter: null,
      issued: 543,
      tracked: true,
    }]);
  });

  it("takes the pump's odometer for a machine with no tracker: before at each fuelling, after at the next", () => {
    const [row] = fuelRoster({
      factory: "MUFINDI PAPER MILLS", from: "2026-11-18", to: "2026-11-19",
      lines: [],
      issues: [
        { id: "a", machine: "T895DSZ", day: "2026-11-18", litres: 150, done: true, flags: [], note: null, at: "2026-11-18T09:00:00", readings: { physical: 7800 } },
        { id: "b", machine: "T895DSZ", day: "2026-11-19", litres: 202, done: true, flags: [], note: null, at: "2026-11-19T09:06:47", readings: { physical: 7961 } },
      ],
      machines: [{ reference: "T895DSZ", basis: "KM_PER_LITRE" }],
    });
    const meters = { refills: [{ issueId: "a", tracked: false }, { issueId: "b", tracked: false }] };
    const [latest, earlier] = refillFigures(reconcileFills([row], [])[0], meters);
    expect(latest.odometerBefore).toMatchObject({ value: 7961, source: "pump" });
    expect(latest.meterAfter).toBe(null);
    expect(earlier.odometerBefore).toMatchObject({ value: 7800, source: "pump" });
    expect(earlier.meterAfter).toMatchObject({ value: 7961, source: "next-refill-pump" });
    // The pump's reading is the default whether or not the machine is tracked.
    const tracked = refillFigures(reconcileFills([row], [])[0], { refills: [{ issueId: "a", tracked: true }, { issueId: "b", tracked: true }] });
    expect(tracked.map((r) => r.odometerBefore?.value)).toEqual([7961, 7800]);
  });

  it("falls back to FactorySuite's probe check where ours has no fill, and waits on the tracker without it", () => {
    const [row] = reconcileFills([ex17()], []);
    const [r] = refillFigures(row, null);
    expect(r.fuelBefore).toEqual({ litres: 77, source: "factorysuite" });
    expect(r.fuelAfter).toEqual({ litres: 641.9, source: "factorysuite" });
    expect(r).toMatchObject({ consumed: null, odometerBefore: { value: 4215.2, unit: "h", source: "pump" }, trackerBefore: null, trackerAfter: null, odometerAfter: 4215.2, issued: 543, tracked: null });
  });

  it("works a full tank's fuel before out from the pump where neither probe read it: the tank less what went in", () => {
    const bare = ex17();
    bare.pumpIssues = bare.pumpIssues.map((i) => ({ ...i, sensor: null }));
    const [r] = refillFigures(reconcileFills([bare], [])[0], null);
    expect(r.fuelBefore).toEqual({ litres: 107, source: "pump" }); // 650 − 543
    expect(r.fuelAfter).toEqual({ litres: 650, source: "pump" });
    // not a full tank, or no tank size: nothing to work it out from
    const part = { ...bare, tankLitres: null };
    expect(refillFigures(reconcileFills([part], [])[0], null)[0].fuelBefore).toBeNull();
  });

  it("has nothing to list for a machine the pump has not fuelled", () => {
    const [row] = reconcileFills([{ ...ex17(), pumpIssues: [] }], [probe]);
    expect(refillFigures(row, tracker)).toEqual([]);
  });
});

describe("plannedLitres", () => {
  it("is what a line asked for, or a full tank's request litres", () => {
    expect(plannedLitres(line({ litresRequested: 80 }))).toBe(80);
    expect(plannedLitres(line({ fullTank: true, requestLitres: 650 }))).toBe(650);
    expect(plannedLitres(line({ fullTank: true }))).toBeNull();
    expect(plannedLitres(line({ litresRequested: null, requestLitres: 25 }))).toBe(25);
  });

  it("adds up per machine, counting full tanks with no litres yet apart", () => {
    const [row] = fuelRoster({
      factory: "MUFINDI PAPER MILLS", from: "2026-11-19", to: "2026-11-20",
      lines: [
        line({ day: "2026-11-19", fullTank: true, requestLitres: 380, requestId: "a" }),
        line({ day: "2026-11-19", shiftNo: 2, litresRequested: 40 }),
        line({ day: "2026-11-20", fullTank: true }),
      ],
      issues: [],
      machines: [],
    });
    expect(row).toMatchObject({ planned: 420, plannedFull: 1 });
  });
});

describe("withRefillColumns", () => {
  // The server's odometer now (telemetry), on each refill of the machine.
  const nowAt = (meters, value, at = null) => ({ refills: meters.refills.map((r) => ({ ...r, meterNow: { value, at, unit: "km" } })) });
  const fills = (row, id, at, before, after) => ({
    ...row,
    pumpIssues: [...(row.pumpIssues ?? []), { id, litres: 100, done: true, readings: { physical: null } }],
    fills: [...(row.fills ?? []), { key: `pump-${id}`, at: Date.parse(at), day: at.slice(0, 10), before, actual: 100, probeFill: { before, after } }],
  });

  it("puts each row's latest refill in its columns, and counts the rest for the panel", () => {
    let row = { reference: "EX-17", lines: [], pumpIssues: [], fills: [] };
    row = fills(row, "a", "2026-11-18T06:00:00Z", 50, 400);
    row = fills(row, "b", "2026-11-19T06:00:00Z", 78.8, 641.9);
    const meters = { refills: [{ issueId: "b", tracked: true, meterBefore: { value: 4214.1, at: "2026-11-19T05:30:00Z", unit: "km" }, meterAfter: null, shift: null }] };
    const [out] = withRefillColumns([row], meters);
    expect(out).toMatchObject({ fuelBefore: 78.8, fuelAfter: 641.9, odometerBefore: 4214.1, refillCount: 2 });
    expect(out.lastRefill.id).toBe("b");
  });

  it("takes a km pump reading by default: after is the next fuelling's reading, or the latest's plus the tracker's km since", () => {
    let row = { reference: "FT-14", basis: "KM_PER_LITRE", lines: [], pumpIssues: [], fills: [] };
    row = fills(row, "a", "2026-11-18T04:41:00Z", 226.7, 376.4);
    row = fills(row, "b", "2026-11-19T08:42:00Z", 148.7, 377.1);
    row.pumpIssues[0].readings = { physical: 1870.13 };
    row.pumpIssues[1].readings = { physical: 1891.52 };
    const at = (v, t = "2026-11-19T05:42:00Z") => ({ value: v, at: t, unit: "km" });
    const meters = { refills: [
      { issueId: "a", tracked: true, meterBefore: at(2289.6, "2026-11-18T04:40:00Z"), meterAfter: null, shift: null },
      { issueId: "b", tracked: true, meterBefore: at(2310.9), meterAfter: at(2311), shift: null },
    ] };
    const [out] = withRefillColumns([row], nowAt(meters, 2318.4, "2026-11-20T10:00:00Z"));
    // 1,891.52 km at the pump + 7.5 km the tracker has run since (2,318.4 − 2,310.9)
    expect(out).toMatchObject({ odometerBefore: 1891.52, odometerAfter: 1899.02 });
    expect(out.lastRefill.meterAfter).toMatchObject({ source: "now-pump", run: 7.5 });
    const all = refillFigures(row, meters);
    expect(all[1].odometerBefore).toMatchObject({ value: 1870.13, source: "pump" });
    expect(all[1].meterAfter).toMatchObject({ value: 1891.52, source: "next-refill-pump" });
    // no meter now, or no tracker reading at the fuelling: no run to add, blank
    expect(withRefillColumns([row], meters)[0].odometerAfter).toBeNull();
    const noTracker = { refills: meters.refills.map((r) => ({ ...r, meterBefore: null })) };
    expect(withRefillColumns([row], nowAt(noTracker, 2318.4))[0].odometerAfter).toBeNull();
  });

  it("falls back to the tracker's meter without a pump reading: its meter now, or before the next refill, never below the before", () => {
    let row = { reference: "EX-26", lines: [], pumpIssues: [], fills: [] };
    row = fills(row, "a", "2026-11-19T04:41:00Z", 226.7, 376.4);
    row = fills(row, "b", "2026-11-19T08:42:00Z", 148.7, 377.1);
    const at = (v, t = "2026-11-19T05:42:00Z") => ({ value: v, at: t, unit: "km" });
    const meters = { refills: [
      { issueId: "a", tracked: true, meterBefore: at(2306.2, "2026-11-19T04:40:00Z"), meterAfter: null, shift: null },
      { issueId: "b", tracked: true, meterBefore: at(2310.9), meterAfter: at(2311), shift: null },
    ] };
    const [out] = withRefillColumns([row], nowAt(meters, 2318.4, "2026-11-20T10:00:00Z"));
    expect(out).toMatchObject({ odometerBefore: 2310.9, odometerAfter: 2318.4 });
    // the live snapshot's mileage (Wialon's own counter) is never used for it
    expect(withRefillColumns([{ ...row, meterNow: at(37488) }], meters)[0].odometerAfter).toBeNull();
    expect(out.lastRefill.meterAfter.source).toBe("now");
    expect(refillFigures(row, meters)[1].meterAfter).toMatchObject({ value: 2310.9, source: "next-refill" });
    expect(withRefillColumns([row], nowAt(meters, 2300))[0].odometerAfter).toBeNull();
    // an hour-rated machine reads its hours, never the tracker's km
    expect(refillFigures({ ...row, basis: "HOUR" }, meters)[0].odometerBefore).toBeNull();
    row.pumpIssues[1].readings = { physical: 1891.52 };
    expect(refillFigures({ ...row, basis: "HOUR" }, meters)[0].odometerBefore).toMatchObject({ value: 1891.52, unit: "h", source: "pump" });
  });

  it("shows nothing from an older server that sends the tracker's hours, never them as km", () => {
    let row = { reference: "EX-17", basis: "HOUR", lines: [], pumpIssues: [], fills: [] };
    row = fills(row, "b", "2026-11-19T06:00:00Z", 78.8, 641.9);
    const hours = { refills: [{ issueId: "b", tracked: true, meterBefore: { value: 4214.1, at: "2026-11-19T05:30:00Z" }, meterAfter: null, shift: null }] };
    const [out] = withRefillColumns([{ ...row, meterNow: { value: 598, at: null } }], hours);
    expect(out).toMatchObject({ odometerBefore: null, odometerAfter: null });
  });

  it("shows a generator's hour meter in h: the pump's hours, never the live GPS odometer", () => {
    let row = { reference: "DG-19", basis: "HOUR", lines: [], pumpIssues: [], fills: [] };
    row = fills(row, "a", "2026-11-19T06:41:00Z", null, null);
    row.pumpIssues[0].readings = { physical: 320.41 };
    const [out] = withRefillColumns([{ ...row, meterNow: { value: 900, at: null, unit: "km" } }], { refills: [{ issueId: "a", tracked: false }] });
    expect(out.lastRefill.odometerBefore).toMatchObject({ value: 320.41, unit: "h", source: "pump" });
    expect(out).toMatchObject({ odometerBefore: 320.41, odometerAfter: null });
  });

  it("reads a tracked generator's engine hours: before, and after as the hours now", () => {
    let row = { reference: "DG-08", basis: "HOUR", lines: [], pumpIssues: [], fills: [] };
    row = fills(row, "a", "2026-11-19T06:41:00Z", 40, 180);
    const h = (v, t = "2026-11-19T06:30:00Z") => ({ value: v, at: t, unit: "h" });
    const hours = { refills: [{ issueId: "a", tracked: true, meterBefore: h(5086.5), meterAfter: h(5086.5), meterNow: h(5094.2, "2026-11-20T08:00:00Z"), shift: null }] };
    const [out] = withRefillColumns([row], hours);
    expect(out).toMatchObject({ odometerBefore: 5086.5, odometerAfter: 5094.2 });
    expect(out.lastRefill.meterAfter).toMatchObject({ unit: "h", source: "now" });
    // the km an older server sent for every machine is left out
    const km = { refills: [{ ...hours.refills[0], meterBefore: { ...h(4.2), unit: "km" }, meterNow: { ...h(4.3), unit: "km" } }] };
    expect(withRefillColumns([row], km)[0]).toMatchObject({ odometerBefore: null, odometerAfter: null });
  });

  it("counts Consumed from the latest refill, to now or to the period's last day", () => {
    let row = { reference: "EX-17", vehicleId: "v17", lines: [], pumpIssues: [], fills: [], consumed: 606 };
    row = fills(row, "b", "2026-11-19T06:00:00Z", 77.66, 641.92);
    const days = [
      { vehicleId: "v17", day: "2026-11-19", openingL: 89.846, closingL: 468.197, fillL: 557.651, drainL: 0 },
      { vehicleId: "v17", day: "2026-11-20", openingL: 468.197, closingL: null, fillL: 30, drainL: 10 },
    ];
    const [now] = withConsumedSinceRefill(withRefillColumns([{ ...row, lastDay: "2026-11-20", fuelNow: 468.36 }], null), days, "2026-11-20");
    expect(now).toMatchObject({ consumed: 193.56, consumedEnd: "now", consumedPeriod: 606 }); // 641.92 + 30 − 10 − 468.36
    const [past] = withConsumedSinceRefill(withRefillColumns([{ ...row, lastDay: "2026-11-19", fuelNow: 468.36 }], null), days, "2026-11-20");
    expect(past).toMatchObject({ consumed: 173.72, consumedEnd: "2026-11-19" }); // 641.92 − 468.197
  });

  it("leaves Consumed empty with no refill, no level at the end, or a balance below zero", () => {
    const base = { reference: "EX-17", vehicleId: "v17", lines: [], pumpIssues: [], fills: [], lastDay: "2026-11-20" };
    expect(withConsumedSinceRefill(withRefillColumns([{ ...base, fuelNow: 300 }], null), [], "2026-11-20")[0].consumed).toBeNull();
    const refilled = fills(base, "b", "2026-11-19T06:00:00Z", 77.66, 641.92);
    expect(withConsumedSinceRefill(withRefillColumns([{ ...refilled, fuelNow: null }], null), [], "2026-11-20")[0].consumed).toBeNull();
    expect(withConsumedSinceRefill(withRefillColumns([{ ...refilled, fuelNow: 700 }], null), [], "2026-11-20")[0].consumed).toBeNull();
  });

  it("leaves the columns empty for a machine the pump has not fuelled, or while the meters are unread", () => {
    const [none] = withRefillColumns([{ reference: "EX-02", lines: [], pumpIssues: [], fills: [] }], null);
    expect(none).toMatchObject({ lastRefill: null, refillCount: 0, fuelBefore: null, fuelAfter: null, odometerBefore: null });
    const [unread] = withRefillColumns([fills({ reference: "EX-17", lines: [] }, "b", "2026-11-19T06:00:00Z", 78.8, 641.9)], null);
    expect(unread).toMatchObject({ fuelBefore: 78.8, odometerBefore: null });
    expect(unread.lastRefill.tracked).toBeNull();
  });
});

describe("withFuelBeforeWaiting", () => {
  // Operator 2026-11-20: Fuel before is the closing level, moving with the
  // probe, until the day's first refill, which then gives its own before.
  const days = [{ vehicleId: "v1", day: "2026-11-19", closingL: 42.4 }];
  const base = { vehicleId: "v1", fuelBefore: null, lastRefill: null, fuelNow: 59.2 };

  it("shows the live tank on Today until the day's refill", () => {
    const [row] = withFuelBeforeWaiting([{ ...base, lastDay: "2026-11-20" }], days, "2026-11-20");
    expect(row.fuelBefore).toBe(59.2);
    expect(row.fuelBeforeWaiting).toEqual({ litres: 59.2, source: "live", day: "2026-11-20" });
  });

  it("shows a past day's closing level when that day had no refill", () => {
    const [row] = withFuelBeforeWaiting([{ ...base, lastDay: "2026-11-19" }], days, "2026-11-20");
    expect(row.fuelBeforeWaiting).toEqual({ litres: 42.4, source: "closing", day: "2026-11-19" });
  });

  it("keeps the refill's own before, and never puts a post-refill level in its place", () => {
    const read = { ...base, lastDay: "2026-11-20", fuelBefore: 37.4, lastRefill: { day: "2026-11-20" } };
    expect(withFuelBeforeWaiting([read], days, "2026-11-20")[0]).toBe(read);
    const unread = { ...base, lastDay: "2026-11-20", lastRefill: { day: "2026-11-20" } };
    expect(withFuelBeforeWaiting([unread], days, "2026-11-20")[0].fuelBefore).toBeNull();
  });

  it("shows the engine hours now as Odometer before on Today, never on a past day or in km", () => {
    const meterNow = { value: 967.62, unit: "h", at: null };
    const [today] = withFuelBeforeWaiting([{ ...base, meterNow, odometerBefore: null, lastDay: "2026-11-20" }], days, "2026-11-20");
    expect(today.odometerBefore).toBe(967.62);
    expect(today.odometerBeforeWaiting).toEqual({ ...meterNow, source: "live" });
    const [past] = withFuelBeforeWaiting([{ ...base, meterNow, odometerBefore: null, lastDay: "2026-11-19" }], days, "2026-11-20");
    expect(past.odometerBefore).toBeNull();
    const km = { value: 217078, unit: "km", at: null };
    const [kmRow] = withFuelBeforeWaiting([{ ...base, meterNow: km, odometerBefore: null, lastDay: "2026-11-20" }], days, "2026-11-20");
    expect(kmRow.odometerBefore).toBeNull();
  });

  it("reads an hour-rated machine's live meter in engine hours", () => {
    const vehicles = [{ vehicleId: "v1", engineHours: 967.62, odometerKm: 12 }];
    expect(withFuelNow([{ vehicleId: "v1", basis: "HOUR" }], vehicles)[0].meterNow).toMatchObject({ value: 967.62, unit: "h" });
    expect(withFuelNow([{ vehicleId: "v1", basis: "KM_PER_LITRE" }], vehicles)[0].meterNow).toMatchObject({ value: 12, unit: "km" });
  });

  it("leaves a machine without a probe level blank", () => {
    const [row] = withFuelBeforeWaiting([{ ...base, fuelNow: null, lastDay: "2026-11-20" }], days, "2026-11-20");
    expect(row.fuelBefore).toBeNull();
    expect(row.fuelBeforeWaiting).toBeUndefined();
  });
});

describe("withProbeUsed (operator 2026-11-20: standard rate × hours worked since the refill)", () => {
  const refill = (before, after, source = "now") => ({ odometerBefore: { value: before, unit: "h" }, meterAfter: after == null ? null : { value: after, unit: "h", source } });
  it("is the rated L/h times the hours between Odometer before and after", () => {
    const [ex01] = withProbeUsed([{ reference: "EX-01", basis: "HOUR", rate: 12, lastRefill: refill(1000, 1003.6) }]);
    expect(ex01).toMatchObject({ probeUsed: 43.2, probeUse: { run: 3.6, unit: "h", rate: 12, litres: 43.2, open: true } });
  });
  it("divides the km run by the km/L standard on a km-rated machine", () => {
    const [ft] = withProbeUsed([{ reference: "FT-06", basis: "KM", rate: 2.5, lastRefill: { odometerBefore: { value: 1800, unit: "km" }, meterAfter: { value: 1900, unit: "km", source: "next-refill" } } }]);
    expect(ft).toMatchObject({ probeUsed: 40, probeUse: { run: 100, unit: "km", open: false } });
  });
  it("is blank with no refill, no after reading or no standard", () => {
    const out = withProbeUsed([
      { reference: "A", basis: "HOUR", rate: 12 },
      { reference: "B", basis: "HOUR", rate: 12, lastRefill: refill(1000, null) },
      { reference: "C", basis: "HOUR", rate: null, lastRefill: refill(1000, 1002) },
    ]);
    expect(out.map((r) => r.probeUsed)).toEqual([null, null, null]);
    expect(out[0].probeUse).toMatchObject({ run: null, litres: null });
    expect(out[2].probeUse).toMatchObject({ run: 2, rate: null, litres: null });
  });
});
