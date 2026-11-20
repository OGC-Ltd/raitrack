// Figures for the Scorecard's Supervisors view (components/screens/
// SupervisorScorecard), over the records fleet-server reads off FactorySuite's
// work plans and each machine's telemetry (planner/factory-supervisors.ts).
// Each plan line puts a machine on a shift under a supervisor; the server says
// how the line went (`state`) and how many hours the machine ran in it.
//
// Pure: no React, no network.

import { daysBetween } from "./factoryFuel";

const DAY = 86_400_000;
/** A fleet day (EAT) as YYYY-MM-DD. */
const eatDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

/** The Scorecard's quick picks, as inclusive day ranges ending today. */
export function supervisorPeriods(now = Date.now()) {
  const today = eatDay(now);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.parse(`${today}T00:00:00Z`) - dow * DAY;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return [
    { key: "7d", label: "7 days", from: iso(Date.parse(`${today}T00:00:00Z`) - 6 * DAY), to: today },
    { key: "14d", label: "14 days", from: iso(Date.parse(`${today}T00:00:00Z`) - 13 * DAY), to: today },
    { key: "last", label: "Last week", from: iso(monday - 7 * DAY), to: iso(monday - DAY) },
    { key: "month", label: "This month", from: `${today.slice(0, 8)}01`, to: today },
  ];
}

/** How a line went, in words and as the grid's badge tone. */
export const LINE_STATE = {
  ran: { label: "Ran", tone: "active" },
  "not-run": { label: "Did not run", tone: "terminated" },
  silent: { label: "No signal", tone: "unknown" },
  untracked: { label: "Not tracked", tone: "unknown" },
  "no-hours": { label: "No hours planned", tone: "unknown" },
  open: { label: "Shift not over", tone: "suspended" },
};

/** "Shift 2 · 18:00"; "Shift 1"; "18:00"; "–". */
export function shiftLabel(shiftNo, shiftStart) {
  const at = shiftStart ? String(shiftStart).slice(0, 5) : null;
  if (shiftNo != null && at) return `Shift ${shiftNo} · ${at}`;
  if (shiftNo != null) return `Shift ${shiftNo}`;
  return at ?? "–";
}

/** The strip's figures over the supervisors on screen. */
export function supervisorTotals(rows) {
  const machines = new Set();
  const t = { supervisors: rows.length, lines: 0, plannedHours: 0, judged: 0, judgedPlannedHours: 0, runHours: 0,
    ran: 0, notRun: 0, lateStarts: 0, silent: 0, untracked: 0, open: 0 };
  const departments = new Set();
  for (const s of rows) {
    for (const d of s.departments ?? []) departments.add(d);
    for (const k of ["lines", "plannedHours", "judged", "judgedPlannedHours", "runHours", "ran", "notRun", "lateStarts", "silent", "untracked", "open"]) {
      t[k] += s[k] ?? 0;
    }
    for (const m of s.machines ?? []) machines.add(String(m.reference).toUpperCase());
  }
  t.machines = machines.size;
  t.departments = departments.size;
  t.operators = new Set(rows.flatMap((s) => (s.operators ?? []).map((o) => operatorName(o).toLowerCase()))).size;
  t.deliveredPct = t.judgedPlannedHours > 0 ? Math.round((100 * t.runHours) / t.judgedPlannedHours) : null;
  return t;
}

/**
 * Each day of the range, for the strip's charts: hours planned and run on the
 * lines that were judged, and how many supervisors had a line that day.
 */
export function supervisorsByDay(data, rows = null) {
  if (!data?.from || !data?.to) return [];
  const days = new Map(daysBetween(data.from, data.to).map((day) => [day, { day, planned: 0, run: 0, lines: 0, supervisors: 0 }]));
  for (const s of rows ?? data.supervisors ?? []) {
    const onDay = new Set();
    for (const l of s.history ?? []) {
      const d = days.get(l.day);
      if (!d) continue;
      d.lines += 1;
      onDay.add(l.day);
      if (l.state === "ran" || l.state === "not-run") {
        d.planned += l.plannedHours ?? 0;
        d.run += l.runHours ?? 0;
      }
    }
    for (const day of onDay) days.get(day).supervisors += 1;
  }
  return [...days.values()].map((d) => ({ ...d, run: Math.round(d.run * 10) / 10 }));
}

/** Departments on the supervisors' rows, biggest first. */
export function supervisorDepartments(rows) {
  const counts = new Map();
  for (const s of rows) for (const d of s.departments ?? []) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key ? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ") : "", count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** A supervisor's lines grouped by day, newest first, for the open row. */
export function linesByDay(history = []) {
  const days = new Map();
  for (const l of history) {
    const d = days.get(l.day) ?? { day: l.day, lines: [], plannedHours: 0, runHours: 0 };
    d.lines.push(l);
    d.plannedHours += l.plannedHours ?? 0;
    d.runHours += l.runHours ?? 0;
    days.set(l.day, d);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * A supervisor's lines by shift, and each shift by day (operator 2026-11-20:
 * "show their actual dates and hours done on each shift against the planned
 * hours"). Hours run are only known on a tracked line, so each shift and day
 * carries the planned hours of those lines (`judgedPlanned`) to set the run
 * against, beside all the hours planned. Shifts in the order of most lines,
 * days newest first.
 */
export function shiftsWithDays(history = []) {
  const shifts = new Map();
  const add = (t, l) => {
    t.lines += 1;
    t.plannedHours += l.plannedHours ?? 0;
    if (l.runHours != null) {
      t.judged += 1;
      t.judgedPlanned += l.plannedHours ?? 0;
      t.runHours += l.runHours;
    }
  };
  const blank = () => ({ lines: 0, plannedHours: 0, judged: 0, judgedPlanned: 0, runHours: 0 });
  for (const l of history) {
    const key = `${l.shiftNo ?? ""}@${l.shiftStart ?? ""}`;
    const s = shifts.get(key) ?? { key, shiftNo: l.shiftNo ?? null, shiftStart: l.shiftStart ?? null, days: new Map(), ...blank() };
    const d = s.days.get(l.day) ?? { day: l.day, ...blank() };
    add(s, l);
    add(d, l);
    s.days.set(l.day, d);
    shifts.set(key, s);
  }
  return [...shifts.values()]
    .map((s) => ({ ...s, days: [...s.days.values()].sort((a, b) => b.day.localeCompare(a.day)) }))
    .sort((a, b) => b.lines - a.lines || String(a.shiftStart).localeCompare(String(b.shiftStart)));
}

/** "Sarah Mbago" from "sarah mbago"; mixed case is left alone. */
export const nameCase = (name = "") =>
  String(name).replace(/[^\s'’-]+/g, (w) =>
    (/[a-z]/.test(w) && /[A-Z]/.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/** "EMMANUEL VICENT MTULO - EXCAVATOR OPERATOR" → "Emmanuel Vicent Mtulo". */
export const operatorName = (raw = "") => nameCase(String(raw).split(" - ")[0].trim());
