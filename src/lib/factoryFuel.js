/**
 * The Fuel page's sums (operator 2026-11-14): FactorySuite's fuel module, as
 * fleet-server planner/factory-fuel returns it (plan lines with their request,
 * pump issues, the machines), added up per machine for the table and per day
 * for the strip. Pure, so the page and its tests read the same figures.
 *
 * "Need" is the register's rate times the plan (planned km ÷ km/L, or hours ×
 * L/h), FactorySuite's own sum; "requested" is what a line asked for when it
 * did not ask for a full tank; "issued" is what the pump put in.
 */

import { planStage } from "./workPlanMap";
import { vehicleReadings } from "./vehicleReadings";

/** A plate for matching: capitals, letters and digits only ("MUFINDI - EX 16" → "MUFINDIEX16"). */
const plateKey = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Each machine's tank right now, from its fuel probe (operator 2026-11-17:
 * the Maintenance page's "Fuel now" column, on the Fuel page too). From the
 * live fleet snapshot, read through vehicleReadings exactly as Maintenance
 * reads it, so the two pages never disagree on a figure.
 *
 * Matched on the register's `vehicleId` (the server's own link from machine to
 * tracked unit), else on the plate. A machine with no unit, no probe, or a
 * reading vehicleReadings rejects gets null: "-" on the page, never 0.
 */
export function withFuelNow(rows, vehicles) {
  const byId = new Map();
  const byPlate = new Map();
  for (const v of vehicles ?? []) {
    const r = vehicleReadings(v);
    if (v?.vehicleId) byId.set(String(v.vehicleId), r);
    const plate = plateKey(v?.id ?? v?.plate ?? v?.registrationPlate);
    if (plate) byPlate.set(plate, r);
  }
  return (rows ?? []).map((row) => {
    const live = (row.vehicleId && byId.get(String(row.vehicleId)))
      || (row.plate && byPlate.get(plateKey(row.plate)))
      || null;
    return {
      ...row,
      fuelNow: live?.fuelLitres ?? null,
      fuelNowPct: live?.fuelLitres != null ? live.fuelPct ?? null : null,
    };
  });
}

/** Every day from `from` to `to`, both inclusive. */
export function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const fold = (s) => String(s ?? "").trim().toUpperCase();
const add = (a, b) => (b == null ? a : (a ?? 0) + b);

/** An issue the pump flagged: one of its three checks failed, or it wrote a note. */
export const issueFlagged = (i) => (i.flags?.length ?? 0) > 0 || Boolean(i.note);

/**
 * One row per machine on the range's plans or at its pumps, with its
 * department and activity as on its latest plan line.
 */
export function fuelRoster(data) {
  if (!data?.lines) return [];
  const byRef = new Map();
  const row = (ref) => {
    const k = fold(ref);
    if (!byRef.has(k)) {
      const m = (data.machines ?? []).find((x) => fold(x.reference) === k) ?? {};
      byRef.set(k, {
        reference: m.reference ?? ref, name: m.name ?? null, category: m.category ?? null,
        status: m.status ?? null, downReason: m.downReason ?? null,
        basis: m.basis ?? null, rate: m.rate ?? null, tankLitres: m.tankLitres ?? null,
        vehicleId: m.vehicleId ?? null, plate: m.plate ?? null,
        department: null, activity: null, workLocation: null, lastDay: null,
        shifts: 0, approved: 0, pending: 0, fullTanks: 0, days: new Set(),
        requested: null, need: null, issued: 0, issues: 0, flagged: 0,
        lines: [], pumpIssues: [],
      });
    }
    return byRef.get(k);
  };
  for (const l of data.lines) {
    const r = row(l.machine);
    r.lines.push(l);
    r.shifts += 1;
    r.days.add(l.day);
    if (planStage(l.planStatus) === "PENDING") r.pending += 1; else r.approved += 1;
    if (l.fullTank) r.fullTanks += 1; else r.requested = add(r.requested, l.litresRequested);
    r.need = add(r.need, l.needLitres);
    if (!r.lastDay || l.day >= r.lastDay) {
      r.lastDay = l.day; r.department = l.department; r.activity = l.activity; r.workLocation = l.workLocation;
    }
  }
  for (const i of data.issues ?? []) {
    const r = row(i.machine);
    r.pumpIssues.push(i);
    r.issues += 1;
    r.issued += i.litres ?? 0;
    if (issueFlagged(i)) r.flagged += 1;
    if (!r.department) r.department = i.department ?? null;
    if (!r.lastDay || i.day > r.lastDay) r.lastDay = i.day;
  }
  return [...byRef.values()]
    .map((r) => ({ ...r, days: r.days.size, firstDay: r.lines.reduce((m, l) => (!m || l.day < m ? l.day : m), null) }))
    .sort((a, b) => String(a.department ?? "~").localeCompare(String(b.department ?? "~"))
      || a.reference.localeCompare(b.reference, undefined, { numeric: true }));
}

