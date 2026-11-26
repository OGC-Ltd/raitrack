/**
 * Kasulu's hectare blocks and AREA parcels in the planting plan (public/estate-plan.geojson,
 * merged by scripts/kml-to-ha-blocks.py from tools/kasulu-ha-blocks.kml).
 *
 * What these pin: all four blocks are there, each is a closed lon/lat ring on
 * the Kasulu estate, and each measures within 10 % of the figure in its name —
 * a re-export that swapped two outlines, or a projected (metre) file read as
 * degrees, fails here rather than drawing in the wrong place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const plan = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/estate-plan.geojson", import.meta.url)), "utf8"));
const blocks = plan.features.filter((f) => f.properties.c === "hablock");

const R = 6371008.8;
function areaHa(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lo1, la1] = ring[i];
    const [lo2, la2] = ring[i + 1];
    s += (lo2 - lo1) * Math.PI / 180 * (2 + Math.sin(la1 * Math.PI / 180) + Math.sin(la2 * Math.PI / 180));
  }
  return Math.abs(s) * R * R / 2 / 1e4;
}

describe("Kasulu hectare blocks", () => {
  it("has the 700, 1600, 2500 and 2000 Ha areas, once each", () => {
    expect(blocks.map((f) => f.properties.n).sort())
      .toEqual(["1600 Ha Area", "2000 Ha Area", "2500 Ha Area", "700 Ha Area"]);
  });

  it.each(blocks.map((f) => [f.properties.n, f]))("%s is a closed ring on the estate, near its named size", (_, f) => {
    const ring = f.geometry.coordinates[0];
    expect(f.geometry.type).toBe("Polygon");
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lon, lat] of ring) {
      expect(lon).toBeGreaterThan(30.3); expect(lon).toBeLessThan(30.6);
      expect(lat).toBeGreaterThan(-4.15); expect(lat).toBeLessThan(-3.95);
    }
    const ha = areaHa(ring);
    expect(Math.abs(ha - f.properties.a)).toBeLessThan(1);
    expect(Math.abs(ha - f.properties.ha) / f.properties.ha).toBeLessThan(0.1);
  });

  it("has the six AREA parcels, each a closed ring of its own size", () => {
    const farms = plan.features.filter((f) => f.properties.c === "farmarea");
    expect(farms.map((f) => f.properties.n).sort()).toEqual([
      "AREA 1 -210", "AREA 3 - 211", "AREA 4 - 215", "AREA 5 - 214", "AREA 6 - 212", "AREA 7 - 213",
    ]);
    for (const f of farms) {
      const ring = f.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThan(30.1); expect(lon).toBeLessThan(30.6);
        expect(lat).toBeGreaterThan(-4.25); expect(lat).toBeLessThan(-3.8);
      }
      expect(Math.abs(areaHa(ring) - f.properties.a)).toBeLessThan(1);
    }
    // Six different outlines, not one ring picked six times.
    expect(new Set(farms.map((f) => f.properties.a)).size).toBe(6);
  });

  it("leaves the drawing's own features in place", () => {
    expect(plan.features.filter((f) => f.properties.c === "boundary")).toHaveLength(2);
    expect(plan.features.filter((f) => f.properties.c === "planted")).toHaveLength(507);
  });
});
