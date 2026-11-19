import { describe, it, expect } from "vitest";
import { changeWords, changeTone, planDoubles, undecidedPlans } from "./workPlanChanges";

describe("changeWords", () => {
  it("reads each kind", () => {
    expect(changeWords({ kind: "plan_status", fromValue: "DRAFT", toValue: "CANCELLED" })).toBe("Draft → Cancelled");
    expect(changeWords({ kind: "plan_added", toValue: "APPROVED, 3 lines" })).toBe("New plan, approved, 3 lines");
    expect(changeWords({ kind: "plan_removed", fromValue: "APPROVED" })).toBe("Deleted in FactorySuite (was approved)");
    expect(changeWords({ kind: "line_changed", field: "plannedHours", fromValue: "10", toValue: "8" })).toBe("Hours 10 → 8");
    expect(changeWords({ kind: "line_changed", field: "fullTank", fromValue: "true", toValue: "false" })).toBe("Full tank yes → no");
    expect(changeWords({ kind: "line_changed", field: "litresRequested", fromValue: null, toValue: "200" })).toBe("Litres none → 200");
    expect(changeWords({ kind: "line_changed", field: "shiftStart", fromValue: "06:00:00", toValue: "18:00:00" })).toBe("Start 06:00 → 18:00");
    expect(changeWords({ kind: "line_removed", fromValue: "shift 1 08:00, 10 h, full tank" })).toBe("Line removed: shift 1 08:00, 10 h, full tank");
  });
  it("tones", () => {
    expect(changeTone({ kind: "plan_status", toValue: "CANCELLED" })).toBe("bad");
    expect(changeTone({ kind: "plan_status", toValue: "APPROVED" })).toBe("good");
    expect(changeTone({ kind: "line_changed", field: "plannedHours" })).toBe("warn");
    expect(changeTone({ kind: "line_changed", field: "operator" })).toBe("info");
  });
});

const l = (planCode, machine, shiftNo, x = {}) => ({ planCode, planStatus: "APPROVED", day: "2026-11-18", machine, shiftNo, taskId: `T-${planCode}`, ...x });

describe("planDoubles", () => {
  it("finds a machine on one shift twice (FTT-10, 18 Nov) and not two shifts", () => {
    const d = planDoubles([l("ROA-5", "FTT-10", 1), l("ROA-10", "FTT-10", 1), l("IRR", "EX-16", 1), l("IRR", "EX-16", 2)]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ machine: "FTT-10", shiftNo: 1, day: "2026-11-18" });
    expect(d[0].lines.map((x) => x.planCode)).toEqual(["ROA-5", "ROA-10"]);
  });
});

describe("undecidedPlans", () => {
  it("drafts and submitted plans for days gone, one per plan", () => {
    const u = undecidedPlans([
      l("AGR", "FT-10", 1, { day: "2026-11-13", planStatus: "SUBMITTED" }),
      l("AGR", "GL-01", 1, { day: "2026-11-13", planStatus: "SUBMITTED" }),
      l("IRR", "EX-1", 1, { day: "2026-11-19", planStatus: "DRAFT" }),
      l("ROA", "EX-2", 1, { day: "2026-11-12", planStatus: "APPROVED" }),
    ], "2026-11-19");
    expect(u).toEqual([{ planCode: "AGR", day: "2026-11-13", status: "SUBMITTED", department: null, lines: 2 }]);
  });
});