/** The range day by day: shifts planned, litres needed and requested, litres issued. */
export function fuelByDay(data, rows = null) {
  if (!data?.from || !data?.to) return [];
  const lines = rows ? rows.flatMap((r) => r.lines) : data.lines ?? [];
  const issues = rows ? rows.flatMap((r) => r.pumpIssues) : data.issues ?? [];
  const days = new Map(daysBetween(data.from, data.to).map((day) => [day, { day, shifts: 0, need: 0, requested: 0, issued: 0 }]));
  for (const l of lines) {
    const d = days.get(l.day);
    if (!d) continue;
    d.shifts += 1;
    d.need += l.needLitres ?? 0;
    d.requested += l.fullTank ? 0 : l.litresRequested ?? 0;
  }
  for (const i of issues) {
    const d = days.get(i.day);
    if (d) d.issued += i.litres ?? 0;
  }
  return [...days.values()];
}

/** The strip's figures over the rows on screen. */
export function fuelTotals(rows) {
  const t = {
    machines: rows.length, onPlans: 0, shifts: 0, approved: 0, pending: 0, fullTanks: 0,
    need: 0, requested: 0, issued: 0, issues: 0, broken: 0, requests: 0,
    flags: { "Off plan": 0, "Operator mismatch": 0, "Job mismatch": 0, note: 0 },
    flaggedMachines: { "Off plan": 0, "Operator mismatch": 0, "Job mismatch": 0, note: 0 },
    departments: new Set(),
  };
  for (const r of rows) {
    if (r.shifts) t.onPlans += 1;
    t.shifts += r.shifts; t.approved += r.approved; t.pending += r.pending; t.fullTanks += r.fullTanks;
    t.need += r.need ?? 0; t.requested += r.requested ?? 0; t.issued += r.issued; t.issues += r.issues;
    t.requests += r.lines.filter((l) => l.requestId).length;
    if (r.status) t.broken += 1;
    if (r.department) t.departments.add(r.department);
    const seen = new Set();
    for (const i of r.pumpIssues) {
      for (const f of i.flags ?? []) { t.flags[f] = (t.flags[f] ?? 0) + 1; seen.add(f); }
      if (i.note) { t.flags.note += 1; seen.add("note"); }
    }
    for (const f of seen) t.flaggedMachines[f] = (t.flaggedMachines[f] ?? 0) + 1;
  }
  return { ...t, departments: t.departments.size };
}

/** The department filter's options: each department with its machine count. */
export function departmentOptions(rows) {
  const counts = new Map();
  for (const r of rows) {
    const k = r.department ?? "";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key ? key.charAt(0) + key.slice(1).toLowerCase() : "No department", count }))
    .sort((a, b) => (a.key === "") - (b.key === "") || a.label.localeCompare(b.label));
}

/** The machine's state as the table's badge says it. */
export function machineState(r) {
  if (!r.status) return { label: "Available", tone: "active" };
  const words = r.status.charAt(0) + r.status.slice(1).toLowerCase().replace(/_/g, " ");
  return { label: words, tone: r.status === "BROKEN_DOWN" ? "terminated" : "suspended" };
}

/** The range that ends on the plans' day: tomorrow is planned today, so it is in. */
export function fuelRange(days, now = Date.now()) {
  const to = new Date(now + 3 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}
