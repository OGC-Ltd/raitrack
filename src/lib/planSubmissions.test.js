import { describe, it, expect } from "vitest";
import { cellDetail, cellTitle, wallClock, weekday, isWeekend, cellIndex, planStats, unitRows, filterUnitRows, planStatus, dailySent } from "./planSubmissions";

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

describe("the day's plans, unit by unit", () => {
  const plans = [
    { id: "a", planCode: "WP-1-CIV", department: "CIVIL", status: "APPROVED", lines: [{ id: 1, machine: "EX-20", operator: "WILLIAM CORNEL KAFIPA", shiftNo: 1 }, { id: 2, machine: "EX-20", shiftNo: 2 }] },
    { id: "b", planCode: "WP-1-ROA", department: "ROADS", status: "DRAFT", lines: [{ id: 3, machine: "GR-04", operator: "george heneriko" }] },
    { id: "c", planCode: "WP-1-IRR", department: "IRRIGATION", status: "SUBMITTED", lines: [{ id: 4, machine: "EX-16" }] },
    { id: "d", planCode: "WP-2-IRR", department: "IRRIGATION", status: "REJECTED", lines: [{ id: 5, machine: "EX-08" }] },
    { id: "e", planCode: "WP-3-IRR", department: "IRRIGATION", status: "CANCELLED", lines: [{ id: 6, machine: "EX-09" }] },
  ];
  it("counts the four figures", () => {
    expect(planStats(plans)).toEqual({ approved: 1, waiting: 1, changes: 1, drafts: 1, cancelled: 1, machines: 1, lines: 2, hours: 0, departments: 3, plans: 5 });
  });
  it("lists every line, by department then status", () => {
    const rows = unitRows(plans, { name: (s) => s.toUpperCase() });
    expect(rows.map((r) => `${r.department} ${r.machine} ${r.status}`)).toEqual([
      "CIVIL EX-20 APPROVED", "CIVIL EX-20 APPROVED", "IRRIGATION EX-16 SUBMITTED", "IRRIGATION EX-08 REJECTED", "IRRIGATION EX-09 CANCELLED", "ROADS GR-04 DRAFT",
    ]);
    expect(rows.at(-1).operators).toEqual(["GEORGE HENERIKO"]);
  });
  it("filters by department, status and words", () => {
    const rows = unitRows(plans);
    expect(filterUnitRows(rows, { departments: ["IRRIGATION"] })).toHaveLength(3);
    expect(filterUnitRows(rows, { statuses: ["DRAFT", "CANCELLED"] }).map((r) => r.machine)).toEqual(["EX-09", "GR-04"]);
    expect(filterUnitRows(rows, { q: "heneriko" }).map((r) => r.machine)).toEqual(["GR-04"]);
  });
  it("names a status it does not know as it comes", () => {
    expect(planStatus("cancelled").label).toBe("Cancelled");
    expect(planStatus("ON_HOLD").label).toBe("On hold");
  });
});

describe("the strip's daily series", () => {
  it("counts departments sent and sent on time a day", () => {
    const board = { days: ["2026-11-19", "2026-11-20"], departments: ["CIVIL", "ROADS"], sent: { "2026-11-19": 1, "2026-11-20": 2 },
      cells: [{ department: "CIVIL", day: "2026-11-19", state: "approved_late" }, { department: "CIVIL", day: "2026-11-20", state: "approved" }, { department: "ROADS", day: "2026-11-20", state: "sent" }] };
    expect(dailySent(board)).toEqual([{ day: "2026-11-19", sent: 1, onTime: 0 }, { day: "2026-11-20", sent: 2, onTime: 2 }]);
  });
});
