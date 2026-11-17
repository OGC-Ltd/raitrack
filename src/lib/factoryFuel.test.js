import { describe, it, expect } from "vitest";
import { daysBetween, fuelRoster, fuelByDay, fuelTotals, departmentOptions, machineState, fuelRange, withFuelNow } from "./factoryFuel";

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

  it("offers each department once", () => {
    expect(departmentOptions(fuelRoster(data))).toEqual([
      { key: "AGRICULTURE", label: "Agriculture", count: 1 },
      { key: "ROADS", label: "Roads", count: 2 },
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
