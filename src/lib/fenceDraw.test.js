import { describe, it, expect } from "vitest";
import { ringAreaHa, isSiteFence, parentFence, suggestName, selfCrosses, outlineOf, areaText } from "./fenceDraw";

// A 100 m square near Sukari's factory (-0.82340, 34.38449): 0.0009° ≈ 100 m.
const sq = (lat, lng, d) => [
  { lat, lng }, { lat, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng },
];
const poly = (id, name, pts) => ({
  type: "Feature",
  properties: { id, name, fenceType: "POLYGON" },
  geometry: { type: "Polygon", coordinates: [[...pts, pts[0]].map((p) => [p.lng, p.lat])] },
});

describe("ringAreaHa", () => {
  it("measures a square of about 100 m as about one hectare", () => {
    expect(ringAreaHa(sq(-0.8234, 34.3844, 0.0009))).toBeCloseTo(1.0, 1);
  });
  it("is zero for fewer than three corners", () => {
    expect(ringAreaHa(sq(0, 0, 1).slice(0, 2))).toBe(0);
  });
});

describe("isSiteFence", () => {
  it("keeps areas and circles, drops roads and regions", () => {
    expect(isSiteFence(poly("a", "Yard", sq(-0.82, 34.38, 0.001)))).toBe(true);
    expect(isSiteFence({ geometry: { type: "Point", coordinates: [34, 0] }, properties: { radiusM: 200 } })).toBe(true);
    expect(isSiteFence({ geometry: { type: "LineString", coordinates: [[34, 0], [35, 0]] }, properties: {} })).toBe(false);
    // ~0.1° square ≈ 12,000 ha — a region.
    expect(isSiteFence(poly("r", "Region", sq(-0.9, 34.3, 0.1)))).toBe(false);
  });
});

describe("parentFence", () => {
  const premises = poly("p", "Sukari Industries", sq(-0.826, 34.382, 0.006));
  const yard = poly("y", "Sukari Industries · Yard", sq(-0.825, 34.383, 0.002));
  it("names the smallest site holding every corner", () => {
    const inner = sq(-0.8245, 34.3835, 0.0005);
    expect(parentFence(inner, [premises, yard]).properties.id).toBe("y");
    expect(suggestName(parentFence(sq(-0.822, 34.386, 0.0005), [premises, yard]))).toBe("Sukari Industries · ");
  });
  it("is null when a corner falls outside", () => {
    expect(parentFence(sq(-0.821, 34.387, 0.003), [premises])).toBeNull();
    expect(suggestName(null)).toBe("");
  });
  it("never names the fence being edited as its own parent", () => {
    expect(parentFence(sq(-0.8245, 34.3835, 0.0005), [yard], "y")).toBeNull();
  });
});

describe("selfCrosses", () => {
  it("passes a plain square and catches a bow-tie", () => {
    const s = sq(0, 0, 1);
    expect(selfCrosses(s)).toBe(false);
    expect(selfCrosses([s[0], s[2], s[1], s[3]])).toBe(true);
  });
});

describe("outlineOf", () => {
  it("opens a closed ring and turns a circle into a polygon", () => {
    const f = poly("a", "A", sq(0, 0, 1));
    expect(outlineOf(f)).toHaveLength(4);
    const c = outlineOf({ geometry: { type: "Point", coordinates: [34, 0] }, properties: { radiusM: 100 } });
    expect(c).toHaveLength(48);
  });
});

describe("areaText", () => {
  it("speaks in m² under a hectare", () => {
    expect(areaText(0.064)).toBe("640 m²");
    expect(areaText(3.42)).toBe("3.4 ha");
    expect(areaText(1250)).toBe("1,250 ha");
  });
});
