import { describe, it, expect } from "vitest";
import { offeredClasses, offeredClass } from "./HubArrivals";

const keys = (list) => list.map(([k]) => k);

describe("offeredClasses", () => {
  it("offers Plant only where the fleet has plant (Kasulu, from the machine register)", () => {
    expect(keys(offeredClasses({ VEHICLE: 89, TRACTOR: 46, PLANT: 77 }))).toEqual(["VEHICLE", "TRACTOR", "PLANT"]);
    expect(keys(offeredClasses({ VEHICLE: 140, TRACTOR: 120, PLANT: 0 }))).toEqual(["VEHICLE", "TRACTOR"]);
  });
  it("always offers Truck or car, and drops a class with no units", () => {
    expect(keys(offeredClasses({ VEHICLE: 0, TRACTOR: 0, PLANT: 0 }))).toEqual(["VEHICLE"]);
  });
  it("keeps the two old classes when the server sends no counts", () => {
    expect(keys(offeredClasses(undefined))).toEqual(["VEHICLE", "TRACTOR"]);
  });
});

describe("offeredClass", () => {
  it("falls back to Truck or car when the remembered class is not on offer", () => {
    const sukari = offeredClasses({ VEHICLE: 140, TRACTOR: 120, PLANT: 0 });
    expect(offeredClass("PLANT", sukari)).toBe("VEHICLE");
    expect(offeredClass("TRACTOR", sukari)).toBe("TRACTOR");
    expect(offeredClass("PLANT", offeredClasses({ VEHICLE: 1, TRACTOR: 1, PLANT: 3 }))).toBe("PLANT");
  });
});
