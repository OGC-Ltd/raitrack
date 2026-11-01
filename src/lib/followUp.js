// Follow-up on the Driver Behaviour Report (operator, 1 Nov 2026): which
// vehicles need someone to act, and what was done.
//
// ## A case is one vehicle on one day
//
// Following up every alarm would bury the operators under hundreds of harsh
// events. A case gathers a vehicle's incidents for a fleet day, and opens when
// that day has any no-seatbelt, on-phone or camera-covered incident, or at
// least CASE_HARSH_MIN harsh events. A vehicle flagged "Check sensor" whose day
// is only harsh events opens none: that is the workshop's, not the driver's.
//
// ## Two states
//
//   pending        nobody has acted yet (overdue after OVERDUE_MS)
//   action taken   with what was done, a note, who and when
//
// A driver with ESCALATE_CASES or more cases in ESCALATE_DAYS is flagged for
// escalation: the phone call is not working.
//
// ## Kept in this browser, for now
//
// Like the operator log (lib/operatorLog): one list per organisation in this
// browser, until the database takes over. A case is written when the report
// is run for its day, so the list holds the days someone has reported on.

import { behaviourRows, fleetDay, dayStart, daysCovering } from './fleetReports';

export const ACTIONS = [
  'Driver called',
  'Verbal warning',
  'Written warning',
  'Supervisor informed',
  'Referred for training',
  'No action needed',
];

export const CASE_HARSH_MIN = 5;
export const ESCALATE_CASES = 3;
export const ESCALATE_DAYS = 7;
export const OVERDUE_MS = 24 * 3600_000;
const DAY = 24 * 3600_000;

export const caseId = (unitKey, day) => `${unitKey}|${day}`;

/** "2 on phone, 1 camera covered, 5 harsh". */
export function incidentWords(c) {
  const parts = [];
  if (c.phone) parts.push(`${c.phone} on phone`);
  if (c.seatbelt) parts.push(`${c.seatbelt} no seatbelt`);
  if (c.covered) parts.push(`${c.covered} camera covered`);
  const harsh = (c.accel ?? 0) + (c.brake ?? 0);
  if (harsh) parts.push(`${harsh} harsh`);
  return parts.join(', ') || 'No incidents';
}

/** Does this vehicle-day call for follow-up? */
export function opensCase(r) {
  const seen = (r.seatbelt ?? 0) + (r.phone ?? 0) + (r.covered ?? 0);
  if (seen > 0) return true;
  if (r.suspect) return false;
  return (r.accel ?? 0) + (r.brake ?? 0) >= CASE_HARSH_MIN;
}

/**
 * The cases a report run finds: one per vehicle per fleet day in the period
 * that opens one, worked out a day at a time from the same records.
 */
export function casesFromRun(units, harsh, alarms, { from, to, dashcams, logged }) {
  const out = [];
  for (const day of daysCovering(from, to)) {
    const a = Math.max(from, dayStart(day));
    const b = Math.min(to, dayStart(day) + DAY);
    if (b <= a) continue;
    for (const r of behaviourRows(units, harsh, alarms, { from: a, to: b, dashcams, logged })) {
      if (!opensCase(r)) continue;
      out.push({
        id: caseId(r.unit.key, day),
        day,
        unitKey: r.unit.key,
        plate: r.unit.plate,
        group: r.unit.group ?? null,
        driver: r.driver ?? '',
        accel: r.accel, brake: r.brake, seatbelt: r.seatbelt, phone: r.phone, covered: r.covered,
        openedAt: r.firstAt ?? a,
      });
    }
  }
  return out;
}

/**
 * The stored cases with a run's findings folded in: counts and driver are the
 * run's (it read the records), status and action stay what operators set.
 */
export function mergeCases(stored, found) {
  const byId = new Map(stored.map((c) => [c.id, c]));
  for (const f of found) {
    const old = byId.get(f.id);
    byId.set(f.id, old
      ? { ...old, ...f, status: old.status, action: old.action, note: old.note, by: old.by, actedAt: old.actedAt, openedAt: Math.min(old.openedAt ?? f.openedAt, f.openedAt) }
      : { ...f, status: 'pending', action: null, note: '', by: '', actedAt: null });
  }
  return [...byId.values()].sort((x, y) => x.openedAt - y.openedAt);
}

/** Record what was done; or, with action null, put the case back to pending. */
export function recordAction(list, id, { action, note = '', by = '', at = Date.now() }) {
  return list.map((c) => (c.id !== id ? c
    : action
      ? { ...c, status: 'done', action, note: String(note).slice(0, 1000), by, actedAt: at }
      : { ...c, status: 'pending', action: null, note: '', by: '', actedAt: null }));
}

export const isOverdue = (c, now = Date.now()) => c.status === 'pending' && now - c.openedAt > OVERDUE_MS;

/** The driver (or, with none named, the vehicle) has had ESCALATE_CASES cases in ESCALATE_DAYS up to this one. */
export function needsEscalation(c, all) {
  const who = c.driver ? `d:${c.driver.toLowerCase()}` : `v:${c.unitKey}`;
  const end = dayStart(c.day) + DAY;
  const n = all.filter((x) => (x.driver ? `d:${x.driver.toLowerCase()}` : `v:${x.unitKey}`) === who
    && dayStart(x.day) < end && dayStart(x.day) >= end - ESCALATE_DAYS * DAY).length;
  return n >= ESCALATE_CASES;
}

/** One word for a vehicle over a period: its worst open case, or how it stands. */
export function statusWord(cases, now = Date.now()) {
  if (!cases?.length) return 'No case';
  if (cases.some((c) => isOverdue(c, now))) return 'Overdue';
  if (cases.some((c) => c.status === 'pending')) return 'Pending';
  return 'Action taken';
}

/** The cases of a period, for the report and its PDF. */
export function periodCases(all, { from, to }) {
  const first = fleetDay(from);
  const last = fleetDay(to - 1);
  return all.filter((c) => c.day >= first && c.day <= last);
}

// ── storage ─────────────────────────────────────────────────────────────────

const keyFor = (orgId) => `ft-followup-cases:${orgId}`;
export const CHANGED = 'ft-followup-changed';

export function loadCases(orgId) {
  if (!orgId) return [];
  try {
    const list = JSON.parse(localStorage.getItem(keyFor(orgId)) ?? '[]');
    return Array.isArray(list) ? list.filter((c) => c && c.id && c.day) : [];
  } catch { return []; }
}

/** Saves, and tells the sidebar's count. False when the browser will not keep it. */
export function saveCases(orgId, list) {
  try {
    localStorage.setItem(keyFor(orgId), JSON.stringify(list));
    window.dispatchEvent(new Event(CHANGED));
    return true;
  } catch { return false; }
}

export function exportCases(list, orgCode) {
  return JSON.stringify({ kind: 'followup-cases', org: orgCode ?? null, exportedAt: new Date().toISOString(), cases: list }, null, 1);
}

/** Merge an exported file: a case held already keeps whichever record was acted on last. */
export function importCases(list, text) {
  const data = JSON.parse(text);
  const incoming = (Array.isArray(data) ? data : data?.cases ?? []).filter((c) => c && c.id && c.day);
  const byId = new Map(list.map((c) => [c.id, c]));
  let added = 0;
  for (const c of incoming) {
    const old = byId.get(c.id);
    if (!old) { byId.set(c.id, c); added += 1; continue; }
    if ((c.actedAt ?? 0) > (old.actedAt ?? 0)) byId.set(c.id, { ...old, ...c });
  }
  return { list: [...byId.values()].sort((x, y) => x.openedAt - y.openedAt), added };
}
