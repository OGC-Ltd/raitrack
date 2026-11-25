import { describe, it, expect } from "vitest";
import { gateRows, searchGate, gateCounts, shiftDay, bySource, gateTrips, durationWords, byHours } from "./gateLog";
import { getGateLogDay, GATE_LOG_MAX_PAGES } from "../api/gateLog";

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
    expect(rows.map((r) => r.label)).toEqual(["Sales returned", "Returned", "Signed out", "Sales signed out"]);
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
    expect(day).toEqual({ events: [pages[0].events[0], pages[0].events[1], pages[1].events[1]], cut: false });
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
