import { describe, it, expect } from "vitest";
import { unitTripRows, unitTripTotals, kmPerTrip, kmOfDay, kmOfUnitDistance, trackedIdsByDay } from "./unitTrips";

// Fleet days are East Africa Time (UTC+3): 22:30Z on the 17th is 01:30 on the 18th.
const t = (tokenAt, plate, extra = {}) => ({ tokenAt, vehiclePlate: plate, vehicleNo: plate, netWeightKg: 10_000, ...extra });

describe("unitTripRows", () => {
  it("counts each ticket as a trip, per unit per fleet day", () => {
    const rows = unitTripRows([
      t("2026-11-18T05:00:00Z", "KBA123A", { vehicleId: "v1", driverName: "Otieno" }),
      t("2026-11-18T09:00:00Z", "KBA123A", { driverName: "Otieno" }),
      t("2026-11-18T12:00:00Z", "KBA123A", { driverName: "Achieng" }),
      t("2026-11-18T06:00:00Z", "KCC555C"),
    ]);
    expect(rows.map((r) => [r.plate, r.trips])).toEqual([["KBA123A", 3], ["KCC555C", 1]]);
    expect(rows[0].vehicleId).toBe("v1");
    expect(rows[0].drivers).toEqual(["Otieno", "Achieng"]);
    expect(rows[0].netKg).toBe(30_000);
  });

  it("files a ticket under its fleet day, not its UTC day", () => {
    const rows = unitTripRows([t("2026-11-17T22:30:00Z", "KBA123A"), t("2026-11-17T20:00:00Z", "KBA123A")]);
    expect(rows.map((r) => [r.day, r.trips])).toEqual([["2026-11-18", 1], ["2026-11-17", 1]]);
  });

  it("takes the day's GPS kilometres for tracked units and leaves untracked ones empty", () => {
    const km = new Map([["2026-11-18", new Map([["v1", { km: 142.34, source: "odometer" }]])]]);
    const rows = unitTripRows([
      t("2026-11-18T05:00:00Z", "KBA123A", { vehicleId: "v1" }),
      t("2026-11-18T08:00:00Z", "KBA123A", { vehicleId: "v1" }),
      t("2026-11-18T05:00:00Z", "KCC555C"),
      t("2026-11-18T05:00:00Z", "KDD777D", { vehicleId: "v9" }),
    ], km);
    const by = Object.fromEntries(rows.map((r) => [r.plate, r]));
    expect(by.KBA123A.km).toBe(142.3);
    expect(by.KBA123A.kmSource).toBe("odometer");
    expect(kmPerTrip(by.KBA123A)).toBe(71.2);
    expect(by.KCC555C.km).toBeNull();
    expect(by.KDD777D.km).toBeNull();
    expect(kmPerTrip(by.KCC555C)).toBeNull();
  });

  it("reads a weighed unit's zero as no GPS fixes, not a unit that stood still", () => {
    const [row] = unitTripRows([t("2026-11-18T05:00:00Z", "KTCB045X", { vehicleId: "v2" })], new Map([["2026-11-18", new Map([["v2", { km: 0, source: "gps" }]])]]));
    expect(row.km).toBeNull();
    expect(row.noFixes).toBe(true);
    expect(row.kmSource).toBeNull();
  });

  it("puts the furthest first among units with as many trips, and no distance last", () => {
    const km = new Map([["2026-11-18", new Map([["a", { km: 20, source: "gps" }], ["b", { km: 90, source: "gps" }]])]]);
    const rows = unitTripRows([
      t("2026-11-18T05:00:00Z", "AAA", { vehicleId: "a" }),
      t("2026-11-18T05:00:00Z", "BBB", { vehicleId: "b" }),
      t("2026-11-18T05:00:00Z", "CCC"),
    ], km);
    expect(rows.map((r) => r.plate)).toEqual(["BBB", "AAA", "CCC"]);
  });

  it("skips tickets with no time or plate", () => {
    expect(unitTripRows([{ vehiclePlate: "X" }, { tokenAt: "2026-11-18T05:00:00Z" }])).toEqual([]);
  });
});

describe("unitTripTotals", () => {
  it("adds trips and the tracked unit-days' kilometres", () => {
    const totals = unitTripTotals([
      { plate: "A", trips: 3, netKg: 30_000, km: 100.25, kmSource: "odometer" },
      { plate: "A", trips: 1, netKg: 5_000, km: null },
      { plate: "B", trips: 2, netKg: 20_000, km: 50 },
    ]);
    expect(totals).toEqual({ unitDays: 3, units: 2, trips: 6, netKg: 55_000, tracked: 2, odometer: 1, km: 150.3 });
  });
});

describe("kmOfUnitDistance and trackedIdsByDay", () => {
  it("maps the server's odometer distances by vehicle", () => {
    expect([...kmOfUnitDistance([{ vehicleId: "v1", distanceKm: 71.8, source: "odometer", pending: false }, { distanceKm: 1 }])])
      .toEqual([["v1", { km: 71.8, source: "odometer" }]]);
  });
  it("lists each day's tracked units once", () => {
    const rows = [
      { day: "2026-11-17", vehicleId: "b" }, { day: "2026-11-17", vehicleId: "a" },
      { day: "2026-11-17", vehicleId: null }, { day: "2026-11-18", vehicleId: "a" },
    ];
    expect([...trackedIdsByDay(rows)]).toEqual([["2026-11-17", ["a", "b"]], ["2026-11-18", ["a"]]]);
  });
});

describe("kmOfDay", () => {
  it("maps the Fuel Consumption Rate rows by vehicle", () => {
    expect([...kmOfDay({ rows: [{ vehicleId: "v1", distanceKm: 12.5, distanceSource: "odometer" }, { distanceKm: 3 }] })])
      .toEqual([["v1", { km: 12.5, source: "odometer" }]]);
    expect(kmOfDay({ rows: [{ vehicleId: "v2", distanceKm: 4 }] }).get("v2")).toEqual({ km: 4, source: "gps" });
    expect(kmOfDay(null).size).toBe(0);
  });
});
