import { describe, it, expect } from "vitest";
import { gateRows, searchGate, gateCounts, shiftDay, bySource, gateTrips, durationWords, byHours, fixesOf, fixAt, metresBetween, siteFences, gateSpot, headingAt, premisesOf, findGate, gateFacing, insideFence, planFences, ACK_WORDS, ackNoteOk, nameCase, gateUnits, gateUnitMoves } from "./gateLog";
import { getGateLogDay, GATE_LOG_MAX_PAGES, acknowledgeGateEvent } from "../api/gateLog";
import { vi } from "vitest";
import * as api from "../services/api";

const ev = (id, alertType, ts, plate = "KDA 001A", text = `${plate} did ${alertType}`) => ({ id, alertType, ts, plate, text });

describe("the Gate log rows", () => {
  it("keeps only the gate's four events, newest first", () => {
    const rows = gateRows([
      ev("1", "DISPATCH", "2026-11-25T06:00:00Z"),
      ev("2", "FUEL_DRAIN", "2026-11-25T07:00:00Z"),
      ev("3", "MOVEMENT_EXIT", "2026-11-25T07:30:00Z"),
      ev("4", "MOVEMENT_ENTRY", "2026-11-25T08:00:00Z"),
      ev("5", "SALE_DISPATCH", "2026-11-25T05:00:00Z"),
      ev("6", "SALE_RETURN", "2026-11-25T09:00:00Z"),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["6", "4", "1", "5"]);
    expect(rows.map((r) => r.label)).toEqual(["Sales signed in", "Signed in", "Signed out", "Sales signed out"]);
  });

  it("finds a plate however it is typed, and words in the details", () => {
    const rows = gateRows([ev("1", "DISPATCH", "2026-11-25T06:00:00Z", "KDA 001A", "KDA 001A signed out to Mumias"), ev("2", "DISPATCH", "2026-11-25T06:10:00Z", "KBZ 220T")]);
    expect(searchGate(rows, "kda001a").map((r) => r.key)).toEqual(["1"]);
    expect(searchGate(rows, "mumias").map((r) => r.key)).toEqual(["1"]);
    expect(searchGate(rows, "  ")).toHaveLength(2);
  });

  it("marks each line FactorySuite or Geofence, and filters by it", () => {
    const rows = gateRows([
      { ...ev("1", "DISPATCH", "2026-11-25T06:00:00Z"), source: "controltech" },
      { ...ev("2", "MOVEMENT_ENTRY", "2026-11-25T06:05:00Z"), source: "telemetry" },
      { ...ev("3", "MOVEMENT_ENTRY", "2026-11-25T06:10:00Z"), source: "controltech" },
      { ...ev("4", "SALE_RETURN", "2026-11-25T06:20:00Z"), source: "something-new" },
    ]);
    expect(rows.map((r) => r.source)).toEqual(["other", "factorysuite", "geofence", "factorysuite"]);
    expect(bySource(rows, "geofence").map((r) => r.key)).toEqual(["2"]);
    expect(bySource(rows, "factorysuite").map((r) => r.key)).toEqual(["3", "1"]);
    expect(bySource(rows, "all")).toHaveLength(4);
  });

  it("counts what went out and what came back", () => {
    const rows = gateRows([ev("1", "DISPATCH", "2026-11-25T06:00:00Z"), ev("2", "SALE_DISPATCH", "2026-11-25T06:01:00Z"), ev("3", "MOVEMENT_ENTRY", "2026-11-25T06:02:00Z")]);
    expect(gateCounts(rows)).toEqual({ out: 2, in: 1 });
  });

  it("pairs each sign-out with the unit's returns; only a FactorySuite sign-in closes the trip", () => {
    const fs = (e) => ({ ...e, source: "controltech" });
    const geo = (e) => ({ ...e, source: "telemetry" });
    const rows = gateRows([
      // KDA 001A: signed out twice, seen at the gate, then signed in, then seen again.
      fs(ev("o1", "DISPATCH", "2026-11-25T05:00:00Z", "KDA 001A")),
      fs(ev("o2", "DISPATCH", "2026-11-25T05:05:00Z", "KDA 001A")),
      geo(ev("g1", "MOVEMENT_ENTRY", "2026-11-25T06:05:00Z", "KDA001A")),
      fs(ev("i1", "MOVEMENT_ENTRY", "2026-11-25T07:20:00Z", "KDA 001A")),
      geo(ev("g2", "MOVEMENT_ENTRY", "2026-11-25T07:30:00Z", "KDA 001A")),
      fs(ev("o3", "DISPATCH", "2026-11-25T08:00:00Z", "KDA 001A")),
      // KBV 403X: signed out last night (the day before is read too), seen at the gate twice today.
      fs(ev("y1", "DISPATCH", "2026-11-24T17:04:00Z", "KBV 403X")),
      geo(ev("g3", "MOVEMENT_ENTRY", "2026-11-25T05:42:00Z", "KBV 403X")),
      geo(ev("g4", "MOVEMENT_ENTRY", "2026-11-25T10:07:00Z", "KBV 403X")),
      // No sign-out on record: nothing to pair.
      fs(ev("i8", "MOVEMENT_ENTRY", "2026-11-25T06:10:00Z", "KCC 111C")),
    ]);
    const trips = gateTrips(rows, Date.parse("2026-11-25T09:00:00Z"));
    const at = (iso) => Date.parse(iso);
    // The second sign-out is the trip; the first has none of its own.
    expect(trips.has("o1")).toBe(false);
    // The sign-out's row: its first return, of either kind.
    expect(trips.get("o2")).toEqual({ outAt: at("2026-11-25T05:05:00Z"), inAt: at("2026-11-25T06:05:00Z"), outMs: 60 * 60_000, open: false });
    // Seen at the gate: the trip so far, still open; the sign-in closes it.
    expect(trips.get("g1")).toMatchObject({ outAt: at("2026-11-25T05:05:00Z"), inAt: at("2026-11-25T06:05:00Z") });
    expect(trips.get("i1")).toMatchObject({ outAt: at("2026-11-25T05:05:00Z"), inAt: at("2026-11-25T07:20:00Z"), outMs: 135 * 60_000 });
    // After the sign-in, a sighting pairs with nothing.
    expect(trips.has("g2")).toBe(false);
    // Still out: timed to now.
    expect(trips.get("o3")).toMatchObject({ open: true, inAt: null, outMs: 3_600_000 });
    // Yesterday's sign-out reaches today's sightings, each with its own time out.
    expect(trips.get("g3")).toMatchObject({ outAt: at("2026-11-24T17:04:00Z"), outMs: at("2026-11-25T05:42:00Z") - at("2026-11-24T17:04:00Z") });
    expect(trips.get("g4")).toMatchObject({ outAt: at("2026-11-24T17:04:00Z"), inAt: at("2026-11-25T10:07:00Z") });
    expect(trips.has("i8")).toBe(false);
  });

  it("keeps the lines within hours of the day, Nairobi time, up to the closing hour", () => {
    const rows = gateRows([
      ev("a", "DISPATCH", "2026-11-25T02:59:00Z"), // 05:59
      ev("b", "DISPATCH", "2026-11-25T03:00:00Z"), // 06:00
      ev("c", "DISPATCH", "2026-11-25T10:59:30Z"), // 13:59
      ev("d", "DISPATCH", "2026-11-25T11:00:00Z"), // 14:00
      ev("e", "DISPATCH", "2026-11-25T20:59:00Z"), // 23:59
    ]);
    expect(byHours(rows, 6, 14).map((r) => r.key)).toEqual(["c", "b"]);
    expect(byHours(rows, 14, 6).map((r) => r.key)).toEqual(["c", "b"]);
    expect(byHours(rows, 14, null).map((r) => r.key)).toEqual(["e", "d"]);
    expect(byHours(rows, 23, 24).map((r) => r.key)).toEqual(["e"]);
    expect(byHours(rows, null, 6).map((r) => r.key)).toEqual(["a"]);
    expect(byHours(rows, 6, 6).map((r) => r.key)).toEqual(["b"]);
    expect(byHours(rows, null, null)).toHaveLength(5);
    // "Now" is a fraction of an hour: 14:00 to 14:01 holds the 14:00 line.
    expect(byHours(rows, 14, 14 + 1 / 60).map((r) => r.key)).toEqual(["d"]);
  });

  it("words a time out", () => {
    expect([durationWords(45 * 60_000), durationWords(125 * 60_000), durationWords(27 * 3_600_000), durationWords(NaN)]).toEqual(["45 min", "2 h 05 min", "1 d 3 h", ""]);
  });

  it("moves a day across a month end", () => {
    expect(shiftDay("2026-12-01", -1)).toBe("2026-11-30");
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("reading a whole day", () => {
  it("pages one after another until an empty page, without repeats", async () => {
    const pages = [
      { events: [ev("a", "DISPATCH", "2026-11-25T09:00:00Z"), ev("b", "DISPATCH", "2026-11-25T08:00:00Z")], nextBefore: "2026-11-25T08:00:00Z" },
      { events: [ev("b", "DISPATCH", "2026-11-25T08:00:00Z"), ev("c", "DISPATCH", "2026-11-25T07:00:00Z")], nextBefore: "2026-11-25T07:00:00Z" },
      { events: [], nextBefore: null },
    ];
    const asked = [];
    const heard = [];
    const day = await getGateLogDay({ orgId: "o", day: "2026-11-25", onPage: (ev) => heard.push(ev.map((e) => e.id)), readPage: async (q) => { asked.push(q.before); return pages[asked.length - 1]; } });
    expect(day).toEqual({ events: [pages[0].events[0], pages[0].events[1], pages[1].events[1]], cut: false, gate: null });
    expect(asked).toEqual([null, "2026-11-25T08:00:00Z", "2026-11-25T07:00:00Z"]);
    // The newest lines are heard after the first page, before the rest are read.
    expect(heard[0]).toEqual(["a", "b"]);
    expect(heard[1]).toEqual(["a", "b", "c"]);
  });

  it("stops at the page limit and says the day was cut", async () => {
    let n = 0;
    const day = await getGateLogDay({ orgId: "o", day: "2026-11-25", readPage: async () => { n++; return { events: [ev(String(n), "DISPATCH", `2026-11-25T08:00:${String(60 - n).padStart(2, "0")}Z`)], nextBefore: `t${n}` }; } });
    expect(n).toBe(GATE_LOG_MAX_PAGES);
    expect(day.cut).toBe(true);
  });

  it("gives nothing back once the page has moved on", async () => {
    const day = await getGateLogDay({ orgId: "o", day: "2026-11-25", isLive: () => false, readPage: async () => ({ events: [ev("a", "DISPATCH", "2026-11-25T09:00:00Z")], nextBefore: "x" }) });
    expect(day).toBeNull();
  });
});

describe("the event panel's map (2026-11-26)", () => {
  it("keeps the usable fixes, oldest first, and finds the one nearest the moment", () => {
    const fixes = fixesOf([
      { capturedAt: "2026-11-26T06:35:00Z", lat: -0.81, lng: 34.39, speedKmh: 20 },
      { capturedAt: "2026-11-26T06:31:00Z", lat: -0.82, lng: 34.38 },
      { capturedAt: "2026-11-26T06:33:00Z", lat: 0, lng: 0 },
      { capturedAt: "bad", lat: -0.8, lng: 34.4 },
    ]);
    expect(fixes.map((f) => f.lat)).toEqual([-0.82, -0.81]);
    const at = Date.parse("2026-11-26T06:34:00Z");
    expect(fixAt(fixes, at)).toMatchObject({ lat: -0.81, gapMs: 60_000 });
    expect(fixAt([], at)).toBeNull();
  });
  it("measures metres between two points", () => {
    expect(Math.round(metresBetween({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }))).toBe(111);
  });
  it("carries the vehicle on each row", () => {
    expect(gateRows([{ ...ev("1", "DISPATCH", "2026-11-26T06:00:00Z"), vehicleId: "v1" }])[0].vehicleId).toBe("v1");
  });
});

describe("the event map's premises", () => {
  const poly = (name, category, lat, lng) => ({
    type: "Feature",
    properties: { id: name, name, category },
    geometry: { type: "Polygon", coordinates: [[[lng, lat], [lng + 0.002, lat], [lng + 0.002, lat + 0.002], [lng, lat + 0.002], [lng, lat]]] },
  });
  const fc = { features: [
    poly("Factory", "factory", -0.823, 34.384),
    poly("Perimeter", "perimeter", -0.824, 34.383),
    poly("Gate", "gate", -0.8235, 34.3845),
    poly("No go", "restricted", -0.823, 34.384),
    poly("Far factory", "factory", 0.5, 35.0),
    { type: "Feature", properties: { name: "Road", category: "road" }, geometry: { type: "LineString", coordinates: [[34.38, -0.82], [34.39, -0.83]] } },
  ] };

  it("keeps the site fences near the gate, perimeter first, and finds the gate", () => {
    const fences = siteFences(fc, { lat: -0.8232, lng: 34.3845 });
    expect(fences.map((f) => f.name)).toEqual(["Perimeter", "Factory", "Gate"]);
    expect(fences[0].color).toMatch(/^#/);
    const spot = gateSpot(null, fences);
    expect(spot.lat).toBeCloseTo(-0.8225, 6);
    expect(spot.lng).toBeCloseTo(34.3855, 6);
    expect(gateSpot({ lat: 1, lng: 2, radiusM: 60 }, fences)).toEqual({ lat: 1, lng: 2 });
    expect(gateSpot(null, [])).toBeNull();
  });

  it("faces the unit along its track when the tracker sends no heading", () => {
    const fixes = [{ at: 1, lat: 0, lng: 0 }, { at: 2, lat: 0.001, lng: 0, headingDeg: 0 }];
    expect(Math.round(headingAt(fixes, fixes[1]))).toBe(0);
    const east = [{ at: 1, lat: 0, lng: 0 }, { at: 2, lat: 0, lng: 0.001 }];
    expect(Math.round(headingAt(east, east[1]))).toBe(90);
    expect(headingAt(east, { ...east[1], headingDeg: 200 })).toBe(200);
  });
});

describe("the event map's one fence, its gate and the unit's facing", () => {
  // A 0.002° square (~220 m) with its south-west corner at 0, 0.
  const square = {
    id: "p", name: "Perimeter", kind: "perimeter", mid: { lat: 0.001, lng: 0.001 },
    feature: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002], [0, 0]]] } },
  };
  const factory = { ...square, id: "f", name: "Factory", kind: "factory" };
  const gateFence = { id: "g", name: "Gate", kind: "gate", mid: { lat: 0.0005, lng: 0.002 } };

  it("draws the perimeter, else the factory, never the gate's own fence", () => {
    expect(premisesOf([gateFence, factory, square]).name).toBe("Perimeter");
    expect(premisesOf([gateFence, factory]).name).toBe("Factory");
    expect(premisesOf([gateFence])).toBeNull();
  });

  it("knows inside from outside", () => {
    expect(insideFence(square, { lat: 0.001, lng: 0.001 })).toBe(true);
    expect(insideFence(square, { lat: 0.001, lng: 0.003 })).toBe(false);
  });

  it("always finds a gate: recorded, drawn, crossed, else the nearest edge", () => {
    expect(findGate({ gate: { lat: 5, lng: 6, radiusM: 60 }, fences: [gateFence] }).from).toBe("recorded");
    expect(findGate({ fences: [gateFence, square], premises: square }).from).toBe("fence");
    // Leaving east across x = 0.002 at lat 0.001, between t = 0 and t = 100.
    const fixes = [{ at: 0, lat: 0.001, lng: 0.0015 }, { at: 100, lat: 0.001, lng: 0.0025 }];
    const crossed = findGate({ fences: [square], premises: square, fixes, at: 50, here: fixes[1] });
    expect(crossed.from).toBe("track");
    expect(crossed.lng).toBeCloseTo(0.002, 9);
    expect(crossed.lat).toBeCloseTo(0.001, 9);
    const edge = findGate({ fences: [square], premises: square, fixes: [], at: 0, here: { lat: 0.0003, lng: 0.0025 } });
    expect(edge.from).toBe("edge");
    expect(edge.lng).toBeCloseTo(0.002, 9);
    expect(findGate({ fences: [], premises: null })).toBeNull();
  });

  it("faces out through the gate for a sign-out and in for a return", () => {
    const spot = { lat: 0.001, lng: 0.002 };       // on the east fence
    const outside = { lat: 0.001, lng: 0.003 };    // east of it
    const inside = { lat: 0.001, lng: 0.001 };     // west of it
    expect(Math.round(gateFacing("out", outside, spot, square))).toBe(90);   // away east
    expect(Math.round(gateFacing("out", inside, spot, square))).toBe(90);    // towards the gate
    expect(Math.round(gateFacing("in", outside, spot, square))).toBe(270);   // towards the gate
    expect(Math.round(gateFacing("in", inside, spot, square))).toBe(270);    // on in
    // No position: across the gate from the premises' middle.
    expect(Math.round(gateFacing("out", null, spot, square))).toBe(90);
    expect(Math.round(gateFacing("in", null, spot, square))).toBe(270);
    expect(gateFacing("out", null, null, square)).toBeNull();
  });
});

describe("the works-site survey on the event map", () => {
  // The shape of public/sukari-site.geojson: a boundary, its Main Gate, and
  // points that are not drawn.
  const survey = { features: [
    { type: "Feature", properties: { name: "Sukari", category: "perimeter", kind: "boundary" },
      geometry: { type: "Polygon", coordinates: [[[34.381, -0.823], [34.386, -0.823], [34.386, -0.815], [34.381, -0.815], [34.381, -0.823]]] } },
    { type: "Feature", properties: { name: "Main Gate", category: "gate", kind: "point" }, geometry: { type: "Point", coordinates: [34.3818583, -0.821916] } },
    { type: "Feature", properties: { name: "Fuel Station", category: "fuel", kind: "point" }, geometry: { type: "Point", coordinates: [34.3851864, -0.8229986] } },
  ] };
  const geofence = {
    id: "g", name: "Sukari industries", kind: "perimeter", mid: { lat: -0.82, lng: 34.38 },
    feature: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[34.37, -0.83], [34.39, -0.83], [34.39, -0.81], [34.37, -0.81], [34.37, -0.83]]] } },
  };

  it("reads the boundary and the gate, and nothing else", () => {
    const fences = planFences(survey, "sukari");
    expect(fences.map((f) => [f.name, f.kind, f.plan])).toEqual([["Sukari", "perimeter", "sukari"], ["Main Gate", "gate", "sukari"]]);
    expect(planFences(survey, "sukari", { lat: 1, lng: 36 })).toEqual([]);
  });

  it("draws the survey's boundary over a geofence and puts the gate on its Main Gate", () => {
    const fences = [...planFences(survey, "sukari"), geofence];
    const premises = premisesOf(fences);
    expect(premises.name).toBe("Sukari");
    const gate = findGate({ fences, premises, fixes: [], at: 0, here: null });
    expect(gate).toEqual({ lat: -0.821916, lng: 34.3818583, from: "plan" });
    // The organisation's recorded gate still comes first.
    expect(findGate({ gate: { lat: -0.821842, lng: 34.38186, radiusM: 60 }, fences, premises }).from).toBe("recorded");
  });
});

