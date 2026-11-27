import { describe, it, expect } from "vitest";
import { readingValue, readingVerdict, readingName, readingCounts, readingsSection, withSiteVerdicts } from "./trackerReadings";

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

describe("a label of Critical is a fault on the site (2026-11-27)", () => {
  it("GNSS Jamming: Critical becomes a fault; the server's own verdicts stand", () => {
    const d = withSiteVerdicts({ readings: [
      rd({ name: "15.GNSS Jamming", value: 2, label: "Critical", verdict: null }),
      rd({ name: "15.GNSS Jamming", value: 0, label: "Healthy", verdict: null }),
      rd({ name: "20.BLE Probe Battery", value: 3.6, label: "Heathly", verdict: "ok" }),
    ] });
    expect(d.readings.map((r) => r.verdict)).toEqual(["fault", null, "ok"]);
    expect(readingCounts(d.readings).faults).toBe(1);
    expect(readingsSection(d, "now").body[0]).toEqual(["GNSS Jamming", "2", "Critical", "Fault"]);
    expect(withSiteVerdicts(null)).toBeNull();
  });
});
