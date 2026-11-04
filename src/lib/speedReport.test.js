import { describe, it, expect } from "vitest";
import { COLUMNS, csvTable, mergeRows, peakUrl, rowCells, rowsOfGroup, sections, speedPdfBody, summary } from "./speedReport";

const row = {
  vehicleId: "v1", name: "WKS - Kabras - KCS 657G", plate: "KCS 657G", group: "Trucks", km: 251.22, maxKmh: 112, limitKmh: 70, overByKmh: 42,
  overKm: 20.7, occurrences: 27, peak: { lat: 0.78374, lng: 34.80347, at: 0 }, source: "wialon",
};
const tractor = { ...row, vehicleId: "v2", name: "WKS - Misikhu - KTCC 453L", group: "Other", km: 102.3, maxKmh: 43, limitKmh: 30, overByKmh: 13, overKm: 24.87, occurrences: 31, peak: null };

describe("the sheet's row", () => {
  it("carries every column in the sheet's order", () => {
    expect(rowCells(row)).toEqual(["WKS - Kabras - KCS 657G", "Trucks", "251.22", "112 km/h", "70 km/h", "+42 km/h", "20.70", "27"]);
    expect(rowCells(row)).toHaveLength(COLUMNS.length);
    expect(csvTable([row]).head).toBe(COLUMNS);
  });
  it("links the peak to the map only when the fix was there", () => {
    expect(peakUrl(row)).toBe("https://www.google.com/maps?q=0.78374,34.80347");
    expect(peakUrl(tractor)).toBe("");
  });
});

it("reads several organisations as one sheet, trucks first", () => {
  const naitiri = { ...row, name: "WKS - Naitiri - KDE 566S" };
  expect(mergeRows([[tractor, naitiri], [row]]).map((r) => r.name)).toEqual(["WKS - Kabras - KCS 657G", "WKS - Naitiri - KDE 566S", "WKS - Misikhu - KTCC 453L"]);
});

it("groups and filters by heading", () => {
  expect(sections([row, tractor]).map((s) => s.group)).toEqual(["Trucks", "Other"]);
  expect(rowsOfGroup([row, tractor], "Other")).toEqual([tractor]);
  expect(rowsOfGroup([row, tractor], "all")).toHaveLength(2);
});

it("adds the day up", () => {
  const s = summary([row, tractor]);
  expect(s).toMatchObject({ units: 2, occurrences: 58, fastest: 112 });
  expect(s.overKm).toBeCloseTo(45.57);
  expect(summary([]).fastest).toBe(0);
});

describe("speedPdfBody", () => {
  it("sends the rows shown, for the server to draw", () => {
    expect(speedPdfBody([row, tractor], { day: "2026-10-30", fleet: "West Kenya", group: "Trucks" }))
      .toEqual({ day: "2026-10-30", fleet: "West Kenya", group: "Trucks", rows: [row, tractor] });
  });
});
