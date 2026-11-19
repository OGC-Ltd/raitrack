// Who operates a unit now, by Mufindi's FactorySuite work plans (operator,
// 2026-11-19: units on shift show their drivers "as per the work plan" where
// the card says Unassigned). FactorySuite's driver register holds almost none
// of Mufindi's operators; the plan lines name them, up to three a shift.
//
// Pure. The same "on shift" as the map's work plans layer (workPlanMap lineNow).

import { lineNow, planStage, shiftText } from './workPlanMap';

/** Plans that do not put anyone to work: awaiting approval, or taken back. */
const OFF = /CANCEL|REJECT|WITHDRAW|SENT_BACK|RETURN|DECLIN/;

/** "EMMANUEL VICENT MTULO - EXCAVATOR OPERATOR" → EMMANUEL VICENT MTULO. */
export const operatorName = (s) => String(s ?? '').split(/\s+-\s+/)[0].replace(/\s+/g, ' ').trim();

/**
 * The unit's operators on its approved plan line covering `now`, or null when
 * it is on no such line (off shift, no plan, or the plan not approved).
 * @param {object|null} data  the server's work plans ({ plans: [{ status, planCode, lines }] })
 * @returns {{ names: string[], shift: string, activity: string|null, workLocation: string|null, planCode: string|null } | null}
 */
export function shiftOperators(data, vehicleId, now = Date.now()) {
  if (!vehicleId) return null;
  return crewOf(linesByVehicle(data).get(vehicleId), now);
}

/** The approved plans' lines, by our unit. */
export function linesByVehicle(data) {
  const out = new Map();
  for (const p of data?.plans ?? []) {
    if (planStage(p.status) === 'PENDING' || OFF.test(String(p.status ?? '').toUpperCase())) continue;
    for (const l of p.lines ?? []) {
      if (!l.vehicleId) continue;
      if (!out.has(l.vehicleId)) out.set(l.vehicleId, []);
      out.get(l.vehicleId).push({ ...l, planCode: p.planCode });
    }
  }
  return out;
}

function crewOf(lines, now) {
  if (!lines?.length) return null;
  const { line, onShift } = lineNow(lines, now);
  if (!onShift) return null;
  const names = [...new Set([line.operator, line.secondOperator, line.thirdOperator].map(operatorName).filter(Boolean))];
  if (!names.length) return null;
  return { names, shift: shiftText(line), activity: line.activity ?? null, workLocation: line.workLocation ?? null, planCode: line.planCode ?? null };
}

/** A unit with no driver of its own (the tracker's). */
export const hasOwnDriver = (v) => Boolean(v?.driver && v.driver !== 'Unassigned');

/**
 * The live fleet with each unit's driver filled in from the work plan where it
 * has none and is on shift: `driver` as any driver reads (so search, cards and
 * lists show it alike), `driverSource: 'work-plan'`, and the shift in `planShift`.
 * Units keep their own driver; nothing changes off shift. Returns the same
 * array when nothing changes.
 */
export function withPlanDrivers(vehicles, byVehicle, now = Date.now()) {
  if (!vehicles?.length || !byVehicle?.size) return vehicles;
  let changed = false;
  const out = vehicles.map((v) => {
    if (hasOwnDriver(v)) return v;
    const crew = crewOf(byVehicle.get(v.vehicleId), now);
    if (!crew) return v;
    changed = true;
    return { ...v, driver: crew.names.join(', '), driverSource: 'work-plan', planShift: crew };
  });
  return changed ? out : vehicles;
}
