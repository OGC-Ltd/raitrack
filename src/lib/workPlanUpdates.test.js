import { describe, it, expect } from "vitest";
import { editWords, lineEdits, statusLabel, statusTone, statusWords, undecidedPlans } from "./workPlanUpdates";

describe("status", () => {
  it("draft and submitted are pending", () => {
    expect(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"].map(statusLabel))
      .toEqual(["Pending", "Pending", "Approved", "Rejected", "Cancelled"]);
    expect(["APPROVED", "REJECTED", "SUBMITTED"].map(statusTone)).toEqual(["good", "bad", "info"]);
  });

  it("an item updated in place reads from → to; draft to submitted is still pending", () => {
    expect(statusWords({ status: "APPROVED", previousStatus: "SUBMITTED" })).toBe("Pending → Approved");
    expect(statusWords({ status: "REJECTED", previousStatus: "DRAFT" })).toBe("Pending → Rejected");
    expect(statusWords({ status: "SUBMITTED", previousStatus: "DRAFT" })).toBe("Pending");
    expect(statusWords({ status: "APPROVED", previousStatus: null })).toBe("Approved");
  });
});

describe("edits", () => {
  it("reads each field", () => {
    expect(editWords({ field: "plannedHours", from: "10", to: "8" })).toBe("Hours 10 → 8");
    expect(editWords({ field: "fullTank", from: "true", to: "false" })).toBe("Full tank yes → no");
    expect(editWords({ field: "litresRequested", from: null, to: "200" })).toBe("Litres none → 200");
    expect(editWords({ field: "shiftStart", from: "06:00:00", to: "18:00:00" })).toBe("Start 06:00 → 18:00");
  });

  it("lineEdits leaves the status out", () => {
    expect(lineEdits({ lastEdits: [{ field: "status", from: "DRAFT", to: "APPROVED" }, { field: "operator", from: "A", to: "B" }] }))
      .toEqual(["Operator A → B"]);
    expect(lineEdits({ lastEdits: null })).toEqual([]);
  });
});

const l = (planCode, machine, x = {}) => ({ planCode, planStatus: "APPROVED", day: "2026-11-18", machine, shiftNo: 1, ...x });

describe("undecidedPlans", () => {
  it("drafts and submitted plans for days gone, one per plan", () => {
    const u = undecidedPlans([
      l("AGR", "FT-10", { day: "2026-11-13", planStatus: "SUBMITTED" }),
      l("AGR", "GL-01", { day: "2026-11-13", planStatus: "SUBMITTED" }),
      l("IRR", "EX-1", { day: "2026-11-19", planStatus: "DRAFT" }),
      l("ROA", "EX-2", { day: "2026-11-12", planStatus: "APPROVED" }),
    ], "2026-11-19");
    expect(u).toEqual([{ planCode: "AGR", day: "2026-11-13", status: "SUBMITTED", department: null, lines: 2 }]);
  });
});
