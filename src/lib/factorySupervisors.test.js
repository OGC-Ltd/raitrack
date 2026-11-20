import { describe, it, expect } from "vitest";
import { linesByDay, shiftsWithDays, operatorName, shiftLabel, supervisorPeriods, supervisorsByDay, supervisorTotals } from "./factorySupervisors";

const sup = (name, extra = {}) => ({
  key: name.toLowerCase(), name, lines: 2, plannedHours: 18, judged: 2, judgedPlannedHours: 18, runHours: 9,
  ran: 1, notRun: 1, lateStarts: 0, silent: 0, untracked: 0, open: 0, machines: [{ reference: "EX-01" }], ...extra,
});

describe("factorySupervisors", () => {
  it("totals the supervisors on screen, delivered over judged hours only", () => {
    const t = supervisorTotals([sup("A"), sup("B", { machines: [{ reference: "ex-01" }, { reference: "TR-02" }], judgedPlannedHours: 6, runHours: 6, untracked: 3 })]);
    expect(t).toMatchObject({ supervisors: 2, lines: 4, machines: 2, runHours: 15, judgedPlannedHours: 24, deliveredPct: 63, untracked: 3, notRun: 2 });
    expect(supervisorTotals([]).deliveredPct).toBeNull();
  });

  it("charts each day: judged hours planned and run, and supervisors on a line", () => {
    const data = { from: "2026-11-13", to: "2026-11-15" };
    const rows = [
      { history: [{ day: "2026-11-13", state: "ran", plannedHours: 10, runHours: 8 }, { day: "2026-11-13", state: "untracked", plannedHours: 8 }] },
      { history: [{ day: "2026-11-14", state: "not-run", plannedHours: 6, runHours: 0.1 }] },
    ];
    expect(supervisorsByDay(data, rows)).toEqual([
      { day: "2026-11-13", planned: 10, run: 8, lines: 2, supervisors: 1 },
      { day: "2026-11-14", planned: 6, run: 0.1, lines: 1, supervisors: 1 },
      { day: "2026-11-15", planned: 0, run: 0, lines: 0, supervisors: 0 },
    ]);
  });

  it("groups a supervisor's lines by day, newest first", () => {
    const days = linesByDay([
      { day: "2026-11-13", plannedHours: 10, runHours: 8 },
      { day: "2026-11-14", plannedHours: 8, runHours: null },
      { day: "2026-11-13", plannedHours: 8, runHours: 0.1 },
    ]);
    expect(days.map((d) => [d.day, d.lines.length, d.plannedHours, d.runHours])).toEqual([
      ["2026-11-14", 1, 8, 0], ["2026-11-13", 2, 18, 8.1],
    ]);
  });

  it("names shifts, operators and periods plainly", () => {
    expect(shiftLabel(2, "18:00:00")).toBe("Shift 2 · 18:00");
    expect(shiftLabel(null, null)).toBe("–");
    expect(operatorName("EMMANUEL VICENT MTULO - EXCAVATOR OPERATOR")).toBe("Emmanuel Vicent Mtulo");
    const p = supervisorPeriods(Date.parse("2026-11-19T09:00:00Z"));
    expect(p.find((x) => x.key === "14d")).toMatchObject({ from: "2026-11-06", to: "2026-11-19" });
    expect(p.find((x) => x.key === "last")).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
  });
});

describe("shiftsWithDays", () => {
  const l = (day, shiftNo, shiftStart, plannedHours, runHours = null) => ({ day, shiftNo, shiftStart, plannedHours, runHours });
  const out = shiftsWithDays([
    l("2026-11-20", 1, "07:00", 8, 5),
    l("2026-11-20", 1, "07:00", 8, null),
    l("2026-11-21", 1, "07:00", 8, 7.5),
    l("2026-11-21", 2, "14:00", 6, 6),
  ]);
  it("groups by shift, most lines first", () => {
    expect(out.map((s) => s.key)).toEqual(["1@07:00", "2@14:00"]);
    expect(out[0]).toMatchObject({ lines: 3, plannedHours: 24, judged: 2, judgedPlanned: 16, runHours: 12.5 });
  });
  it("splits each shift by day, newest first, run set against tracked lines only", () => {
    expect(out[0].days.map((d) => d.day)).toEqual(["2026-11-21", "2026-11-20"]);
    expect(out[0].days[1]).toMatchObject({ lines: 2, plannedHours: 16, judged: 1, judgedPlanned: 8, runHours: 5 });
  });
  it("is empty with no history", () => { expect(shiftsWithDays()).toEqual([]); });
});
