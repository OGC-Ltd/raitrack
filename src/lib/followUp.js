// Follow-up on the Driver Conduct Report (operator, 1 Nov 2026): which
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
// ## Kept on the server
//
// fleet-server reports/driver-conduct, since 2 Nov 2026 (api/driverConduct):
// the page works the cases out when it runs the report and sends them; the
// server folds them in and keeps what operators recorded. Before, each
// browser kept its own list, so the count beside Reports differed from
// machine to machine; loadCases reads what a browser still holds, once, to
// move it over (lib/conductMove).

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
/** The most cases the server lists (fleet-server driver-conduct MAX_CASES): a list this long may be cut short. */
export const SERVER_CASES_MAX = 10_000;
const DAY = 24 * 3600_000;

export const caseId = (unitKey, day) => `${unitKey}|${day}`;

/** "2 on phone, 1 camera covered, 5 harsh". */
export function incidentWords(c) {
  const parts = [];
  if (c.phone) parts.push(`${c.phone} on phone`);
  if (c.seatbelt) parts.push(`${c.seatbelt} no seatbelt`);
  if (c.covered) parts.push(`${c.covered} camera covered`);
  const harsh = (c.accel ?? 0) + (c.brake ?? 0) + (c.corner ?? 0);
  if (harsh) parts.push(`${harsh} harsh`);
  return parts.join(', ') || 'No incidents';
}

/** Does this vehicle-day call for follow-up? */
export function opensCase(r) {
  // Any cornering, seatbelt, phone or camera-covered incident opens a case immediately.
  const seen = (r.seatbelt ?? 0) + (r.phone ?? 0) + (r.covered ?? 0) + (r.corner ?? 0);
  if (seen > 0) return true;
  if (r.suspect) return false;
  // Acceleration and braking need 5 or more to open a case.
  return (r.accel ?? 0) + (r.brake ?? 0) >= CASE_HARSH_MIN;
}

/**
 * Is [a, b) inside the stretches the dashcam alarms were fully read over?
 * `read` is a list of [from, to) windows; null means every day is known (a
 * fleet with no dashcams, or a caller that read them all at once).
 */
export function camKnown(read, a, b) {
  if (read == null) return true;
  let reach = a;
  for (const [x, y] of [...read].sort((p, q) => p[0] - q[0])) {
    if (x > reach) break;
    if (y > reach) reach = y;
    if (reach >= b) return true;
  }
  return reach >= b;
}

const SEEN = ['seatbelt', 'phone', 'covered'];

/**
 * The cases a report run finds: one per vehicle per fleet day in the period
 * that opens one, worked out a day at a time. The records are sorted into
 * their days first, so each day reads only its own (a month of Sukari was 31
 * passes over every record, with every unit's dispatch runs, and froze the
 * page for 25 s, 25 Nov 2026).
 *
 * A day whose dashcam alarms were not all read (`dashcamRead`: before the
 * dashcam's reach, a day that timed out or came back incomplete) still opens
 * its cases from the harsh driving and what operators logged, which do not
 * depend on the dashcam; its no seatbelt, on phone and camera covered are
 * never lowered below the case the server holds (`stored`), since the server
 * takes a run's counts as they are. Where a case of such a day is not among
 * `stored` and the list may be cut short (`storedAll` false), it is left out.
 */
