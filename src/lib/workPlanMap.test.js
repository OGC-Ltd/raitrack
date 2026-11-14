import { describe, it, expect } from "vitest";
import { workPlanView, drawingAreas, drawingAreaFor, lineNow, shiftText } from "./workPlanMap";

// A 0.01° square around (-4, 30): Zone 4 for these tests
const zone4 = {
  type: "Feature",
  properties: { id: "z4", name: "ZONE 4" },
  geometry: { type: "Polygon", coordinates: [[[30, -4], [30.01, -4], [30.01, -3.99], [30, -3.99], [30, -4]]] },
};

const line = (over) => ({
  id: "l", taskId: "T", machine: "EX-01", machineName: "Excavator", activity: "GRP Backfilling",
  workLocation: "Zone 4", shiftNo: 1, shiftStart: "06:00:00",
  shiftFrom: "2026-11-14T03:00:00.000Z", shiftTo: "2026-11-14T13:00:00.000Z",
  vehicleId: "v1", plate: "EX 01", fenceId: "z4", ...over,
});

const data = (lines) => ({
  day: "2026-11-14",
  plans: [{ id: "p", planCode: "WP-1", department: "IRRIGATION", status: "SUBMITTED", lines }],
  locations: [{ name: "Zone 4", fenceId: "z4", fenceName: "ZONE 4" }, { name: "Intake 3", fenceId: null, fenceName: null }],
  unplacedMachines: ["T896DSZ"],
});

const NOON_EAT = Date.parse("2026-11-14T09:00:00Z");

describe("workPlanView", () => {
  it("tags each planned machine by where its live unit is now", () => {
    const vehicles = [
      { vehicleId: "v1", id: "EX 01", lat: -3.995, lng: 30.005, online: true },   // inside Zone 4
      { vehicleId: "v2", id: "EX 02", lat: -3.9, lng: 30.2, online: true },       // elsewhere
      { vehicleId: "v3", id: "EX 03", lat: -3.995, lng: 30.005, online: false },  // inside, but offline
    ];
    const v = workPlanView(data([
      line({ id: "a" }),
      line({ id: "b", machine: "EX-02", vehicleId: "v2" }),
      line({ id: "c", machine: "EX-03", vehicleId: "v3" }),
      line({ id: "d", machine: "EX-04", vehicleId: "v4", workLocation: "Intake 3", fenceId: null }),
    ]), vehicles, [zone4], NOON_EAT);
    const tone = Object.fromEntries(v.units.map((u) => [u.machine, u.tone]));
    expect(tone).toEqual({ "EX-01": "here", "EX-02": "away", "EX-03": "silent", "EX-04": "silent" });
    expect(v.counts).toMatchObject({ units: 4, here: 1, away: 1, silent: 2, onShift: 4 });
    expect(v.places).toEqual([expect.objectContaining({ fenceId: "z4", planned: 3, here: 1 })]);
    expect(v.unplacedLocations).toEqual(["Intake 3"]);
    expect(v.noGps).toEqual(["T896DSZ"]);
  });

  it("calls a unit away from its location before its shift off shift, not elsewhere", () => {
    const at3am = Date.parse("2026-11-14T00:00:00Z");
    const v = workPlanView(data([line()]), [{ vehicleId: "v1", lat: -3.9, lng: 30.2, online: true }], [zone4], at3am);
    expect(v.units[0]).toMatchObject({ tone: "offshift", onShift: false });
    expect(v.counts).toMatchObject({ away: 0, offshift: 1 });
  });

  it("says a reporting unit with no geofence for its location cannot be judged", () => {
    const v = workPlanView(data([line({ fenceId: null })]), [{ vehicleId: "v1", lat: -3.995, lng: 30.005, online: true }], [zone4], NOON_EAT);
    expect(v.units[0].tone).toBe("unplaced");
  });

  it("draws a machine with two shifts once, judged by the shift on now", () => {
    const night = line({ id: "n", shiftNo: 2, shiftStart: "18:00:00", shiftFrom: "2026-11-14T15:00:00.000Z", shiftTo: "2026-11-15T01:00:00.000Z", workLocation: "Intake 3", fenceId: null });
    const v = workPlanView(data([line(), night]), [{ vehicleId: "v1", lat: -3.995, lng: 30.005, online: true }], [zone4], Date.parse("2026-11-14T20:00:00Z"));
    expect(v.units).toHaveLength(1);
    expect(v.units[0]).toMatchObject({ onShift: true, tone: "unplaced" });
    expect(v.units[0].line.id).toBe("n");
  });

  it("is null until there is data", () => {
    expect(workPlanView(null, [], [])).toBeNull();
  });
});

