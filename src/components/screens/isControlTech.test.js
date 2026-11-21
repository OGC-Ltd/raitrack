import { describe, it, expect } from "vitest";
import { isControlTech, ctGroup } from "./WorkshopScreen";

const fs = { fsJobCards: [{ cardNumber: "JC-1", checkedInAt: "2026-11-13T08:00:00Z" }] };

describe("isControlTech", () => {
  it("keeps a closed FactorySuite workshop job with a telematics fault", () => {
    expect(isControlTech({ ...fs, resolvedAt: "2026-11-14T04:58:11Z", stage: "fixed", queue: "workshop", faultCategory: "gps" })).toBe(true);
  });
  it("keeps an open FactorySuite workshop job with a telematics fault, grouped In the workshop", () => {
    const j = { ...fs, resolvedAt: null, stage: "in_workshop", queue: "workshop", faultCategory: "sensor" };
    expect(isControlTech(j)).toBe(true);
    expect(ctGroup(j)).toBe("workshop");
  });
  it("leaves out an open workshop job with a mechanical fault", () => {
    expect(isControlTech({ ...fs, resolvedAt: null, stage: "in_workshop", queue: "workshop", faultCategory: "engine" })).toBe(false);
  });
  it("keeps an open forwarded job", () => {
    expect(isControlTech({ resolvedAt: null, stage: "forwarded", queue: "controltech", faultCategory: "fuel_probe" })).toBe(true);
  });
});
