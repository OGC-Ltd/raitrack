import { describe, it, expect } from "vitest";
import { kindMix, machineKind, operatorsByDay, operatorTotals, operatorDepartments, roleKind, hasOperators, nameCase, initials } from "./factoryOperators";

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
