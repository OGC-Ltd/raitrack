import { describe, it, expect } from "vitest";
import { daysFrom, durationWords, mergeRows, periodWords, rowCells, rowsOverDays, rowsOfGroup, sections, summary, tatPdfBody, yesterday, COLUMNS } from "./tatFuelReport";

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
      "KDL 208X", "2 Nov 22:51 to 3 Nov 20:03 (21 h 12 min)", "209.7", "40.9", "250.6", "33.5", "0.0", "217.1",
      "Opapo", "77.00", "2.30", "600", "PROBE OK", "Sukari",
    ]);
    expect(rowCells(trip)).toHaveLength(COLUMNS.length);
  });

  it("reads a figure that is not known as 0.00 (operator, 7 Nov 2026)", () => {
    expect(rowCells(idle).slice(2, 8)).toEqual(["0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]);
    expect(rowCells(idle).slice(9, 12)).toEqual(["0.00", "0.00", "0.00"]);
    expect(rowCells(idle)[8]).toBe("-");
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

describe("mergeRows with prime movers", () => {
  it("puts them first", () => {
    const r = (group, plate) => ({ group, plate, leftAt: 1 });
    expect(mergeRows([[r("Trucks", "A")], [r("Prime Movers", "B"), r("Tractors", "C")]]).map((x) => x.group)).toEqual(["Prime Movers", "Trucks", "Tractors"]);
  });
});

describe("the operator's sheet, 7 Nov 2026", () => {
  it("writes station names with the first letter of each word in capitals", () => {
    expect(rowCells({ ...trip, station: "SELIA" })[8]).toBe("Selia");
    expect(rowCells({ ...trip, station: "kitale town (amuka)" })[8]).toBe("Kitale Town (Amuka)");
    expect(rowCells(trip)[8]).toBe("Opapo");
  });

  it("puts the rows without a trip at the bottom of each section", () => {
    const quiet = { ...idle, group: trip.group, plate: "AAA 1" };
    const other = { ...trip, plate: "ZZZ 9" };
    expect(mergeRows([[quiet, trip], [other]]).map((r) => r.plate)).toEqual([trip.plate, "ZZZ 9", "AAA 1"]);
  });
});

describe("several days", () => {
  const trip = (vehicleId, returnedAt) => ({ vehicleId, returnedAt, comment: "PROBE OK" });
  const idle = (vehicleId, comment) => ({ vehicleId, returnedAt: null, comment });

  it("keeps every trip, and drops a unit's idle days once it has a trip", () => {
    const out = rowsOverDays([[trip("a", 1), idle("b", "NO TRIP")], [idle("a", "NO TRIP"), trip("b", 2), trip("a", 3)]]);
    expect(out).toEqual([trip("a", 1), trip("b", 2), trip("a", 3)]);
  });
  it("lists a unit with no trip once, for the reason its last day gives", () => {
    expect(rowsOverDays([[idle("a", "NO TRIP")], [idle("a", "NOT UPDATING")]])).toEqual([idle("a", "NOT UPDATING")]);
  });
  it("leaves a single day's rows alone", () => {
    const day = [trip("a", 1), trip("a", 2), idle("b", "NO TRIP")];
    expect(rowsOverDays([day])).toEqual(day);
  });
  it("counts the days, both ends included, across a month", () => {
    expect(daysFrom("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysFrom("2026-11-03", "2026-11-03")).toEqual(["2026-11-03"]);
  });
  it("says the period as briefly as it can", () => {
    expect(periodWords("2026-11-03")).toBe("3 November 2026");
    expect(periodWords("2026-11-01", "2026-11-03")).toBe("1 to 3 November 2026");
    expect(periodWords("2026-10-28", "2026-11-03")).toBe("28 October to 3 November 2026");
    expect(periodWords("2026-12-30", "2027-01-02")).toBe("30 December 2026 to 2 January 2027");
  });
  it("sends the last day to the PDF only when there are several", () => {
    expect(tatPdfBody([], { day: "2026-11-03", fleet: "F" })).toEqual({ day: "2026-11-03", fleet: "F", group: "all", rows: [] });
    expect(tatPdfBody([], { day: "2026-11-01", to: "2026-11-03", fleet: "F" }).to).toBe("2026-11-03");
  });
});
