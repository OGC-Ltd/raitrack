// Shift hours (Mufindi, operator 17 Nov 2026): for each machine on an
// approved work plan, the engine hours it has run since its shift began,
// against the hours of the shift so far. "Green if above 70% of the shift
// hours, amber above 50% and red below 50%."
//
// The shift comes from FactorySuite's plan line: its start (local wall clock)
// and its planned hours, so it ends at start + hours. While a shift is under
// way it is judged on the time elapsed so far, not the whole shift (operator's
// choice): at 10:00 in a 06:00-16:00 shift, 3.5 engine hours of 4 is 88%.
//
// Engine hours are the Machinery report's own (lib/fleetReports
// machineryRows): the hour meter, or the ignition where the meter sent
// nothing, over the shift's window. Pure: the page reads the plans and the
// readings and hands them in.

import { machineryRows } from './fleetReports';
import { planStage } from './workPlanMap';

const HOUR = 3_600_000;
/** At or above this share of the elapsed shift, a row is green; at or above AMBER, amber; else red. */
export const GREEN_SHARE = 0.7;
export const AMBER_SHARE = 0.5;

/** Under this many engine hours, litres per hour means nothing. */
const MIN_RATE_HOURS = 0.25;
/** Probe used against expected: green up to 110%, amber up to 125%, red over (Work Plan Fuel). */
export const FUEL_GREEN = 1.1;
export const FUEL_AMBER = 1.25;

/** The probe's litres against the expected as the row's tone. */
export function fuelTone(share) {
  if (share == null) return null;
  const pct = Math.round(share * 100);
  return pct <= FUEL_GREEN * 100 ? 'good' : pct <= FUEL_AMBER * 100 ? 'warn' : 'bad';
}

const fold = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A share of the shift as the row's tone. */
export function shiftTone(share) {
  if (share == null) return null;
  // On the whole percent shown: 69.6% reads 70% and is green
  const pct = Math.round(share * 100);
  return pct >= GREEN_SHARE * 100 ? 'good' : pct >= AMBER_SHARE * 100 ? 'warn' : 'bad';
}

/**
 * The day's shifts: one per approved plan line with a start and planned hours.
 *
 * @param {object} data  planner/factory-fuel for the day (lines, machines)
 * @param {number} now   ms
 * @returns {{ machine, name, plate, vehicleId, department, activity, shiftNo, day, start, end, plannedHours, upTo }[]}
 */
export function dayShifts(data, now = Date.now()) {
  const machines = new Map((data?.machines ?? []).map((m) => [fold(m.reference), m]));
  const out = [];
  for (const l of data?.lines ?? []) {
    if (planStage(l.planStatus) === 'PENDING') continue;
    if (!l.shiftStart || !(l.plannedHours > 0)) continue;
    const start = Date.parse(`${l.day}T${String(l.shiftStart).slice(0, 8).padEnd(8, ':00')}+03:00`);
    if (!Number.isFinite(start)) continue;
    const end = start + l.plannedHours * HOUR;
    const m = machines.get(fold(l.machine)) ?? {};
    out.push({
      key: `${l.machine}|${l.day}|${l.shiftNo ?? 1}|${l.lineId ?? ''}`,
      machine: m.reference ?? l.machine,
      name: m.name ?? null,
      category: m.category ?? null,
      plate: m.plate ?? null,
      vehicleId: m.vehicleId ?? null,
      department: l.department ?? null,
      activity: l.activity ?? null,
      shiftNo: l.shiftNo ?? 1,
      day: l.day,
      start,
      end,
      plannedHours: l.plannedHours,
      // Work Plan Fuel (Mufindi, 23 Nov 2026): the register's rate for the machine, and
      // what the pump issued against the line's fuel request; none while it has no request
      issuedL: l.requestId && Number.isFinite(l.issuedLitres) ? l.issuedLitres : null,
      requestId: l.requestId ?? null,
      // Planned: the fuel request's litres (a full tank's too), else the line's ask, else hours × rate
      plannedL: l.requestLitres ?? l.litresRequested ?? l.needLitres ?? null,
      operators: l.operators?.length ? l.operators : l.operator ? [l.operator] : [],
      supervisor: l.supervisor ?? null,
      workLocation: l.workLocation ?? null,
      fuelingLocation: l.fuelingLocation ?? null,
      basis: m.basis ?? null,
      rate: m.rate ?? null,
      // The shift judged so far: to now while it runs, to its end once it has ended
      upTo: Math.min(end, now),
    });
  }
  return out.sort((a, b) => a.start - b.start || a.machine.localeCompare(b.machine, undefined, { numeric: true }));
}

