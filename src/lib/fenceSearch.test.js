import { describe, it, expect } from "vitest";
import { matchFences, fenceDetail } from "./fenceSearch";

const fence = (name, geometry = { type: "Polygon" }, props = {}) => ({ geometry, properties: { name, ...props } });
const names = (r) => r.hits.map((f) => f.properties.name);

describe("matchFences", () => {
  const all = [
    fence("MENENGAI_VS:SUKARI MINI MARKET"),
    fence("Sukari industries"),
    fence("SUKARI"),
    fence("MENENGAI_FG:  NAIVAS"),
    fence("Pasukari yard"),
  ];

  it("ranks the whole name, its start, a word in it, then anywhere", () => {
    expect(names(matchFences(all, "sukari"))).toEqual([
      "SUKARI", "Sukari industries", "MENENGAI_VS:SUKARI MINI MARKET", "Pasukari yard",
    ]);
  });

  it("takes the words of a search in any order, whatever the spacing", () => {
    expect(names(matchFences(all, "market  sukari"))).toEqual(["MENENGAI_VS:SUKARI MINI MARKET"]);
    expect(names(matchFences(all, "fg: naivas"))).toEqual(["MENENGAI_FG:  NAIVAS"]);
  });

  it("caps the list and still says how many matched", () => {
    const many = Array.from({ length: 50 }, (_, i) => fence(`Shop ${i}`));
    const r = matchFences(many, "shop", 30);
    expect(r.hits).toHaveLength(30);
    expect(r.total).toBe(50);
    expect(names(r).slice(0, 3)).toEqual(["Shop 0", "Shop 1", "Shop 2"]);
  });

  it("finds nothing for an empty search or no fences", () => {
    expect(matchFences(all, "  ")).toEqual({ hits: [], total: 0 });
    expect(matchFences(null, "sukari")).toEqual({ hits: [], total: 0 });
  });
});

describe("fenceDetail", () => {
  it("says what each shape is", () => {
    expect(fenceDetail(fence("a", { type: "Point" }, { radiusM: 1500 }))).toBe("Circular fence · 1,500 m radius");
    expect(fenceDetail(fence("a", { type: "Polygon" }, { areaHa: 12 }))).toBe("Drawn fence · 12 ha");
    expect(fenceDetail(fence("a", { type: "Polygon" }, { areaHa: 0 }))).toBe("Drawn fence");
    expect(fenceDetail(fence("a", { type: "LineString" }, { category: "road" }))).toBe("Route");
    expect(fenceDetail(fence("a", { type: "LineString" }, { category: "drain" }))).toBe("Line");
  });
});
