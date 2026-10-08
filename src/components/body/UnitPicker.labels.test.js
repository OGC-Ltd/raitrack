import { describe, it, expect, vi } from "vitest";

vi.mock("../../context/AppContext", () => ({ useAppSelector: () => null, useAppActions: () => ({}), useCompanies: () => ({}) }));
vi.mock("../../hooks/useCrossOrgUnits", () => ({ useCrossOrgUnits: () => ({ companies: [], loading: false }) }));
import { sharedPrefix, rowLabel } from "./UnitPicker";

const u = (id, name, machineName) => ({ id, name, machineName });

describe("UnitPicker row labels", () => {
  const fleet = [
    u("KDJ 810Z", "WKS - Nzoia Sugar - KDJ 810Z"),
    u("KDJ 812Z", "WKS - Nzoia Sugar - KDJ 812Z"),
    u("KDW 648X", "WKS - Nzoia Sugar - KDW 648X - Low loader"),
    u("CASE 225", "WKS - Nzoia Sugar - CASE 225"),
  ];
  it("finds what every unit's name repeats", () => {
    expect(sharedPrefix(fleet)).toEqual(["wks", "nzoiasugar"]);
  });
  it("shows only what is left once the prefix and the plate are gone", () => {
    const p = sharedPrefix(fleet);
    expect(rowLabel(fleet[0], p)).toBe("");
    expect(rowLabel(fleet[2], p)).toBe("Low loader");
  });
  it("keeps a machine name that says something", () => {
    expect(rowLabel(u("FT 13", "MUFINDI - FT 13", "Mahindra tractor"), [])).toBe("Mahindra tractor");
  });
  it("names no prefix for a small or mixed fleet", () => {
    expect(sharedPrefix(fleet.slice(0, 2))).toEqual([]);
    expect(sharedPrefix([u("A1", "X - A1"), u("B1", "Y - B1"), u("C1", "Z - C1")])).toEqual([]);
  });
});
