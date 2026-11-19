import { describe, it, expect } from "vitest";
import { linesByDay, operatorName, shiftLabel, supervisorPeriods, supervisorTotals } from "./factorySupervisors";

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
