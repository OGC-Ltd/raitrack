import { describe, it, expect } from "vitest";
import { plateIn, displayPlate } from "./plate";

describe("plateIn", () => {
  it("reads a plate that is the whole name", () => {
    expect(plateIn("KCS 969P")).toBe("KCS 969P");
    expect(plateIn("KHMA 826T")).toBe("KHMA 826T");
  });

  it("finds the plate inside a longer provider name", () => {
    expect(plateIn("CPO - Menengai - KCC 386Z - FMB140")).toBe("KCC 386Z");
    expect(plateIn("SEM 9685", "WKS - Naitiri - SEM 9685(KHMA 324X)-18L/H")).toBe("KHMA 324X");
    expect(plateIn("WKS - Naitiri - KCS 649Gl")).toBe("KCS 649G");
    expect(plateIn("KCS969P")).toBe("KCS 969P");
  });

  it("leaves names with no plate alone", () => {
    expect(plateIn("MUFINDI: 012", "MUFINDI: 012")).toBeNull();
    expect(plateIn("CAT 214B")).toBeNull();
    expect(plateIn("LOGYARD - Menengai - JCB 1 H00052413")).toBeNull();
    expect(plateIn("XKCS 969P")).toBeNull();
    expect(plateIn(null, undefined)).toBeNull();
  });
});

describe("displayPlate", () => {
  it("prints the plate where there is one, else the id", () => {
    expect(displayPlate({ id: "CPO - Menengai - KCC 386Z - FMB140", regPlate: "KCC 386Z" })).toBe("KCC 386Z");
    expect(displayPlate({ id: "MUFINDI: 012", regPlate: null })).toBe("MUFINDI: 012");
  });
});
