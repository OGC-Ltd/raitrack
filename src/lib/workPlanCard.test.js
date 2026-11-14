import { describe, it, expect } from "vitest";
import { planEntryFor, planCard, wallClock } from "./workPlanCard";

// FT-06 on 14 Nov, as FactorySuite's own row showed it to the operator
const line = {
  id: "l1", taskId: "T-261114-AGR-02", machine: "FT-06", machineName: "Truck", activity: "Agriculture - Haulage (Tons)",
  workLocation: "Nursery A", fuelingLocation: "Logistics Centre 1", operator: "Zuberi Justine Onesmo", secondOperator: null, thirdOperator: null,
  supervisor: "Joseph Amri", shiftNo: 1, shiftStart: "06:00:00", plannedHours: 8, plannedKm: 150,
  shiftFrom: "2026-11-14T03:00:00.000Z", shiftTo: "2026-11-14T11:00:00.000Z",
  fullTank: true, litresRequested: null, tankLitres: 380, needLitres: 50, expectedOutput: 30, outputUnit: "Tons",
  flags: ["Broken down"], downReason: "ELECTRICAL FAULT, LOW LEVEL OF ENGINE OIL", pump: null, vehicleId: "v6",
};
const plan = {
  id: "p", planCode: "WP-261114-AGR", department: "AGRICULTURE", status: "APPROVED", day: "2026-11-14",
  submittedBy: "Hashim", submittedAt: "2026-11-13T13:35:12.587308", reviewedBy: "Test", reviewedAt: "2026-11-14T06:44:42.628899",
  lines: [line],
};
const NOON = Date.parse("2026-11-14T09:00:00Z");

describe("wallClock", () => {
  it("reads FactorySuite's local time as written", () => {
    expect(wallClock("2026-11-13T13:35:12.587308")).toBe("13 Nov 2026, 13:35");
    expect(wallClock("2026-11-14")).toBe("14 Nov 2026");
    expect(wallClock(null)).toBe("");
  });
});

describe("planEntryFor", () => {
  it("finds the unit's line and plan", () => {
    const e = planEntryFor({ plans: [plan] }, "v6", NOON);
    expect(e.line.taskId).toBe("T-261114-AGR-02");
    expect(e.plan.planCode).toBe("WP-261114-AGR");
  });
  it("is null for a unit on no plan", () => {
    expect(planEntryFor({ plans: [plan] }, "v9", NOON)).toBeNull();
    expect(planEntryFor(null, "v6", NOON)).toBeNull();
  });
  it("takes the shift on now when the unit works two", () => {
    const night = { ...line, id: "l2", taskId: "T-N", shiftNo: 2, shiftFrom: "2026-11-14T15:00:00.000Z", shiftTo: "2026-11-14T23:00:00.000Z" };
    const e = planEntryFor({ plans: [{ ...plan, lines: [night, line] }] }, "v6", NOON);
    expect(e.line.taskId).toBe("T-261114-AGR-02");
    expect(e.shifts).toBe(2);
  });
});

describe("planCard", () => {
  it("says what FactorySuite's row says", () => {
    const c = planCard({ plan, line });
    expect(c.status).toBe("Approved");
    expect(c.machine).toEqual({ code: "FT-06", name: "Truck", activity: "Agriculture - Haulage (Tons)", fuel: "Full · tank 380 L · need ≈ 50 L",
      fuelFigures: [{ k: "Fuel", v: "Full" }, { k: "Tank", v: "380 L" }, { k: "Need", v: "≈ 50 L" }], expected: "Expected 30 Tons" });
    expect(c.plan).toEqual({
      head: "WP-261114-AGR · AGRICULTURE · 14 Nov", code: "WP-261114-AGR", about: "Agriculture, 14 Nov", task: "Task T-261114-AGR-02",
      sent: "Sent by Hashim, 13 Nov 2026, 13:35", decided: "Decided by Test, 14 Nov 2026, 06:44",
    });
    expect(c.where).toEqual({ fuelled: "Fuelled at Logistics Centre 1", works: "Works at Nursery A" });
    expect(c.shift).toEqual({ when: "Shift 1 from 06:00, 150 km", operators: "Operators: Zuberi Justine Onesmo", supervisors: "Supervisors: Joseph Amri" });
    expect(c.pump).toEqual(["Not fuelled yet"]);
    expect(c.flags).toBe("Flags: Broken down");
    expect(c.downReason).toBe("Electrical fault, low level of engine oil");
  });

  it("says a pending plan's machine cannot be fuelled yet", () => {
    const c = planCard({ plan: { ...plan, status: "DRAFT", reviewedBy: null }, line });
    expect(c.status).toBe("Pending");
    expect(c.pump).toEqual(["Not approved for the pump"]);
    expect(c.plan.decided).toBeNull();
  });

  it("lists what the pump issued", () => {
    const pump = { status: "APPROVED", issues: [
      { litres: 120, done: true, at: "2026-11-14T05:10:00", tank: "Tank 1", pump: "Logistics Centre 1", flags: ["Job mismatch"], note: null },
      { litres: null, done: false, at: "2026-11-14T05:20:00", tank: null, pump: null, flags: [], note: null },
    ] };
    expect(planCard({ plan, line: { ...line, pump } }).pump).toEqual(["120 L at 05:10 from Tank 1, Logistics Centre 1 (job mismatch)", "Fuelling since 05:20"]);
    expect(planCard({ plan, line: { ...line, pump: { status: "APPROVED", issues: [] } } }).pump).toEqual(["Not fuelled yet"]);
    expect(planCard({ plan, line: { ...line, pump: { status: "DECLINED", issues: [] } } }).pump).toEqual(["Request declined"]);
  });

  it("leaves out figures it does not have, and says hours for an hour-rated machine", () => {
    const c = planCard({ plan, line: { ...line, fullTank: false, litresRequested: 60, tankLitres: null, needLitres: null, plannedKm: null, plannedHours: 12, expectedOutput: null, flags: [] } });
    expect(c.machine.fuel).toBe("60 L");
    expect(c.machine.expected).toBeNull();
    expect(c.shift.when).toBe("Shift 1 from 06:00, 12 h");
    expect(c.flags).toBeNull();
  });
});
