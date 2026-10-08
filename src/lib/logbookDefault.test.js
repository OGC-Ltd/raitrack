import { describe, it, expect } from "vitest";
import { defaultLogbookUnit, hasPlate } from "./logbookDefault";

const v = (id, extra = {}) => ({ vehicleId: id, id, plate: id, ...extra });

describe("defaultLogbookUnit", () => {
  it("takes the first preferred plate the organisation has, in list order", () => {
    const fleet = [v("KDU 155C"), v("KDW 648X"), v("KAA 001A")];
    expect(defaultLogbookUnit(fleet).id).toBe("KDW 648X");
  });
  it("falls back to the factory plates when no preferred plate is there", () => {
    expect(defaultLogbookUnit([v("KAA 001A"), v("KBJ 159G")]).id).toBe("KBJ 159G");
  });
  it("prefers a preferred plate over a fallback one", () => {
    expect(defaultLogbookUnit([v("KDX 568Z"), v("KDW 023H")]).id).toBe("KDW 023H");
  });
  it("returns null when none is in the organisation", () => {
    expect(defaultLogbookUnit([v("KAA 001A")])).toBe(null);
    expect(defaultLogbookUnit([])).toBe(null);
  });
  it("matches ignoring spaces and case, and inside a name", () => {
    expect(hasPlate({ plate: "kdx568z" }, "KDX 568Z")).toBe(true);
    expect(hasPlate({ id: "x", name: "NZOIA - KDX 568Z" }, "KDX 568Z")).toBe(true);
    expect(hasPlate({ plate: "KDX 568" }, "KDX 568Z")).toBe(false);
  });
});