/** The tracked unit a shift's machine is: the register's vehicleId, else the plate. */
function unitFor(units, s) {
  if (s.vehicleId) {
    const u = units.find((x) => x.vehicles.some((v) => String(v.vehicleId) === String(s.vehicleId)));
    if (u) return u;
  }
  const p = fold(s.plate);
  if (!p) return null;
  return units.find((x) => fold(x.plate) === p || x.vehicles.some((v) => fold(v.regPlate) === p || fold(v.id) === p)) ?? null;
}

/**
 * A row a shift: its hours so far, the engine hours run in them, the share and the tone.
 *
 * @param {object[]} units   scopeUnits().units
 * @param {Map} pings        vehicleId → readings, sorted (api/fleetReports loadPings)
 * @param {object[]} shifts  dayShifts()
 * @param {Set} [failed]     vehicleIds whose readings could not be read
 */
export function shiftHoursRows(units, pings, shifts, failed = new Set()) {
  return shifts.map((s) => {
    const unit = unitFor(units, s);
    const started = s.upTo > s.start;
    const elapsed = started ? (s.upTo - s.start) / HOUR : 0;
    const unread = unit ? unit.vehicles.every((v) => failed.has(v.vehicleId)) : false;
    let hours = null;
    let hoursFrom = null;
    // Fuel used in the shift so far (operator, 17 Nov 2026), the Machinery report's own reading
    let usedL = null;
    let fuelSensor = false;
    if (unit && started && !unread) {
      const [row] = machineryRows([unit], pings, [{ from: s.start, to: s.upTo, day: s.day, hour: null }]).rows;
      hours = row?.hours ?? 0;
      hoursFrom = row?.hoursFrom ?? null;
      usedL = row?.fuelSeen ? row.usedL : null;
      fuelSensor = Boolean(row?.fuelSensor);
    }
    // Expected: the engine hours run × the register's litres per hour (Work Plan Fuel)
    const expectedL = hours != null && /^HOURS?$/i.test(s.basis ?? '') && s.rate > 0 ? hours * s.rate : null;
    // Work Plan Fuel: litres per engine hour as burned, and the probe against the expected
    const actualLph = usedL != null && hours != null && hours >= MIN_RATE_HOURS ? usedL / hours : null;
    const fuelShare = usedL != null && expectedL > 0 ? usedL / expectedL : null;
    const share = hours != null && elapsed > 0 ? Math.min(1, hours / elapsed) : null;
    return {
      key: s.key,
      // The report's tables read a row's unit: the tracked one, or the machine on its own
      unit: unit
        ? { ...unit, plate: s.machine, type: s.name ?? unit.type, group: null }
        : { key: s.key, plate: s.machine, type: s.name, group: null, vehicles: [] },
      shift: s,
      state: !unit ? 'untracked' : !started ? 'upcoming' : unread ? 'unread' : s.upTo >= s.end ? 'ended' : 'running',
      plannedHours: s.plannedHours,
      elapsed,
      hours,
      hoursFrom,
      usedL,
      fuelSensor,
      expectedL,
      issuedL: s.issuedL ?? null,
      plannedL: s.plannedL ?? null,
      // Issued less what the probe says was used; positive is fuel not accounted for by use
      diffL: s.issuedL != null && usedL != null ? s.issuedL - usedL : null,
      actualLph,
      ratedLph: /^HOURS?$/i.test(s.basis ?? '') && s.rate > 0 ? s.rate : null,
      fuelShare,
      fuelTone: fuelTone(fuelShare),
      share,
      tone: shiftTone(share),
    };
  });
}

