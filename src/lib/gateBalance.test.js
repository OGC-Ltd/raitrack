import { describe, it, expect } from "vitest";
import { gateBalance } from "./gateLog";

// Rows as gateRows makes them. Times in EAT on 27 Nov 2026 unless the day says otherwise.
const at = (hhmm, day = "2026-11-27") => Date.parse(`${day}T${hhmm}:00+03:00`);
let n = 0;
const out = (plate, hhmm, day) => ({ key: `o${++n}`, plate, way: "out", source: "factorysuite", at: at(hhmm, day) });
const seen = (plate, hhmm, day) => ({ key: `g${++n}`, plate, way: "in", source: "geofence", at: at(hhmm, day) });
const signedIn = (plate, hhmm, day) => ({ key: `s${++n}`, plate, way: "in", source: "factorysuite", at: at(hhmm, day) });

describe("the Gate log figures balance (operator, 2026-11-27)", () => {
  it("KTCC 769G: out yesterday, seen at the gate twice, signed out again, seen again", () => {
    const prev = [out("KTCC 769G", "19:15", "2026-11-26")];
    const today = [seen("KTCC 769G", "00:13"), seen("KTCC 769G", "03:45"), out("KTCC 769G", "04:07"), seen("KTCC 769G", "04:28")];
    const b = gateBalance(today, [...prev, ...today]);
    expect(b).toMatchObject({ signedOut: 1, back: 1, stillOut: 0, noReturn: 0, cameBack: 2, earlier: 1, extra: 1 });
    expect(b.records).toEqual({ out: 1, in: 3 });
  });

  it("a unit signed out twice with no return between: the first is 'no return recorded'", () => {
    const rows = [out("KTCC 1", "06:00"), out("KTCC 1", "09:00"), signedIn("KTCC 1", "12:00")];
    expect(gateBalance(rows, rows)).toMatchObject({ signedOut: 2, back: 1, noReturn: 1, stillOut: 0, cameBack: 1, extra: 0 });
  });

  it("every identity holds on a mixed day", () => {
    const prev = [out("A", "22:00", "2026-11-26"), out("B", "23:00", "2026-11-26")];
    const today = [
      seen("A", "01:00"), signedIn("A", "01:05"),           // back from yesterday, then its sign-in: a repeat
      out("C", "07:00"), seen("C", "07:40"),                // out and back within 2 h
      out("D", "08:00"), seen("D", "13:00"),                // 5 h
      out("E", "09:00"), out("E", "10:00"),                 // signed out again, no return
      out("F", "14:00"),                                    // still out
      signedIn("G", "11:00"),                               // a return with no sign-out on record
    ];
    const b = gateBalance(today, [...prev, ...today]);
    expect(b.signedOut).toBe(b.back + b.stillOut + b.noReturn);
    expect(b.cameBack).toBe(b.back + b.earlier);
    expect(b.within2h + b.from2to8h + b.over8h).toBe(b.cameBack);
    expect(b.records.in).toBe(b.cameBack + b.extra);
    expect(b).toMatchObject({ signedOut: 5, back: 2, noReturn: 1, stillOut: 2, cameBack: 3, earlier: 1, extra: 2, units: 6 });
  });

  it("within an hours window, a return after it leaves the trip still out", () => {
    const all = [out("H", "06:00"), seen("H", "15:00")];
    const window = all.filter((r) => r.at < at("14:00"));
    expect(gateBalance(window, all)).toMatchObject({ signedOut: 1, back: 0, stillOut: 1, cameBack: 0 });
  });

  it("first returns are split by where they came from", () => {
    const rows = [out("J", "06:00"), seen("J", "07:00"), out("K", "06:00"), signedIn("K", "07:00")];
    expect(gateBalance(rows, rows).backBySource).toEqual({ factorysuite: 1, geofence: 1, other: 0 });
  });

  it("units signed out twice, and units back twice (repeat sightings of one return do not count)", () => {
    const rows = [
      out("L", "06:00"), seen("L", "07:00"), seen("L", "07:20"), out("L", "08:00"), signedIn("L", "09:00"), // out twice, back twice
      out("M", "06:00"), out("M", "10:00"),                                                                 // out twice, never back
      out("N", "06:00"), seen("N", "06:30"), seen("N", "11:00"),                                            // one trip, seen twice
    ];
    expect(gateBalance(rows, rows)).toMatchObject({ outTwice: 2, inTwice: 1 });
  });
});
