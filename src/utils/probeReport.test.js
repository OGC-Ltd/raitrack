// The CSV export.
//
// jspdf is mocked away: this file's PDF half is layout handed to the shared
// builder, and pulling a PDF engine into a test of comma placement buys
// nothing. The CSV half is where the logic — and the one security property —
// lives.

import { describe, it, expect, vi } from "vitest";

vi.mock("./pdfReport", () => ({
  createReport: vi.fn(), addSectionTitle: vi.fn(), addSummaryCards: vi.fn(),
  addTable: vi.fn(), downloadReport: vi.fn(),
}));

const { buildProbeCsv, summarise } = await import("./probeReport");

const row = (over = {}) => ({
  plate: "KTCC 202G",
  deviceId: "wialon:29708814",
  orgCode: "SUKARI",
  fuelProbe: {
    state: "SILENT", lastAliveAt: null, lastValueMl: null,
    lastSeenAt: "2026-08-19T21:53:00.000Z", pings: 23740,
  },
  fuelSensor: {
    fitted: true, name: "Fuel level", parameter: "io_270",
    calibrationPoints: 32, calibratedMax: 4094, uncalibrated: false,
  },
  channels: {
    gps:         { state: "REPORTING", lastValue: null },
    ignition:    { state: "REPORTING", lastValue: null },
    odometer:    { state: "REPORTING", lastValue: 144077 },
    engineHours: { state: "REPORTING", lastValue: 1916 },
  },
  ...over,
});

/** Excel expects CRLF from a .csv on every platform. */
const CRLF = String.fromCharCode(13, 10);
const parse = (csv) => csv.split("\r\n").map(l => l.split(","));

describe("an export contains the filtered set and nothing else", () => {
  // The defect this pins: the CSV and the PDF table always carried the filtered
  // rows, but the PDF's summary cards were fed the endpoint's FLEET-WIDE
  // tallies. A report filtered to sixteen uncalibrated sensors printed
  // "Units 284 · Needs attention 111" above a sixteen-row table, and the number
  // a reader quotes is the one in the big type at the top.

  it("summarises only the rows it was given", () => {
    const filtered = [
      row({ fuelSensor: { ...row().fuelSensor, calibrationPoints: 0, uncalibrated: true } }),
      row({ fuelSensor: { ...row().fuelSensor, calibrationPoints: 0, uncalibrated: true } }),
    ];
    const s = summarise(filtered);
    expect(s.total).toBe(2);                 // not the fleet's 284
    expect(s.sensorUncalibrated).toBe(2);
    expect(s.probeOk).toBe(0);
  });

  it("counts a silent tracker apart from a working probe", () => {
    // A silent unit's probe state is UNKNOWN, never OK, so it must not land in
    // the Working card — that would report a device that has said nothing for
    // months as healthy.
    // NB: row() in this file defaults to SILENT, so the healthy one is explicit.
    const s = summarise([
      { ...row(), trackerSilent: true, fuelProbe: { state: "UNKNOWN" } },
      { ...row(), fuelProbe: { state: "OK" } },
    ]);
    expect(s.trackerSilent).toBe(1);
    expect(s.probeOk).toBe(1);
  });

  it("writes one CSV line per filtered row, plus the header", () => {
    const csv = buildProbeCsv([row(), row(), row()]);
    expect(csv.split(CRLF)).toHaveLength(4);
  });

  it("exports nothing but the header when the filter matches nothing", () => {
    // An empty filtered set must produce an empty document, not the fleet.
    expect(buildProbeCsv([]).split(CRLF)).toHaveLength(1);
    expect(summarise([]).total).toBe(0);
  });
});

describe("buildProbeCsv", () => {
  it("carries the facts the report was asked for", () => {
    const [head, first] = parse(buildProbeCsv([row()]));
    const at = (label) => first[head.indexOf(label)];

    expect(at("Plate")).toBe("KTCC 202G");
    // "which unit was it installed on"
    expect(at("Unit")).toBe("wialon:29708814");
    expect(at("Fuel probe")).toBe("Always reads 0 L");
    expect(at("Calibration points")).toBe("32");
    expect(at("Odometer (km)")).toBe("144077");
    expect(at("Readings (30 d)")).toBe("23740");
  });

  it("leaves a never-alive probe blank rather than printing a zero", () => {
    // "" and "0.0" mean different things: one is "it never read", the other is
    // "it read empty". The state column already says which.
    const [head, first] = parse(buildProbeCsv([row()]));
    expect(first[head.indexOf("Probe last worked")]).toBe("");
    expect(first[head.indexOf("Last reading (L)")]).toBe("");
  });

  it("neutralises values Excel would run as a formula", () => {
    // Sensor names come from the provider. Excel and Sheets execute a cell
    // starting = + - or @, so the export must make them text — otherwise a
    // downloaded fault list is an attack on whoever opens it.
    const csv = buildProbeCsv([row({
      fuelSensor: { ...row().fuelSensor, name: "=HYPERLINK(\"http://evil\",\"x\")" },
    })]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("quotes and escapes a field containing a comma or a quote", () => {
    const csv = buildProbeCsv([row({
      fuelSensor: { ...row().fuelSensor, name: 'Main tank, 22" probe' },
    })]);
    expect(csv).toContain('"Main tank, 22"" probe"');
  });

  it("writes CRLF, which is what Excel expects from a .csv", () => {
    expect(buildProbeCsv([row()])).toContain("\r\n");
  });

  it("emits a header even with no rows, so an empty export is still readable", () => {
    const csv = buildProbeCsv([]);
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).toContain("Plate");
    expect(csv).toContain("Fuel sensor");
  });

  it("names an uncalibrated sensor as the configuration fault it is", () => {
    const [head, first] = parse(buildProbeCsv([row({
      fuelSensor: { ...row().fuelSensor, calibrationPoints: 0, uncalibrated: true },
    })]));
    expect(first[head.indexOf("Fuel sensor")]).toBe("Uncalibrated");
    expect(first[head.indexOf("Action")]).toBe("Add calibration table in Wialon");
  });
});
