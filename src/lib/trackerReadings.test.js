import { describe, it, expect } from "vitest";
import { readingValue, readingVerdict, readingName, readingCounts, readingsSection } from "./trackerReadings";

const rd = (o) => ({ name: "1.X", type: "custom", unit: null, value: 0, label: null, verdict: null, ...o });

describe("a tracker reading as words", () => {
  it("switches read On / Off, figures carry their unit, a missing value says so", () => {
    expect(readingValue(rd({ type: "engine operation", value: 1, unit: "On/Off" }))).toBe("On");
    expect(readingValue(rd({ type: "digital", value: 0 }))).toBe("Off");
    expect(readingValue(rd({ value: 11.4913, unit: "V" }))).toBe("11.491 V");
    expect(readingValue(rd({ value: 11426 }))).toBe("11,426");
    expect(readingValue(rd({ value: null }))).toBe("No reading");
  });
  it("names drop the running number; verdicts read Fault / OK / blank", () => {
    expect(readingName(rd({ name: "14.GNSS Status" }))).toBe("GNSS Status");
    expect(readingVerdict(rd({ verdict: "fault" }))).toBe("Fault");
    expect(readingVerdict(rd({ verdict: "ok" }))).toBe("OK");
    expect(readingVerdict(rd({}))).toBe("");
  });
  it("the PDF section puts faults first and counts them", () => {
    const data = { readings: [
      rd({ name: "9.External Battery Voltage", value: 26.1, unit: "V" }),
      rd({ name: "11.Fls Status", value: 3, label: "Error", verdict: "fault" }),
      rd({ name: "2.Main Tank Fuel Level", value: null }),
    ] };
    expect(readingCounts(data.readings)).toEqual({ total: 3, faults: 1, none: 1 });
    const s = readingsSection(data, "27/11/2026 16:40");
    expect(s.small).toBe("27/11/2026 16:40 · 1 fault");
    expect(s.body[0]).toEqual(["Fls Status", "3", "Error", "Fault"]);
    expect(s.body[2]).toEqual(["Main Tank Fuel Level", "No reading", "-", "-"]);
  });
});
