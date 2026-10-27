import { describe, it, expect } from "vitest";
import { weatherTone, weatherTitle } from "./weatherChip";

describe("weather chips", () => {
  it("marks storms and rain, and leaves fair weather plain", () => {
    expect(weatherTone({ type: "THUNDERSTORM" })).toBe("storm");
    expect(weatherTone({ type: "CLOUDY", thunderPct: 60 })).toBe("storm");
    expect(weatherTone({ type: "LIGHT_RAIN" })).toBe("rain");
    expect(weatherTone({ type: "CLOUDY", rainPct: 70 })).toBe("rain");
    expect(weatherTone({ type: "PARTLY_CLOUDY", rainPct: 5 })).toBeNull();
  });

  it("says rain, thunder and wind on hover", () => {
    expect(weatherTitle({ text: "Light rain", rainPct: 70, thunderPct: 0, windKmh: 14.2, windFrom: "NORTH_EAST" }))
      .toBe("Light rain · 70% rain · wind 14 km/h from the north east");
    expect(weatherTitle({ type: "FOG", text: "", visibilityKm: 0.8 })).toBe("FOG · visibility 0.8 km");
  });
});