// ── Work Plan Fuel: each pump issue (Mufindi, operator 23 Nov 2026) ─────────

/** A FactorySuite local wall-clock time ("2026-11-17T05:40:00") as ms. */
const localMs = (t) => {
  if (!t) return null;
  const x = String(t);
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(x) ? x : `${x.replace(' ', 'T')}+03:00`);
  return Number.isFinite(ms) ? ms : null;
};
/** Probe readings this long either side of a fuelling are read for its rise. */
const ISSUE_EDGE_MS = 30 * 60_000;
/** Fewer level readings than this either side, and the rise is not read. */
const MIN_SIDE = 2;
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
/**
 * The rise our probe saw over one fuelling: the tank level in the half hour
 * after it ended less the level in the half hour before it began, each the
 * median of the readings nearest the fuelling (up to five), so slosh does not
 * count. Null where either side has too few readings.
 */
export function probeRise(list, startedAt, endedAt) {
  const lv = list.filter((p) => Number.isFinite(p.fuelLevelMl));
  const before = lv.filter((p) => p.t < startedAt && p.t >= startedAt - ISSUE_EDGE_MS).slice(-5);
  const after = lv.filter((p) => p.t > endedAt && p.t <= endedAt + ISSUE_EDGE_MS).slice(0, 5);
  if (before.length < MIN_SIDE || after.length < MIN_SIDE) return null;
  return Math.max(0, (median(after.map((p) => p.fuelLevelMl)) - median(before.map((p) => p.fuelLevelMl))) / 1000);
}

/**
 * The pump issues for the report's machines: each with the shift it was for
 * (by its fuel request), and the rise our own probe saw over it.
 *
 * @param {object} data    planner/factory-fuel for the period (issues)
 * @param {object[]} rows  shiftHoursRows()
 * @param {Map} pings      vehicleId → readings, sorted
 * @returns {object[]} oldest first
 */
export function shiftIssueRows(data, rows, pings = new Map()) {
  const byRequest = new Map(rows.filter((r) => r.shift.requestId).map((r) => [r.shift.requestId, r]));
  const byMachine = new Map(rows.map((r) => [fold(r.shift.machine), r]));
  const out = [];
  for (const i of data?.issues ?? []) {
    const row = (i.requestId && byRequest.get(i.requestId)) || null;
    const any = row ?? byMachine.get(fold(i.machine));
    if (!any) continue;
    const startedAt = localMs(i.startedAt) ?? localMs(i.at);
    const at = localMs(i.at) ?? startedAt;
    let probeRiseL = null;
    const vs = any.unit.vehicles ?? [];
    if (startedAt != null && vs.length) {
      for (const v of vs) {
        const rise = probeRise(pings.get(v.vehicleId) ?? [], startedAt, at);
        if (rise != null) probeRiseL = Math.max(probeRiseL ?? 0, rise);
      }
    }
    out.push({
      key: i.id,
      machine: any.shift.machine,
      day: i.day,
      at,
      startedAt,
      siv: i.siv ?? null,
      pump: i.pump ?? null,
      litres: i.litres ?? null,
      done: i.done !== false,
      operator: i.operator ?? null,
      probeRiseL,
      sensor: i.sensor ?? null,
      flags: i.flags ?? [],
      shift: row?.shift ?? null,
    });
  }
  return out.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.machine.localeCompare(b.machine, undefined, { numeric: true }));
}

/** Each shift's probe refill: the rises our probe saw over the issues against its request. */
export function withProbeRefills(rows, issues) {
  const by = new Map();
  for (const i of issues) {
    if (!i.shift || i.probeRiseL == null) continue;
    by.set(i.shift.key, (by.get(i.shift.key) ?? 0) + i.probeRiseL);
  }
  return rows.map((r) => ({ ...r, probeRefillL: by.has(r.key) ? by.get(r.key) : null }));
}
