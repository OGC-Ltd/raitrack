import { describe, it, expect } from "vitest";
import { workPlanView, scopeView, planStage, fitDepartments, byDepartmentThenHere, drawingAreas, drawingAreaFor, lineNow, shiftText } from "./workPlanMap";

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
  plans: [{ id: "p", planCode: "WP-1", department: "IRRIGATION", status: "APPROVED", lines }],
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

describe("scopeView: one department", () => {
  const twoDepts = () => {
    const d = data([
      line({ id: "a" }),
      line({ id: "b", machine: "EX-02", vehicleId: "v2", workLocation: "Intake 3", fenceId: null }),
    ]);
    d.plans.push({ id: "q", planCode: "WP-2", department: "ROADS", status: "DRAFT", lines: [
      line({ id: "r", machine: "GR-01", vehicleId: "v5", department: undefined }),
      line({ id: "s", machine: "T896DSZ", vehicleId: null, fenceId: "z4" }),
    ] });
    d.unplacedMachines = ["T896DSZ"];
    const vehicles = [
      { vehicleId: "v1", lat: -3.995, lng: 30.005, online: true },
      { vehicleId: "v2", lat: -3.9, lng: 30.2, online: true },
      { vehicleId: "v5", lat: -3.9, lng: 30.2, online: true },
    ];
    return workPlanView(d, vehicles, [zone4], NOON_EAT);
  };

  it("lists each department with its plan lines and machines", () => {
    expect(twoDepts().departments).toEqual([
      { name: "IRRIGATION", lines: 2, pending: 0, units: 2 },
      { name: "ROADS", lines: 2, pending: 2, units: 2 },
    ]);
  });

  it("counts plan lines as FactorySuite does: a machine on the day and the night shift is two (19 Nov: 96 lines, 80 machines)", () => {
    const d = data([
      line({ id: "a", shiftNo: 1 }),
      line({ id: "b", shiftNo: 2, shiftStart: "18:00:00" }),
      line({ id: "c", machine: "EX-02", vehicleId: "v2" }),
    ]);
    const v = workPlanView(d, [], [zone4], NOON_EAT);
    expect(v.counts).toMatchObject({ units: 2, lines: 3, pendingLines: 0 });
    expect(v.departments).toEqual([{ name: "IRRIGATION", lines: 3, pending: 0, units: 2 }]);
    expect(scopeView(v, "IRRIGATION").counts).toMatchObject({ units: 2, lines: 3 });
  });

  it("counts machines on approved plans and those at their assigned place (operator 2026-11-19), apart from plan lines", () => {
    const d = data([
      line({ id: "a", shiftNo: 1 }),                                                  // EX-01 day, Zone 4
      line({ id: "b", shiftNo: 2, shiftStart: "18:00:00" }),                           // EX-01 night: one machine, two lines
      line({ id: "c", machine: "EX-02", vehicleId: "v2" }),                             // EX-02, elsewhere
    ]);
    d.plans.push({ id: "q", planCode: "WP-2", department: "ROADS", status: "DRAFT", lines: [line({ id: "r", machine: "GR-01", vehicleId: "v5" })] });
    const inside = { lat: -3.995, lng: 30.005, online: true };
    const v = workPlanView(d, [{ vehicleId: "v1", ...inside }, { vehicleId: "v2", lat: -3.9, lng: 30.2, online: true }, { vehicleId: "v5", ...inside }], [zone4], NOON_EAT);
    // GR-01 stands inside Zone 4 but its plan is pending: not approved, not counted at its place
    expect(v.counts).toMatchObject({ lines: 4, units: 3, approvedUnits: 2, here: 1, pending: 1 });
    expect(scopeView(v, "IRRIGATION").counts).toMatchObject({ approvedUnits: 2, here: 1 });
    expect(scopeView(v, "ROADS").counts).toMatchObject({ approvedUnits: 0, here: 0 });
  });

  it("a machine with lines in two departments is in both", () => {
    const d = data([line({ id: "a" })]);
    d.plans.push({ id: "q", planCode: "WP-2", department: "ROADS", status: "APPROVED", lines: [line({ id: "r", shiftNo: 2, shiftStart: "18:00:00" })] });
    const v = workPlanView(d, [], [zone4], NOON_EAT);
    expect(scopeView(v, "ROADS").units.map((u) => u.machine)).toEqual(["EX-01"]);
    expect(scopeView(v, "IRRIGATION").units.map((u) => u.machine)).toEqual(["EX-01"]);
  });

  it("keeps only the department's machines, plans and locations, recounted", () => {
    const v = scopeView(twoDepts(), "ROADS");
    expect(v.units.map((u) => u.machine)).toEqual(["GR-01", "T896DSZ"]);
    expect(v.counts).toMatchObject({ plans: 1, units: 2, here: 0, away: 0, pending: 2, silent: 0 });
    expect(v.statuses).toEqual({ PENDING: 1 });
    expect(v.places).toEqual([expect.objectContaining({ fenceId: "z4", planned: 2, here: 0 })]);
    expect(v.unplacedLocations).toEqual([]);
    expect(v.noGps).toEqual(["T896DSZ"]);
  });

  it("keeps a location without a shape when the department plans it", () => {
    const v = scopeView(twoDepts(), "IRRIGATION");
    expect(v.unplacedLocations).toEqual(["Intake 3"]);
    expect(v.places).toEqual([expect.objectContaining({ planned: 1, here: 1 })]);
    expect(v.noGps).toEqual([]);
  });

  it("is the whole view with no department, or one the day does not plan", () => {
    const all = twoDepts();
    expect(scopeView(all, null)).toBe(all);
    expect(scopeView(all, "WORKSHOP")).toBe(all);
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

describe("planStage: one word for waiting on approval", () => {
  it("folds drafts and submitted plans into PENDING", () => {
    expect(planStage("DRAFT")).toBe("PENDING");
    expect(planStage("SUBMITTED")).toBe("PENDING");
    expect(planStage("submitted")).toBe("PENDING");
    expect(planStage(null)).toBe("PENDING");
  });
  it("keeps every other status", () => {
    expect(planStage("APPROVED")).toBe("APPROVED");
    expect(planStage("REJECTED")).toBe("REJECTED");
  });
  it("counts a draft and a submitted plan together", () => {
    const d = data([line({ id: "a" })]);
    d.plans[0].status = "SUBMITTED";
    d.plans.push({ id: "q", planCode: "WP-2", department: "IRRIGATION", status: "DRAFT", lines: [line({ id: "b", machine: "EX-02" })] });
    d.plans.push({ id: "r", planCode: "WP-3", department: "ROADS", status: "APPROVED", lines: [line({ id: "c", machine: "GR-01" })] });
    expect(workPlanView(d, [], [zone4], NOON_EAT).statuses).toEqual({ PENDING: 2, APPROVED: 1 });
  });
});

describe("machine order inside a department", () => {
  const u = (department, machine, tone) => ({ machine, tone, line: { department } });
  it("puts machines at their location first, each part A to Z", () => {
    const list = [
      u("ROADS", "GR-02", "here"), u("IRRIGATION", "EX-10", "away"), u("IRRIGATION", "EX-2", "silent"),
      u("IRRIGATION", "EX-9", "here"), u("IRRIGATION", "EX-03", "here"), u("ROADS", "GR-01", "away"),
    ].sort(byDepartmentThenHere);
    expect(list.map((x) => `${x.line.department} ${x.machine}`)).toEqual([
      "IRRIGATION EX-03", "IRRIGATION EX-9", "IRRIGATION EX-2", "IRRIGATION EX-10",
      "ROADS GR-02", "ROADS GR-01",
    ]);
  });
});

describe("pending: a machine whose plan is not approved yet", () => {
  const far = { vehicleId: "v1", lat: -3.9, lng: 30.2, online: true };
  const near = { vehicleId: "v1", lat: -3.995, lng: 30.005, online: true };
  const with_ = (status, vehicle) => {
    const d = data([line({ id: "a" })]);
    d.plans[0].status = status;
    return workPlanView(d, [vehicle], [zone4], NOON_EAT);
  };
  it("takes a pending machine out of Elsewhere", () => {
    const v = with_("DRAFT", far);
    expect(v.units[0].tone).toBe("pending");
    expect(v.counts).toMatchObject({ away: 0, pending: 1 });
  });
  it("leaves an approved machine Elsewhere", () => {
    expect(with_("APPROVED", far).units[0].tone).toBe("away");
  });
  it("counts a pending machine at its location as pending too", () => {
    const v = with_("SUBMITTED", near);
    expect(v.units[0].tone).toBe("pending");
    expect(v.counts).toMatchObject({ here: 0, pending: 1 });
  });
  it("counts a pending machine that is not reporting as pending", () => {
    expect(with_("DRAFT", { ...far, online: false }).units[0].tone).toBe("pending");
  });
});

describe("fitDepartments: tabs that fit, the rest under More", () => {
  const base = { all: 40, more: 50, gap: 20 };
  it("shows every tab when they all fit", () => {
    expect(fitDepartments({ ...base, depts: [80, 80, 80], avail: 340 })).toEqual([0, 1, 2]);
  });
  it("keeps the first tabs that fit beside More", () => {
    // 40 + 20 + 50 = 110 spent; 100 each leaves room for two in 340
    expect(fitDepartments({ ...base, depts: [80, 80, 80, 80, 80, 80], avail: 340 })).toEqual([0, 1]);
  });
  it("always shows the picked department", () => {
    expect(fitDepartments({ ...base, depts: [80, 80, 80, 80, 80, 80], avail: 340, current: 4 })).toEqual([0, 4]);
  });
  it("shows only the picked one when space is tight", () => {
    expect(fitDepartments({ ...base, depts: [80, 80, 80, 80], avail: 220, current: 3 })).toEqual([3]);
  });
});
