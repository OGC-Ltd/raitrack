import { describe, it, expect } from "vitest";
import { reviewWindow } from "./FuelStandardCard";

describe("reviewWindow", () => {
  it("reads the page's window as fleet-day keys", () => {
    expect(reviewWindow(30, "2026-09-30T12:00:00+03:00")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(reviewWindow(1, "2026-09-30T12:00:00+03:00")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });
});
