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
      share,
      tone: shiftTone(share),
    };
  });
}