describe("acknowledging a gate event", () => {
  it("carries the server's acknowledgement on the row: null where none, undefined where none was sent", () => {
    const ack = { outcome: "CONFIRMED", note: null, by: "Achieng", at: "2026-11-26T07:00:00Z" };
    const rows = gateRows([
      { id: "a", ts: "2026-11-26T06:00:00Z", alertType: "DISPATCH", acknowledgement: ack },
      { id: "b", ts: "2026-11-26T05:00:00Z", alertType: "MOVEMENT_ENTRY", acknowledgement: null },
      { id: "c", ts: "2026-11-26T04:00:00Z", alertType: "DISPATCH" },
    ]);
    expect(rows.map((r) => r.ack)).toEqual([ack, null, undefined]);
  });

  it("says it by the way the event went", () => {
    expect(ACK_WORDS.out.CONFIRMED.cell).toBe("Signed out");
    expect(ACK_WORDS.out.DISPUTED.cell).toBe("Did not sign out");
    expect(ACK_WORDS.in.CONFIRMED.cell).toBe("Signed in");
    expect(ACK_WORDS.in.DISPUTED.confirm).toBe("Record that it did not sign in");
  });

  it("wants a reason to dispute, not to confirm", () => {
    expect(ackNoteOk("CONFIRMED", "")).toBe(true);
    expect(ackNoteOk("DISPUTED", "  no ")).toBe(false);
    expect(ackNoteOk("DISPUTED", "Still in the yard")).toBe(true);
  });

  it("posts the decision to the event and answers the acknowledgement", async () => {
    const ack = { outcome: "DISPUTED", note: "Still in the yard", by: "Achieng", at: "2026-11-26T07:00:00Z" };
    const spy = vi.spyOn(api, "apiFetch").mockResolvedValue({ data: { eventId: "dp-1/x", acknowledgement: ack } });
    expect(await acknowledgeGateEvent({ orgId: "org_1", eventId: "dp-1/x", outcome: "DISPUTED", note: "Still in the yard" })).toEqual(ack);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/v1/organisations/org_1/gate-log/dp-1%2Fx/acknowledgement");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ outcome: "DISPUTED", note: "Still in the yard" });
    spy.mockRestore();
  });
});

