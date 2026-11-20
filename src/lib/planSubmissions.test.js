import { describe, it, expect } from "vitest";
import { cellDetail, cellTitle, wallClock, weekday, isWeekend, cellIndex } from "./planSubmissions";

describe("plan submissions words", () => {
  it("reads FactorySuite's wall clock as text", () => {
    expect(wallClock("2026-11-19T15:44:00.624", "2026-11-19")).toBe("15:44");
    expect(wallClock("2026-11-18T20:04:47.2", "2026-11-19")).toBe("18 Nov 20:04");
    expect(wallClock(null, "2026-11-19")).toBeNull();
  });
  it("weekdays do not move with the browser's zone", () => {
    expect(weekday("2026-11-21")).toBe("Sa");
    expect(isWeekend("2026-11-22")).toBe(true);
    expect(isWeekend("2026-11-20")).toBe(false);
  });
  it("says when a plan was sent, by the day before's clock", () => {
    const cell = { day: "2026-11-20", state: "approved_late", submittedAt: "2026-11-19T21:19:52", plans: [] };
    expect(cellDetail(cell)).toBe("Approved, late, sent 21:19");
    expect(cellDetail({ day: "2026-11-20", state: "draft", submittedAt: null, plans: [{}, {}] })).toBe("2 drafts, not sent");
    expect(cellDetail({ day: "2026-11-21", state: "none", submittedAt: null, plans: [] })).toBe("Not started");
  });
  it("lists each plan in the hover", () => {
    const cell = { day: "2026-11-20", state: "approved", submittedAt: "2026-11-19T15:44:00", plans: [
      { planCode: "WP-261120-CIV", status: "APPROVED", submittedAt: "2026-11-19T15:44:00", submittedBy: "Asha", reviewedAt: "2026-11-19T16:12:54", reviewedBy: null, note: null },
    ] };
    expect(cellTitle(cell, "CIVIL")).toBe("CIVIL, Friday 20 Nov: Approved\nWP-261120-CIV, approved, sent 15:44 by Asha, approved 16:12");
  });
  it("indexes cells by department and day", () => {
    const idx = cellIndex({ cells: [{ department: "ROADS", day: "2026-11-20", state: "sent" }] });
    expect(idx.get("ROADS").get("2026-11-20").state).toBe("sent");
  });
});
