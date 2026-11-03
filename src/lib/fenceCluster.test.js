import { describe, it, expect } from "vitest";
import { fenceExtent, clusterFences, fenceBadgeLabel, fenceNames } from "./fenceCluster";

/** A square fence about `m` metres across at the equator. */
const fence = (id, lat, lng, m = 200) => {
  const d = m / 111320 / 2;
  return { id, ...fenceExtent([[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d]]) };
};

describe("fenceExtent", () => {
  it("measures where a fence is and how big", () => {
    const f = fence("a", 0, 36, 1000);
    expect(f.lat).toBeCloseTo(0);
    expect(f.lng).toBeCloseTo(36);
    // 1 km is about 209 px at zoom 15 at the equator.
    expect(f.size * 2 ** 15).toBeGreaterThan(200);
    expect(f.size * 2 ** 15).toBeLessThan(220);
  });
});

describe("clusterFences", () => {
  const near = [fence("a", 0.2, 36.1), fence("b", 0.201, 36.101)];

  it("groups small fences close together, and gives their combined bounds", () => {
    const { drawn, groups } = clusterFences(near, 8);
    expect(drawn.size).toBe(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].n).toBeGreaterThan(0.201);
    expect(groups[0].s).toBeLessThan(0.2);
  });

  it("draws the same fences once they are big enough to read", () => {
    const { drawn, groups } = clusterFences(near, 16);
    expect(drawn.size).toBe(2);
    expect(groups).toHaveLength(0);
  });

  it("never swallows a big fence into a group", () => {
    const big = fence("works", 0, 36, 50000);
    const { drawn, groups } = clusterFences([big, ...near], 8);
    expect(drawn.has(big)).toBe(true);
    expect(groups[0].members.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("keeps a lone small fence as a group of one rather than losing it", () => {
    const { groups } = clusterFences([fence("a", 0, 36), fence("far", 2, 38)], 8);
    expect(groups.map((g) => g.members.length)).toEqual([1, 1]);
  });

  it("keeps the same groups at a fractional stop of the same zoom", () => {
    const keys = (z) => clusterFences(near, z).groups.map((g) => g.key);
    expect(keys(8.2)).toEqual(keys(8));
  });
});

describe("fenceNames", () => {
  it("lists every fence, repeats included, sorted the way a person reads them", () => {
    const members = [{ name: "VES 10" }, { name: "  ves  2 " }, { name: "Khetias" }, { name: "Khetias" }];
    expect(fenceNames(members)).toEqual(["Khetias", "Khetias", "ves 2", "VES 10"]);
  });
});

describe("fenceBadgeLabel", () => {
  it("is exact, then thousands", () => {
    expect(fenceBadgeLabel(8)).toBe("8");
    expect(fenceBadgeLabel(999)).toBe("999");
    expect(fenceBadgeLabel(1000)).toBe("1k");
    expect(fenceBadgeLabel(1240)).toBe("1.2k");
    expect(fenceBadgeLabel(6169)).toBe("6.2k");
    expect(fenceBadgeLabel(12400)).toBe("12k");
  });
});