export function casesFromRun(units, harsh, alarms, { from, to, dashcams, logged, runs, dashcamRead = null, stored = null, storedAll = true }) {
  const days = daysCovering(from, to);
  if (!days.length) return [];
  const first = dayStart(days[0]);
  const slot = (t) => (Number.isFinite(t) && t >= from && t < to ? Math.floor((t - first) / DAY) : -1);
  const byDay = days.map(() => ({ harsh: [], alarms: [], logged: [] }));
  for (const e of harsh ?? []) { const i = slot(Date.parse(e?.ts)); if (byDay[i]) byDay[i].harsh.push(e); }
  for (const a of alarms ?? []) { const i = slot(a?.occurredMs); if (byDay[i]) byDay[i].alarms.push(a); }
  for (const e of logged ?? []) { const i = slot(e?.at); if (byDay[i]) byDay[i].logged.push(e); }
  const held = stored instanceof Map ? stored : new Map((stored ?? []).map((c) => [c.id, c]));

  const out = [];
  days.forEach((day, i) => {
    const a = Math.max(from, dayStart(day));
    const b = Math.min(to, dayStart(day) + DAY);
    if (b <= a) return;
    const known = !dashcams || camKnown(dashcamRead, a, b);
    const recs = byDay[i];
    const rows = known
      ? behaviourRows(units, recs.harsh, recs.alarms, { from: a, to: b, dashcams, logged: recs.logged, runs })
      // Unknown camera counts: what operators logged stands for them, as on a fleet with none
      : behaviourRows(units, recs.harsh, [], { from: a, to: b, dashcams: false, logged: recs.logged, runs });
    for (const r of rows) {
      const id = caseId(r.unit.key, day);
      const old = held.get(id);
      const seen = Object.fromEntries(SEEN.map((k) => [k, known ? r[k] : Math.max(r[k] ?? 0, old?.[k] ?? 0)]));
      if (!opensCase({ ...r, ...seen })) continue;
      if (!known && !old && !storedAll) continue;
      out.push({
        id,
        day,
        unitKey: r.unit.key,
        plate: r.unit.plate,
        group: r.unit.group ?? null,
        driver: r.driver ?? '',
        accel: r.accel, brake: r.brake, corner: r.corner, ...seen,
        openedAt: r.firstAt ?? old?.openedAt ?? a,
      });
    }
  });
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

const whoOf = (c) => (c.driver ? `d:${c.driver.toLowerCase()}` : `v:${c.unitKey}`);

/**
 * The ids of the cases whose driver (or, with none named, vehicle) has had
 * ESCALATE_CASES cases in ESCALATE_DAYS up to that one. Worked out once per
 * list: asked per row of the Follow-up table it was every case against every
 * case, a fifth of a second on each render of 1,000 (25 Nov 2026).
 */
export function escalations(all) {
  const by = new Map();
  for (const c of all ?? []) {
    const t = dayStart(c.day);
    if (!Number.isFinite(t)) continue;
    const k = whoOf(c);
    const l = by.get(k);
    if (l) l.push(t); else by.set(k, [t]);
  }
  for (const l of by.values()) l.sort((x, y) => x - y);
  // How many of a sorted list fall in [lo, hi)
  const lowest = (l, v) => { let lo = 0, hi = l.length; while (lo < hi) { const m = (lo + hi) >> 1; if (l[m] < v) lo = m + 1; else hi = m; } return lo; };
  const out = new Set();
  for (const c of all ?? []) {
    const l = by.get(whoOf(c));
    if (!l) continue;
    const end = dayStart(c.day) + DAY;
    if (lowest(l, end) - lowest(l, end - ESCALATE_DAYS * DAY) >= ESCALATE_CASES) out.add(c.id);
  }
  return out;
}

/** The driver (or, with none named, the vehicle) has had ESCALATE_CASES cases in ESCALATE_DAYS up to this one. */
export const needsEscalation = (c, all) => escalations(all).has(c.id);

/** One word for a vehicle over a period: its worst open case, or how it stands. */
export function statusWord(cases) {
  if (!cases?.length) return 'No case';
  // Overdue removed (operator, 9 Nov 2026): all open cases show as Pending regardless of age.
  if (cases.some((c) => c.status === 'pending')) return 'Pending';
  return 'Action taken';
}

/** The cases of a period, for the report and its PDF. */
export function periodCases(all, { from, to }) {
  const first = fleetDay(from);
  const last = fleetDay(to - 1);
  return all.filter((c) => c.day >= first && c.day <= last);
}

// ── what a browser held before the server ───────────────────────────────────

const keyFor = (orgId) => `ft-followup-cases:${orgId}`;

export function loadCases(orgId) {
  if (!orgId) return [];
  try {
    const list = JSON.parse(localStorage.getItem(keyFor(orgId)) ?? '[]');
    return Array.isArray(list) ? list.filter((c) => c && c.id && c.day) : [];
  } catch { return []; }
}

/** Saves a list in this browser. Only the tests and the move use it now. */
export function saveCases(orgId, list) {
  try { localStorage.setItem(keyFor(orgId), JSON.stringify(list)); return true; } catch { return false; }
}

/** Forgets this browser's list, once the server holds it. */
export function forgetCases(orgId) {
  try { localStorage.removeItem(keyFor(orgId)); } catch { /* nothing kept */ }
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
