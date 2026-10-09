import { describe, it, expect } from "vitest";
import { osmActivity, pickPoi } from "./osmPlaceNames";

describe("osmActivity", () => {
  it("reads what a place is from its OSM tags", () => {
    expect(osmActivity({ amenity: "bank" })).toBe("Banking");
    expect(osmActivity({ amenity: "restaurant" })).toBe("Food and drink");
    expect(osmActivity({ healthcare: "hospital" })).toBe("Medical");
    expect(osmActivity({ amenity: "fuel", shop: "convenience" })).toBe("Fuel");
    expect(osmActivity({ landuse: "industrial" })).toBe("Industrial / works");
    expect(osmActivity({ name: "x" })).toBeNull();
  });
});

describe("pickPoi", () => {
  const p = { lat: 0.5, lng: 34.5 };
  const bank = { type: "node", lat: 0.5005, lon: 34.5, tags: { name: "Equity Bank", amenity: "bank" } };
  const far = { type: "node", lat: 0.503, lon: 34.5, tags: { name: "Far Cafe", amenity: "cafe" } };
  const works = { type: "way", center: { lat: 0.51, lon: 34.51 }, bounds: { minlat: 0.49, minlon: 34.49, maxlat: 0.52, maxlon: 34.52 }, tags: { name: "WEST KENYA SUGAR COMPANY", landuse: "industrial" } };
  const road = { type: "way", center: { lat: 0.5, lon: 34.5 }, tags: { name: "Kakamega Road", highway: "primary" } };
  it("takes the nearest named business, else the premises around it", () => {
    expect(pickPoi(p, [far, works, bank, road])).toEqual({ name: "Equity Bank", activity: "Banking" });
    expect(pickPoi(p, [far, works, road])).toEqual({ name: "West Kenya Sugar Company", activity: "Industrial / works" });
    expect(pickPoi(p, [far, road])).toBeNull();
  });
});
