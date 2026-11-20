// Who operates a unit now, by Mufindi's FactorySuite work plans (operator,
// 2026-11-19: units on shift show their drivers "as per the work plan" where
// the card says Unassigned). FactorySuite's driver register holds almost none
// of Mufindi's operators; the plan lines name them, up to three a shift.
//
// Pure. The same "on shift" as the map's work plans layer (workPlanMap lineNow).

import { lineNow, planStage, shiftText } from './workPlanMap';
import { nameCase } from './factorySupervisors';

/** Plans that do not put anyone to work: awaiting approval, or taken back. */
const OFF = /CANCEL|REJECT|WITHDRAW|SENT_BACK|RETURN|DECLIN/;

/**
 * "EMMANUEL VICENT MTULO - EXCAVATOR OPERATOR" → "Emmanuel Vicent Mtulo", and
 * "george heneriko" → "George Heneriko": cased like the Operators and
 * Supervisors pages (operator, 2026-11-20: "capitalized across all").
 */
export const operatorName = (s) => nameCase(String(s ?? '').split(/\s+-\s+/)[0].replace(/\s+/g, ' ').trim());

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

/** How long after a unit's last shift it keeps that shift's crew. */
const LAST_SHIFT_HOLD_MS = 12 * 3_600_000;

/**
 * The line on shift now; `anyone`: kept even when it names no operator (for
 * the shift itself). `between`: off shift, the next shift's line, or after the
 * day's last shift that one for LAST_SHIFT_HOLD_MS (operator, 2026-11-20: "we
 * cannot get the vehicle unassigned"); `when` says which.
 */
function crewOf(lines, now, { anyone = false, between = false } = {}) {
  if (!lines?.length) return null;
  const { line, onShift } = lineNow(lines, now);
  let when = 'now';
  if (!onShift) {
    if (!between || !line) return null;
    const from = Date.parse(line.shiftFrom);
    const to = Date.parse(line.shiftTo);
    if (from > now) when = 'next';
    else if (Number.isFinite(to) && now - to <= LAST_SHIFT_HOLD_MS) when = 'last';
    else return null;
  }
  const names = [...new Set([line.operator, line.secondOperator, line.thirdOperator].map(operatorName).filter(Boolean))];
  if (!names.length && !anyone) return null;
  return { names, shift: shiftText(line), activity: line.activity ?? null, workLocation: line.workLocation ?? null, planCode: line.planCode ?? null, when };
}

/** Yesterday in East Africa time (YYYY-MM-DD): its night shifts run into today. */
export const eatYesterday = (now = Date.now()) => new Date(now + 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);

/** A unit with no driver of its own (the tracker's). */
export const hasOwnDriver = (v) => Boolean(v?.driver && v.driver !== 'Unassigned');

/**
 * The live fleet with each unit's driver filled in from the work plan where it
 * has none and is on shift: `driver` as any driver reads (so search, cards and
 * lists show it alike), `driverSource: 'work-plan'`, and the shift in `planShift`.
 * Between shifts it is the next shift's crew (`planShift.when` 'next'), or the
 * last one's for 12 h after the day's last shift ('last'). Units keep their own driver. Returns the same
 * array when nothing changes.
 */
export function withPlanDrivers(vehicles, byVehicle, now = Date.now()) {
  if (!vehicles?.length || !byVehicle?.size) return vehicles;
  let changed = false;
  const out = vehicles.map((v) => {
    const crew = crewOf(byVehicle.get(v.vehicleId), now, { anyone: true, between: true });
    if (!crew) return v;
    changed = true;
    // A driver of its own stays, as does a line that names nobody; the shift is
    // still the unit's (the side panel's trip box shows it)
    if (hasOwnDriver(v) || !crew.names.length) return { ...v, planShift: crew };
    return { ...v, driver: crew.names.join(', '), driverSource: 'work-plan', planShift: crew };
  });
  return changed ? out : vehicles;
}
