// Figures for the Drivers page's Operators tab (components/screens/OperatorsView),
// over the operators the server reads off FactorySuite's work plans
// (fleet-server planner/factory-operators.ts).

import { daysBetween } from "./factoryFuel";
import { planStage } from "./workPlanMap";

/** The org codes whose FactorySuite factory keeps work plans with operators. */
export const OPERATOR_ORGS = ["KASULU"];
export const hasOperators = (orgCode) => OPERATOR_ORGS.includes(String(orgCode ?? "").toUpperCase());

/** Each day of the range: shifts planned and how many operators were on them. */
export function operatorsByDay(data, rows = null) {
  if (!data?.from || !data?.to) return [];
  const days = new Map(daysBetween(data.from, data.to).map((day) => [day, { day, shifts: 0, operators: 0, hours: 0 }]));
  for (const o of rows ?? data.operators ?? []) {
    const onDay = new Set();
    for (const l of o.lines ?? []) {
      const d = days.get(l.day);
      if (!d) continue;
      d.shifts += 1;
      d.hours += l.plannedHours ?? 0;
      onDay.add(l.day);
    }
    for (const day of onDay) days.get(day).operators += 1;
  }
  return [...days.values()];
}

/** The strip's figures over the rows on screen. */
export function operatorTotals(rows) {
  const machines = new Set();
  const departments = new Set();
  const t = { operators: rows.length, onPlans: 0, shifts: 0, hours: 0, fuellings: 0, mismatches: 0, mismatchOperators: 0, pumpOnly: 0, roles: new Map(), kinds: new Map() };
  for (const o of rows) {
    if (o.shifts > 0) t.onPlans += 1; else t.pumpOnly += 1;
    t.shifts += o.shifts;
    t.hours += o.plannedHours ?? 0;
    t.fuellings += o.fuellings?.length ?? 0;
    t.mismatches += o.mismatches ?? 0;
    if (o.mismatches) t.mismatchOperators += 1;
    for (const m of o.machines ?? []) if (m.shifts > 0) machines.add(m.reference);
    for (const d of o.departments ?? []) departments.add(d);
    const kind = roleKind(o.role);
    t.roles.set(kind, (t.roles.get(kind) ?? 0) + 1);
    const mk = machineKind(o);
    t.kinds.set(mk, (t.kinds.get(mk) ?? 0) + 1);
  }
  t.machines = machines.size;
  t.departments = departments.size;
  return t;
}

/**
 * The kind of work a role names, for the strip's mix and the filter: the plan
 * writes "EXCAVATOR OPERATOR", "TIPPER DRIVER", "TRANSIT MIXER OPERATORS".
 */
export function roleKind(role) {
  const r = String(role ?? "").toLowerCase();
  if (!r) return "Not stated";
  if (/driver|tipper|truck|lorry/.test(r)) return "Driver";
  if (/operator|operater/.test(r)) return "Operator";
  return "Other";
}

/**
 * The machine an operator mostly runs, as the register names it ("Excavator",
 * "Tractor"): most plan lines write no role after the name, so this is what
 * says what kind of operator they are.
 */
export const machineKind = (o) => o.machines?.find((m) => m.shifts > 0)?.name || o.machines?.[0]?.name || "Not in the register";

/** The strip's mix: the three commonest machine kinds, the rest as "Other". */
export function kindMix(kinds, keep = 3) {
  const all = [...kinds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = all.slice(0, keep).map(([label, n]) => ({ label, n }));
  const rest = all.slice(keep).reduce((s, [, n]) => s + n, 0);
  return rest ? [...head, { label: "Other", n: rest }] : head;
}

/** Departments on the operators' rows, biggest first. */
export function operatorDepartments(rows) {
  const counts = new Map();
  for (const o of rows) for (const d of o.departments ?? []) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: sentence(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** "EXCAVATOR OPERATOR" → "Excavator operator". */
export const sentence = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : "");

/** "EMMANUEL VICENT MTULO" → "Emmanuel Vicent Mtulo"; mixed case is left alone. */
export const nameCase = (name = "") =>
  String(name).replace(/[^\s'’-]+/g, (w) =>
    (/[a-z]/.test(w) && /[A-Z]/.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export const initials = (name = "") =>
  String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

// ── On shift now (operator, 2026-11-19: "a filter … On Shift … the ones who are on shift at the moment") ──

/** Plans that put nobody to work: awaiting approval, or taken back. */
const OFF_PLAN = /CANCEL|REJECT|WITHDRAW|SENT_BACK|RETURN|DECLIN/;

/** A plan line's shift as times: its day's start time in East Africa, for its planned hours. Null without both. */
export function shiftWindow(line) {
  if (!line?.day || !line.shiftStart || !(line.plannedHours > 0)) return null;
  const from = Date.parse(`${line.day}T${line.shiftStart.slice(0, 5)}:00+03:00`);
  return Number.isFinite(from) ? { from, to: from + line.plannedHours * 3_600_000 } : null;
}

/** On an approved plan line whose shift covers `now`: the same "on shift" as the unit card and the map's layer. */
export function onShiftNow(operator, now = Date.now()) {
  return (operator?.lines ?? []).some((l) => {
    if (planStage(l.planStatus) === "PENDING" || OFF_PLAN.test(String(l.planStatus ?? "").toUpperCase())) return false;
    const w = shiftWindow(l);
    return Boolean(w) && w.from <= now && now < w.to;
  });
}
