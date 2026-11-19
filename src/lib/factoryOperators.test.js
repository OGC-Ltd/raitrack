import { describe, it, expect } from "vitest";
import { kindMix, onShiftNow, shiftWindow, machineKind, operatorsByDay, operatorTotals, operatorDepartments, roleKind, hasOperators, nameCase, initials } from "./factoryOperators";

const op = (name, lines, extra = {}) => ({
  key: name.toLowerCase(), name, role: "EXCAVATOR OPERATOR", shifts: lines.length,
  plannedHours: lines.reduce((s, l) => s + (l.plannedHours ?? 0), 0),
  departments: ["IRRIGATION"], machines: lines.map((l) => ({ reference: l.machine, shifts: 1 })),
  lines, fuellings: [], mismatches: 0, ...extra,
});
const data = {
  from: "2026-11-13", to: "2026-11-15",
  operators: [
    op("A", [{ day: "2026-11-13", machine: "EX-01", plannedHours: 10 }, { day: "2026-11-13", machine: "EX-02", plannedHours: 2 }]),
    op("B", [{ day: "2026-11-14", machine: "EX-01", plannedHours: 8 }], { role: "TIPPER DRIVER", departments: ["ROADS"], mismatches: 1, fuellings: [{ id: "i" }] }),
    op("C", [], { role: null, departments: [] }),
  ],
};

describe("factoryOperators", () => {
  it("counts shifts and operators per day across the whole range", () => {
    expect(operatorsByDay(data)).toEqual([
      { day: "2026-11-13", shifts: 2, operators: 1, hours: 12 },
      { day: "2026-11-14", shifts: 1, operators: 1, hours: 8 },
      { day: "2026-11-15", shifts: 0, operators: 0, hours: 0 },
    ]);
  });

  it("totals the rows on screen", () => {
    const t = operatorTotals(data.operators);
    expect(t).toMatchObject({ operators: 3, onPlans: 2, pumpOnly: 1, shifts: 3, hours: 20, machines: 2, departments: 2, fuellings: 1, mismatches: 1, mismatchOperators: 1 });
    expect(Object.fromEntries(t.roles)).toEqual({ Operator: 1, Driver: 1, "Not stated": 1 });
  });

  it("groups operators by the machine they mostly run", () => {
    expect(machineKind(data.operators[0])).toBe("Not in the register");
    expect(machineKind({ machines: [{ reference: "X", shifts: 0, name: "Pump" }, { reference: "EX-01", shifts: 2, name: "Excavator" }] })).toBe("Excavator");
    const kinds = new Map([["Excavator", 5], ["Tractor", 4], ["Truck", 3], ["Grader", 1], ["Roller", 1]]);
    expect(kindMix(kinds)).toEqual([{ label: "Excavator", n: 5 }, { label: "Tractor", n: 4 }, { label: "Truck", n: 3 }, { label: "Other", n: 2 }]);
  });

  it("names roles, departments and people plainly", () => {
    expect(roleKind("TRANSIT MIXER OPERATORS")).toBe("Operator");
    expect(roleKind("Tipper driver")).toBe("Driver");
    expect(operatorDepartments(data.operators).map((d) => d.label)).toEqual(["Irrigation", "Roads"]);
    expect(nameCase("EMMANUEL VICENT MTULO")).toBe("Emmanuel Vicent Mtulo");
    expect(initials("Emmanuel Vicent Mtulo")).toBe("EV");
    expect(hasOperators("kasulu")).toBe(true);
    expect(hasOperators("MENENGAI")).toBe(false);
  });
});

describe("onShiftNow", () => {
  const NOW = Date.parse("2026-11-19T09:00:00Z"); // 12:00 East Africa
  const l = (o) => ({ day: "2026-11-19", shiftStart: "08:00:00", plannedHours: 12, planStatus: "APPROVED", ...o });

  it("is on shift on an approved line whose shift covers now", () => {
    expect(shiftWindow(l())).toEqual({ from: Date.parse("2026-11-19T05:00:00Z"), to: Date.parse("2026-11-19T17:00:00Z") });
    expect(onShiftNow({ lines: [l({ shiftStart: "20:00:00" }), l()] }, NOW)).toBe(true);
  });

  it("is not before or after the shift, on a plan awaiting approval or cancelled, or without a start or hours", () => {
    expect(onShiftNow({ lines: [l({ shiftStart: "13:00:00" })] }, NOW)).toBe(false);
    expect(onShiftNow({ lines: [l({ shiftStart: "06:00:00", plannedHours: 4 })] }, NOW)).toBe(false);
    expect(onShiftNow({ lines: [l({ planStatus: "SUBMITTED" })] }, NOW)).toBe(false);
    expect(onShiftNow({ lines: [l({ planStatus: "CANCELLED" })] }, NOW)).toBe(false);
    expect(onShiftNow({ lines: [l({ shiftStart: null }), l({ plannedHours: null })] }, NOW)).toBe(false);
    expect(onShiftNow({}, NOW)).toBe(false);
  });
});