// The estate drawing's shapes: c = class, n = name, a = hectares
const sq = (x, y, d = 0.01) => ({ type: "Polygon", coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const drawn = (c, n, a, geometry) => ({ type: "Feature", properties: { c, n, a }, geometry });
const drawing = drawingAreas({ features: [
  drawn("zone", "Commercial area (1600)", 896.1, sq(30.1, -4)),
  drawn("headcontrol", "Commercial area (1600)", 224.2, sq(30.3, -4)),
  drawn("zone", "Zone", 423.9, sq(30.2, -4)),
  drawn("zone", "Zone", 905.4, sq(30.4, -4)),
  drawn("planted", "Irrigation block", 2.9, sq(30.5, -4)),
  drawn("road", "Intake 3", null, { type: "LineString", coordinates: [[30, -4], [30.1, -4]] }),
] });

describe("the estate drawing for locations with no geofence", () => {
  it("keeps only the drawing's area polygons", () => {
    expect(drawing.map((f) => f.properties.c)).toEqual(["zone", "headcontrol", "zone", "zone"]);
  });

  it("finds an area by its name, the zone before a head-control block of that name", () => {
    expect(drawingAreaFor("Commercial Area (1600)", drawing).properties).toMatchObject({ c: "zone", a: 896.1 });
  });

  it("finds an unnamed zone by the size the plan gives it, within 1 ha", () => {
    expect(drawingAreaFor("Zone (424 ha)", drawing).properties.a).toBe(423.9);
    expect(drawingAreaFor("Zone (600 ha)", drawing)).toBeNull();
  });

  it("leaves a size two zones could be unmatched", () => {
    const twins = [...drawing, drawn("zone", "Zone", 424.4, sq(30.6, -4))];
    expect(drawingAreaFor("Zone (424 ha)", twins)).toBeNull();
  });

  it("matches nothing for a name the drawing does not hold", () => {
    expect(drawingAreaFor("Intake 3", drawing)).toBeNull();
    expect(drawingAreaFor("Irrigation room 2B-2", drawing)).toBeNull();
  });

  it("judges machines against the drawn area and draws it as a place", () => {
    const d = data([
      line({ id: "c", machine: "TR-01", vehicleId: "v1", workLocation: "Commercial Area (1600)", fenceId: null }),
      line({ id: "z", machine: "TR-02", vehicleId: "v2", workLocation: "Zone (424 ha)", fenceId: null }),
      line({ id: "i", machine: "TR-03", vehicleId: "v3", workLocation: "Intake 3", fenceId: null }),
    ]);
    d.locations = [
      { name: "Commercial Area (1600)", fenceId: null }, { name: "Zone (424 ha)", fenceId: null }, { name: "Intake 3", fenceId: null },
    ];
    const vehicles = [
      { vehicleId: "v1", lat: -3.995, lng: 30.105, online: true },   // inside Commercial
      { vehicleId: "v2", lat: -3.9, lng: 30.9, online: true },       // away from Zone (424 ha)
      { vehicleId: "v3", lat: -3.995, lng: 30.005, online: true },
    ];
    const v = workPlanView(d, vehicles, [zone4], NOON_EAT, drawing);
    const tone = Object.fromEntries(v.units.map((u) => [u.machine, u.tone]));
    expect(tone).toEqual({ "TR-01": "here", "TR-02": "away", "TR-03": "unplaced" });
    expect(v.places.map((p) => [p.name, p.drawn, p.planned, p.here])).toEqual([
      ["Commercial Area (1600)", true, 1, 1], ["Zone (424 ha)", true, 1, 0],
    ]);
    expect(v.unplacedLocations).toEqual(["Intake 3"]);
  });

  it("prefers the geofence when a location has one", () => {
    const named = drawingAreas({ features: [drawn("zone", "Zone 4", 516.2, sq(30.7, -4))] });
    const v = workPlanView(data([line()]), [{ vehicleId: "v1", lat: -3.995, lng: 30.005, online: true }], [zone4], NOON_EAT, named);
    expect(v.units[0]).toMatchObject({ tone: "here", fenceId: "z4" });
    expect(v.places[0].drawn).toBe(false);
  });
});

describe("lineNow", () => {
  const a = line({ id: "a" });
  const b = line({ id: "b", shiftFrom: "2026-11-14T15:00:00.000Z", shiftTo: "2026-11-15T01:00:00.000Z" });
  it("takes the next shift before any has started, and the last after all have ended", () => {
    expect(lineNow([a, b], Date.parse("2026-11-14T01:00:00Z"))).toMatchObject({ line: a, onShift: false });
    expect(lineNow([a, b], Date.parse("2026-11-14T14:00:00Z"))).toMatchObject({ line: b, onShift: false });
    expect(lineNow([a, b], Date.parse("2026-11-15T05:00:00Z"))).toMatchObject({ line: b, onShift: false });
  });
});

describe("shiftText", () => {
  it("prints the shift in East Africa time", () => {
    expect(shiftText(line())).toBe("06:00–16:00");
  });
});
