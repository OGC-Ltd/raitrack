import { describe, it, expect } from "vitest";
import { durationWords, mergeRows, rowCells, rowsOfGroup, sections, summary, tatPdfBody, yesterday, COLUMNS } from "./tatFuelReport";

const at = (s) => Date.parse(`${s}+03:00`);
const fuel = { initial: 209.7, topUps: 40.91, total: 250.61, consumption: 33.48, theft: 0, final: 217.12 };
const trip = {
  vehicleId: "v1", plate: "KDL 208X", group: "Trucks", dispatchedAt: at("2026-11-02T22:04"), leftAt: at("2026-11-02T22:51"),
  returnedAt: at("2026-11-03T20:03"), station: "OPAPO", driver: "A", fuel, km: 77, rate: 2.3, tankL: 600, comment: "PROBE OK", base: "Sukari",
};
const idle = { ...trip, vehicleId: "v2", plate: "KTCC 1", group: "Tractors", dispatchedAt: null, leftAt: null, returnedAt: null, station: null, fuel: null, km: null, rate: null, tankL: null, comment: "NOT UPDATING" };

describe("the sheet's row", () => {
  it("carries every column in the sheet's order", () => {
    expect(rowCells(trip)).toEqual([
      "KDL 208X", "2 Nov 22:51 to 3 Nov 20:03 (21 h 12 min)", "209.70", "40.91", "250.61", "33.48", "0.00", "217.12",
      "OPAPO", "77", "2.30", "600", "PROBE OK", "Sukari",
    ]);
    expect(rowCells(trip)).toHaveLength(COLUMNS.length);
  });

  it("leaves what is not known as a dash, not a zero", () => {
    expect(rowCells(idle).slice(2, 8)).toEqual(["-", "-", "-", "-", "-", "-"]);
    expect(rowCells(idle)[1]).toBe("");
    expect(rowCells(idle)[12]).toBe("NOT UPDATING");
  });

  it("says when a trip still out was dispatched", () => {
    expect(durationWords({ ...idle, dispatchedAt: at("2026-11-03T09:34") })).toBe("Dispatched 3 Nov 09:34");
  });
});

describe("summary", () => {
  it("takes its rate only from probes that read true", () => {
    const bad = { ...trip, vehicleId: "v3", km: 500, fuel: { ...fuel, consumption: 1 }, rate: null, comment: "PROBE ISSUE" };
    const s = summary([trip, bad, idle]);
    expect(s.trips).toBe(2);
    expect(s.measured).toBe(1);
    expect(s.km).toBe(77);
    expect(s.rate).toBeCloseTo(77 / 33.48);
    expect(s.notUpdating).toBe(1);
  });

  it("has no rate with nothing measured", () => {
    expect(summary([idle]).rate).toBeNull();
  });
});

it("groups and filters by the kind of unit", () => {
  expect(sections([trip, idle]).map((x) => x.group)).toEqual(["Trucks", "Tractors"]);
  expect(rowsOfGroup([trip, idle], "Trucks")).toEqual([trip]);
  expect(rowsOfGroup([trip, idle], "all")).toHaveLength(2);
});

it("reads several organisations as one sheet, a unit's rows together", () => {
  const later = { ...trip, leftAt: trip.leftAt + 1000 };
  const nzoia = { ...trip, plate: "KDJ 810Z", group: "Nzoia" };
  const kabras = { ...trip, plate: "KDE 321Q", group: "Kabras" };
  expect(mergeRows([[later, kabras], [nzoia, trip]]).map((r) => r.plate)).toEqual(["KDL 208X", "KDL 208X", "KDJ 810Z", "KDE 321Q"]);
  expect(mergeRows([[later], [trip]])[0]).toBe(trip);
});

it("reads yesterday in Nairobi", () => {
  expect(yesterday(at("2026-11-04T01:00"))).toBe("2026-11-03");
});

describe("tatPdfBody", () => {
  it("sends the rows shown, for the server to draw", () => {
    expect(tatPdfBody([trip, idle], { day: "2026-11-03", fleet: "Sukari Industries", group: "Trucks" }))
      .toEqual({ day: "2026-11-03", fleet: "Sukari Industries", group: "Trucks", rows: [trip, idle] });
    expect(COLUMNS).toHaveLength(14);
  });
});