describe("names in the details", () => {
  it("puts drivers and places in normal case, and leaves the plate", () => {
    expect(nameCase("KTCB 450R · EMMANUEL BARASA signed out to ADEK and left the premises.", "KTCB 450R"))
      .toBe("KTCB 450R · Emmanuel Barasa signed out to Adek and left the premises.");
    expect(nameCase("KCX 796S arrived at the gate from UNGA, having been out for 1.7 h.", "KCX 796S"))
      .toBe("KCX 796S arrived at the gate from Unga, having been out for 1.7 h.");
    expect(nameCase("KDA 001A signed out to AWENDO-MIGORI, O’BRIEN driving", "KDA 001A"))
      .toBe("KDA 001A signed out to Awendo-Migori, O’Brien driving");
    expect(nameCase("Already Normal text, a B2B code", null)).toBe("Already Normal text, a B2B code");
  });
});

describe("gateUnitMoves", () => {
  const at = (h, m = 0) => Date.UTC(2026, 10, 27, h, m);
  const rows = [
    { plate: "KDA 001A", way: "out", at: at(5) }, { plate: "KDA 001A", way: "in", at: at(7) },
    { plate: "KDA 001A", way: "out", at: at(9) }, { plate: "KDA 001A", way: "in", at: at(11) }, { plate: "KDA 001A", way: "in", at: at(11, 5) },
    { plate: "KBZ 220T", way: "out", at: at(6) },
    { plate: "KCC 300C", way: "in", at: at(8) },
    { plate: "KDD 400D", way: "out", at: at(10) }, { plate: "KDD 400D", way: "in", at: at(12) },
  ];
  it("one sign-out per unit and one return per unit back, balancing gateUnits", () => {
    const { outs, backs } = gateUnitMoves(rows);
    const u = gateUnits(rows);
    expect(outs.length).toBe(u.total.units);
    expect(backs.length).toBe(u.total.back);
    expect(outs.length - backs.length).toBe(u.total.out);
    expect(outs.map((r) => r.at).sort()).toEqual([at(6), at(9), at(10)].sort());
    expect(backs.map((r) => r.at).sort()).toEqual([at(11), at(12)].sort());
  });
});
