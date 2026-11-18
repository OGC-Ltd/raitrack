import { describe, it, expect } from "vitest";
import { hidesInactiveFences, mapFences } from "./fenceVisibility";

const fc = (...states) => ({
  type: "FeatureCollection",
  features: states.map((isActive, i) => ({ type: "Feature", properties: { id: `f${i}`, isActive } })),
});

describe("mapFences", () => {
  it("hides inactive fences for Menengai", () => {
    const out = mapFences(fc(true, false, false, true), "MENENGAI");
    expect(out.features.map((f) => f.properties.id)).toEqual(["f0", "f3"]);
  });

  it("keeps a fence with no isActive (treated as active)", () => {
    expect(mapFences(fc(undefined, false), "menengai").features).toHaveLength(1);
  });

  it("leaves other organisations untouched, same object", () => {
    const input = fc(true, false);
    expect(mapFences(input, "KASULU")).toBe(input);
    expect(mapFences(input, null)).toBe(input);
  });

  it("returns the same object when nothing is hidden", () => {
    const input = fc(true, true);
    expect(mapFences(input, "MENENGAI")).toBe(input);
  });

  it("passes through an empty or missing collection", () => {
    expect(mapFences(null, "MENENGAI")).toBe(null);
    expect(hidesInactiveFences("Menengai")).toBe(true);
  });
});
