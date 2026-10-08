import { describe, it, expect } from "vitest";
import { buildWeb, arc, bearing, edgeWidth } from "./movementWeb";

const trip = (fromPlace, toPlace, km, min, start = 0) => ({ fromPlace, toPlace, km, min, start });

describe("buildWeb", () => {
  it("counts each direction on its own, busiest first, and sets round trips aside", () => {
    const { edges, loops } = buildWeb([
      trip(1, 2, 30, 40, 1), trip(1, 2, 32, 44, 5), trip(2, 1, 31, 42, 3), trip(1, 1, 5, 10),
    ]);
    expect(edges.map((e) => e.key)).toEqual(["1>2", "2>1"]);
    expect(edges[0]).toMatchObject({ trips: 2, km: 62, avgMin: 42, avgKm: 31, first: 1, last: 5 });
    expect(loops.get(1)).toBe(1);
  });
  it("is empty without trips", () => {
    expect(buildWeb(undefined).edges).toEqual([]);
  });
});

describe("arc", () => {
  const a = { lat: 0, lng: 34 }, b = { lat: 0, lng: 35 };
  it("runs from a to b and bows left of the way it goes", () => {
    const p = arc(a, b);
    expect(p[0]).toEqual(a);
    expect(p[p.length - 1].lng).toBeCloseTo(35, 9);
    // Heading east, left is north.
    expect(p[12].lat).toBeGreaterThan(0);
    // The way back bows south: the two directions never overlap.
    expect(arc(b, a)[12].lat).toBeLessThan(0);
  });
  it("reads compass bearings", () => {
    expect(bearing(a, b)).toBeCloseTo(90, 6);
    expect(bearing({ lat: 0, lng: 34 }, { lat: 1, lng: 34 })).toBeCloseTo(0, 6);
  });
  it("widens with trips, and never vanishes", () => {
    expect(edgeWidth(1, 20)).toBeGreaterThan(2);
    expect(edgeWidth(20, 20)).toBe(9);
  });
});
