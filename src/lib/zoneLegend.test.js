/* The map key, and the promise it makes.
 *
 * A key is a reading of the map in front of you. The old one was a constant
 * listing twelve land uses and was shown to every organisation, so Sukari —
 * which carries three zones — was handed a key naming Nursery, Rain-fed,
 * Wetland and Haulage road, none of which are anywhere on its map. What is
 * pinned here is that the key can only name what is drawn.
 */

import { describe, it, expect } from "vitest";
import { legendFor, zoneColor, fenceColorKey, isDummyFence, ZONE_STYLE, ZONE_LEGEND } from "./zoneLegend";

const labels = (cats) => legendFor(cats).map((r) => r.label);
const keys   = (cats) => legendFor(cats).map((r) => r.key);

describe("legendFor", () => {
  it("names only the categories the organisation actually has", () => {
    // West Kenya's six geofences are three factory and three unclassified.
    expect(labels(["factory", "other"])).toEqual(["Factory", "Other"]);
  });

  it("does not invent the rest of the catalogue", () => {
    const out = labels(["factory", "other"]);
    for (const absent of ["Nursery", "Rain-fed", "Wetland", "Haulage road", "Farm block"]) {
      expect(out).not.toContain(absent);
    }
  });

  it("is empty when nothing is drawn", () => {
    expect(legendFor([])).toEqual([]);
  });

  /* Keep-outs and gates lead. They are the only entries describing somewhere a
   * machine should not be, and a key that buries them under nine land uses is a
   * key read too late. */
  it("puts the things a machine must avoid first", () => {
    expect(keys(["farm", "road", "restricted", "gate"]))
      .toEqual(["restricted", "gate", "farm", "road"]);
  });

  it("orders by the catalogue, not by the order it was handed", () => {
    expect(keys(["road", "nursery", "farm"])).toEqual(["farm", "nursery", "road"]);
  });

  it("carries each category's own colour", () => {
    expect(legendFor(["restricted"])[0].color).toBe(ZONE_STYLE.restricted.color);
  });

  /* The backend derives a category from the zone's name, so it can start
   * emitting one this list has never seen. Appending it grey is a visible
   * prompt; dropping it would draw a colour with no key entry at all. */
  it("keeps an unranked category rather than dropping it", () => {
    const out = keys(["farm", "quarry"]);
    expect(out).toContain("quarry");
    expect(out.indexOf("quarry")).toBeGreaterThan(out.indexOf("farm"));
    expect(legendFor(["quarry"])[0].color).toBe(ZONE_STYLE.other.color);
  });

  it("sorts several unranked categories predictably", () => {
    expect(keys(["zeta", "alpha"])).toEqual(["alpha", "zeta"]);
  });

  /* The works-site vocabulary exists because "Farm block" describes nothing on
   * a mill site. Every category the ranking names must have a style, or it
   * would rank into the key and then draw as undefined. */
  it("gives every ranked category a style", () => {
    for (const key of ZONE_LEGEND) expect(ZONE_STYLE[key], key).toBeDefined();
  });

  /* The server files 5,840 of Menengai's fences as `shop`; without a style they
   * all drew in the unclassified grey. */
  it("draws the trading fences in their own colours, not the grey", () => {
    const colors = ["shop", "customer"].map((k) => zoneColor(k, "osm"));
    expect(new Set(colors).size).toBe(2);
    expect(colors).not.toContain(ZONE_STYLE.other.color);
    expect(keys(["shop", "customer"])).toEqual(["shop", "customer"]);
  });

  it("carries the site vocabulary a mill needs", () => {
    expect(labels(["yard", "parking", "workshop", "weighing", "gate"]))
      .toEqual(["Gate", "Yard", "Vehicle park", "Workshop", "Weighbridge"]);
  });
});

describe("fenceColorKey", () => {
  const fence = (type, name, category = "other") => ({ geometry: { type }, properties: { name, category } });
  const color = (f) => zoneColor(fenceColorKey(f));

  it("draws routes, HQs and shops in the operator's colours", () => {
    expect(color(fence("LineString", "Kabras - Selia Route", "road"))).toBe("#fb8500");
    expect(color(fence("Polygon", "Menengai Yard - Nakuru HQ", "logistics"))).toBe("#90e0ef");
    expect(color(fence("Point", "MENENGAI_VS:RIZIKI SHOP", "shop"))).toBe("#ffb703");
    expect(color(fence("Point", "MENENGAI_VS:DIAMOND WHOLESALERS", "shop"))).toBe("#ffb703");
    expect(color(fence("Point", "MENENGAI_FG:ALPHA SHOP", "customer"))).toBe("#ffb703");
  });

  it("leaves everything else colouring by shape", () => {
    expect(fenceColorKey(fence("LineString", "Main river malagarasi", "water"))).toBe("fence");
    expect(fenceColorKey(fence("LineString", "DRAINS1", "drain"))).toBe("fence");
    expect(fenceColorKey(fence("Polygon", "workshop1", "facility"))).toBe("fence");
    expect(fenceColorKey(fence("Point", "MENENGAI_FG: NAIVAS", "customer"))).toBe("circle");
  });
});

describe("isDummyFence", () => {
  it("finds dummy and test fences by whole word", () => {
    for (const name of ["Menengai Dummy Geofence", "MENENGAI_VS:TEST CUSTOMERSHOP", "Damsite 2 Test"]) {
      expect(isDummyFence(name)).toBe(true);
    }
  });

  it("leaves real customers whose names only contain the letters", () => {
    for (const name of ["MENENGAI_VS: TESTIMONY SHOP", "MENENGAI_VS:TESTAI SHOP", "MENENGAI_VS: DEMOLIOUS", null]) {
      expect(isDummyFence(name)).toBe(false);
    }
  });
});

/* The site fence was white for satellite imagery, and white on OpenStreetMap's
 * pale land drew nothing at all (operator, 2026-10-09). */
describe("zoneColor", () => {
  it("draws the geofence layer's two shapes in one colour each on every base map", () => {
    for (const base of ["osm", "google", "google-satellite"]) {
      expect(zoneColor("circle", base)).toBe("#386641");
      expect(zoneColor("fence", base)).toBe("#a7c957");
    }
    expect(keys(["fence", "circle"])).toEqual(["circle", "fence"]);
  });

  it("draws the site perimeter orange on OpenStreetMap, white on satellite", () => {
    expect(zoneColor("perimeter", "osm")).toBe("#ea580c");
    expect(zoneColor("perimeter", "google")).toBe(ZONE_STYLE.perimeter.color);
  });

  it("leaves categories without an OSM colour alone on either base", () => {
    expect(zoneColor("farm", "osm")).toBe(ZONE_STYLE.farm.color);
    expect(zoneColor("farm", "google")).toBe(ZONE_STYLE.farm.color);
    expect(zoneColor("quarry", "osm")).toBe(ZONE_STYLE.other.color);
  });

  it("keys the swatch to the map in front of you", () => {
    expect(legendFor(["perimeter"], "osm")[0].color).toBe("#ea580c");
    expect(legendFor(["perimeter"], "google")[0].color).toBe(ZONE_STYLE.perimeter.color);
  });
});
