// The Reports page's four reports, as rows from the records the loaders read
// (api/fleetReports). Pure: no React, no network, so the test runs it.
//
//   Harsh acceleration  per unit, per hour of the day
//   Night driving       distance covered inside the night hours
//   Overspeeding        overspeeds lasting MORE than 5 seconds, unbroken,
//                       and the distance covered during them
//   Utilisation         distance, moving and engine time for every unit,
//                       including those that did not move
//
// Times are fleet time, Africa/Nairobi (UTC+3 all year, no daylight saving).

import { mapSliced } from './slices';
import { summariseDay, MOVING_KMH } from './vehicleDay';
import { unitKey } from './fleetGroups';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OFFSET = 3 * HOUR;

/** An overspeed must last longer than this to count (operator, 1 Nov 2026: continuous; 2 Nov 2026: 5 s, was 5 min). */
export const OVERSPEED_MIN_SEC = 5;
/** Night hours, by default 22:00 to 04:00. */
export const NIGHT = { start: 22, end: 4 };
/** Harsh accelerations per day above which the count reads as a sensor fault, not driving. */
export const HARSH_SUSPECT_PER_DAY = 100;
/** Telemetry is read a unit-day at a time, so the distance reports are kept short. */
export const MAX_DISTANCE_DAYS = 7;
export const MAX_EVENT_DAYS = 31;

// ── fleet time ──────────────────────────────────────────────────────────────

/** The fleet day "YYYY-MM-DD" a moment falls in. */
export const fleetDay = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
/** Fleet midnight of a day key, as epoch ms. */
export const dayStart = (key) => Date.parse(`${key}T00:00:00Z`) - OFFSET;
/** The hour of the day, 0–23, in fleet time. */
export const hourOf = (ms) => new Date(ms + OFFSET).getUTCHours();

/** Every fleet day touched by [from, to). */
export function daysCovering(from, to) {
  const out = [];
  for (let d = dayStart(fleetDay(from)); d < to; d += DAY) out.push(fleetDay(d));
  return out;
}

/** epoch ms → the value of an <input type="datetime-local">, in fleet time. */
export const toLocalInput = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 16);
/** The reverse: "2026-11-01T05:00" read as fleet time. */
export function fromLocalInput(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(s ?? ''));
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) - OFFSET : NaN;
}

/** "1 Nov 2026, 05:00". */
export function whenWords(ms) {
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const dayWords = (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' });
const hrs = (ms) => `${new Date(ms + OFFSET).toISOString().slice(11, 16)}hrs`;

/**
 * The period as a reader wants it (operator, 1 Nov 2026): the day once when
 * it is one day, "31 Oct 2026, 12:00hrs – 13:00hrs"; both days otherwise,
 * "31 Oct 2026, 19:00hrs – 1 Nov 2026, 05:00hrs". An end at midnight closes
 * the day it ends, so yesterday reads "31 Oct 2026, 00:00hrs – 24:00hrs".
 */
export function periodWords(from, to) {
  const endsAtMidnight = to > from && (to + OFFSET) % DAY === 0;
  const lastDay = endsAtMidnight ? to - 1 : to;
  if (fleetDay(from) === fleetDay(lastDay)) {
    return `${dayWords(from)}, ${hrs(from)} – ${endsAtMidnight ? '24:00hrs' : hrs(to)}`;
  }
  return `${dayWords(from)}, ${hrs(from)} – ${dayWords(to)}, ${hrs(to)}`;
}

/**
 * A period from days and hours, as Movements picks them (operator, 2 Nov: "let
 * it be like what we have in movements"): the first day at the start hour to the
 * last day at the end hour, past midnight when the end is at or before the
 * start, and up to now when it would run past it. The Shift report and Night
 * driving print what this gives, so it is what the operator picked.
 */
export function shiftPeriod(d, now = Date.now()) {
  // A custom range (operator, 3 Nov 2026): any start and end, to the minute; no end is up to now
  if (d.custom) {
    const end = d.custom.to ?? now;
    return { from: d.custom.from, to: Math.min(end, now), live: end >= now };
  }
  const from = dayStart(d.fromDay) + d.start * HOUR;
  const to = dayStart(d.toDay) + (d.end > d.start ? d.end : d.end + 24) * HOUR;
  return { from, to: Math.min(to, now), live: to >= now };
}

/**
 * The period presets. `lastNight` runs noon to noon, so that with the night
 * hours applied it is exactly last night.
 */
export function presetRange(id, now = Date.now()) {
  const today = dayStart(fleetDay(now));
  switch (id) {
    case 'today':     return { from: today, to: now };
    case 'yesterday': return { from: today - DAY, to: today };
    case 'lastNight': return { from: today - DAY + 12 * HOUR, to: today + 12 * HOUR };
    case 'week':      return { from: today - 6 * DAY, to: now };
    // The seven whole days before today (Mufindi's weekly overspeeding sheet)
    case 'lastWeek':  return { from: today - 7 * DAY, to: today };
    default:          return null;
  }
}

/** The night intervals inside [from, to), merged. */
export function nightWindows(from, to, night = NIGHT) {
  const out = [];
  const spanH = ((night.end - night.start + 24) % 24) || 24;
  for (let d = dayStart(fleetDay(from)) - DAY; d < to; d += DAY) {
    const a = Math.max(from, d + night.start * HOUR);
    const b = Math.min(to, d + night.start * HOUR + spanH * HOUR);
    if (b > a) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
  }
  return out;
}

/**
 * The hour columns of the harsh report: the hours of the period, in order,
 * when it is a day or less ("06 … 23, 00 … 05"); otherwise the 24 hours of
 * the day, each summed over the period.
 */
export function hourColumns(from, to) {
  if (to - from > DAY) return Array.from({ length: 24 }, (_, h) => h);
  const out = [];
  for (let t = from - ((from + OFFSET) % HOUR); t < to; t += HOUR) out.push(hourOf(t));
  return out;
}

export const hourLabel = (h) => String(h).padStart(2, '0');

// ── formatting ──────────────────────────────────────────────────────────────

export const km1 = (n) => (Number.isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-');
export const km2 = (n) => (Number.isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');

/** 125 → "2 h 05 min"; 40 → "40 min". */
export function minutesWords(min) {
  if (!Number.isFinite(min)) return '-';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

// ── shaping ─────────────────────────────────────────────────────────────────

/** For each unit, the value from the tracker with the largest `measure`. */
/** Plates A–Z, numbers in order: "KCA 9" before "KCA 10". */
export const byPlate = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true, sensitivity: 'base' });
/** Report rows A–Z by their unit's plate (operator, 2 Nov 2026: "organize the nodes in ascending order"). */
export const unitOrder = (a, b) => byPlate(a.unit?.plate, b.unit?.plate);

function bestPerUnit(units, perVehicle, measure) {
  const rows = [];
  for (const u of units) {
    let best = null;
    for (const v of u.vehicles) {
      const r = perVehicle.get(v.vehicleId);
      if (r && (!best || measure(r) > measure(best))) best = r;
    }
    rows.push({ unit: u, ...(best ?? {}) , trackers: u.vehicles.length });
  }
  return rows;
}

/** A unit for an item that names its vehicle by id, else by plate. */
function unitFinder(units) {
  const byId = new Map();
  const byPlate = new Map();
  const byKey = new Map();
  for (const u of units) {
    for (const v of u.vehicles) {
      byId.set(v.vehicleId, { u, v });
      if (v.id) byPlate.set(v.id, { u, v });
    }
    if (u.vehicles[0]) byKey.set(u.key, { u, v: u.vehicles[0] });
  }
  // By id, else the platform's own name for it, else the plate as typed ("KCA 224M").
  const key = (p) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (it) => byId.get(it?.vehicleId) ?? byPlate.get(it?.plate) ?? byKey.get(key(it?.plate)) ?? null;
}

/** Dashcam alarm codes (VSS, as the End of shift report reads them). */
export const PHONE_CODES = new Set([116, 264]);
export const SEATBELT_CODES = new Set([125, 51]);
export const COVER_CODES = new Set([123, 3]);
export const BEHAVIOUR_KINDS = ['accel', 'brake', 'corner', 'seatbelt', 'phone', 'covered'];
/** The kinds a dashcam reports, and an operator can log by hand. */
export const SEEN_KINDS = ['seatbelt', 'phone', 'covered'];
/** An operator entry and a camera alarm of one kind this close on one vehicle are one incident. */
export const SAME_INCIDENT_MS = 5 * 60_000;

const alarmKind = (code) => (PHONE_CODES.has(code) ? 'phone' : SEATBELT_CODES.has(code) ? 'seatbelt' : COVER_CODES.has(code) ? 'covered' : null);

/**
 * The Driver Conduct Report, was Driver Behaviour (operator, 1 Nov 2026): per unit, its harsh
 * accelerations and brakes (trackers), and its no-seatbelt, on-phone and
 * camera-covered incidents (dashcam alarms, and what operators logged by hand).
 *
 * @param harsh   tracker notifications { vehicleId, plate, ts, alertType }
 * @param alarms  dashcam incidents { vehicleId, plate, code, occurredMs }
 * @param o.logged    operator entries (lib/operatorLog) { id, kind, at, vehicleId, plate }
 * @param o.dashcams  false when the organisation has no dashcams at all
 * @returns rows, and `logged`: the entries in scope, each with `matched`
 *   (a camera alarm already counted it) and `counted`
 *
 * A truck's tracker and camera can be two platform units: each kind is taken
 * from whichever of the truck's units counted most of it, never added, so one
 * event reported twice is not counted twice. An operator entry within
 * SAME_INCIDENT_MS of an alarm of its kind on the same truck is that alarm.
 */
/**
 * The harsh cornering events of reports/movements/events (trackers and the
 * cameras' Harsh turn; the feed the conduct report reads leaves them out) in
 * the shape behaviourRows reads: { vehicleId, plate, ts, alertType }.
 */
export const cornerAsHarsh = (events) => (events ?? []).filter((e) => e?.kind === 'cornering' && Number.isFinite(e.at))
  .map((e) => ({ id: `turn-${e.vehicleId}-${e.at}`, vehicleId: e.vehicleId, plate: e.plate, ts: new Date(e.at).toISOString(), alertType: 'HARSH_CORNERING' }));

/**
 * The dispatch run that had a unit out at `t`, from the runs over the period
 * (api/fleetReports loadDispatchRuns): signed out at or before `t`, and not
 * signed back in by it. A run never signed back in lasts until the unit's next
 * run starts. Where two cover `t`, the later sign-out wins. Null when none
 * did: the unit was not out on a run.
 */
export function runAt(runs, t) {
  let hit = null;
  for (const s of spansOf(runs)) if (s.out <= t && t < s.back && (!hit || s.out > hit.out)) hit = s;
  return hit?.run ?? null;
}

/**
 * Each run's sign-out and end, worked out once per list: runAt is asked once
 * per incident, and a unit with a faulty sensor has thousands in a month.
 */
const spans = new WeakMap();
function spansOf(runs) {
  let out = spans.get(runs);
  if (out) return out;
  const outs = runs.map((r) => Date.parse(r.dispatchedAt));
  out = runs.map((run, i) => {
    let back = run.actualReturnAt ? Date.parse(run.actualReturnAt) : Infinity;
    if (!run.actualReturnAt) for (let j = i + 1; j < runs.length; j++) if (outs[j] > outs[i]) { back = outs[j]; break; }
    return { run, out: outs[i], back };
  });
  spans.set(runs, out);
  return out;
}

/**
 * A list of runs indexed once, by vehicle id and by plate, and each unit's
 * runs kept, so a month's report does not sift every run for every unit on
 * every day (Sukari, 25 Nov 2026: 634 units by 5,764 runs took 2.4 s a call,
 * 25 s for a month's follow-up cases, and froze the page).
 */
const runIndex = new WeakMap();
function indexOf(runs) {
  let ix = runIndex.get(runs);
  if (ix) return ix;
  const byId = new Map();
  const byKey = new Map();
  const add = (m, k, i) => { const l = m.get(k); if (l) l.push(i); else m.set(k, [i]); };
  runs.forEach((r, i) => {
    if (r.vehicleId) add(byId, r.vehicleId, i);
    if (r.plate) add(byKey, unitKey(r.plate), i);
  });
  ix = { byId, byKey, units: new Map() };
  runIndex.set(runs, ix);
  return ix;
}

/** A unit's runs, by vehicle id or by plate, in sign-out order; the same array each time for one list. */
function runsOfUnit(u, runs) {
  const ix = indexOf(runs);
  const kept = ix.units.get(u);
  if (kept) return kept;
  const at = new Set(ix.byKey.get(u.key) ?? []);
  for (const v of u.vehicles) for (const i of ix.byId.get(v.vehicleId) ?? []) at.add(i);
  const mine = [...at].sort((a, b) => a - b).map((i) => runs[i])
    .map((r) => [Date.parse(r.dispatchedAt), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  ix.units.set(u, mine);
  return mine;
}

/**
 * Who was driving a unit at each of its incidents, named once each, the one
 * with the most incidents first (operator, 16 Nov 2026: the report named
 * whoever had the vehicle when it was RUN, so last Tuesday's braking went to
 * today's driver).
 *
 * `runs`: every dispatch run over the period (loadDispatchRuns). `null`: the
 * server could not give them, so only the run open now is known, from the
 * fleet list (`vehicle.trip`), and it names the driver only for incidents
 * after it set off; earlier ones have no driver. `undefined`: the caller asked
 * for neither, and the driver is the one the fleet list holds now, as before.
 */
export function driversAt(u, times, runs) {
  if (runs === undefined) return u.vehicles.map((v) => (v.driver && v.driver !== 'Unassigned' ? v.driver : null)).find(Boolean) ?? null;
  if (!times.length) return null;
  const mine = runs ? runsOfUnit(u, runs) : null;
  const count = new Map();
  for (const t of times) {
    let name = null;
    if (mine) name = runAt(mine, t)?.driverName ?? null;
    else {
      const trip = u.vehicles.map((v) => v.trip).find((x) => x?.driverName && Date.parse(x.departedAt) <= t);
      name = trip?.driverName ?? null;
    }
    name = String(name ?? '').trim();
    if (name) count.set(name, (count.get(name) ?? 0) + 1);
  }
  const names = [...count].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  return names.length ? names.join(', ') : null;
}

export function behaviourRows(units, harsh, alarms, { from, to, dashcams = true, logged = [], runs }) {
  const find = unitFinder(units);
  const perVehicle = new Map();
  const alarmTimes = new Map();   // unit key → kind → [ms]
  const firstAt = new Map();   // unit key → earliest incident in the period
  const times = new Map();   // unit key → when each incident happened, for the driver at the time
  const seenAt = (k, t) => {
    if (Number.isFinite(t) && !(firstAt.get(k) <= t)) firstAt.set(k, t);
    if (!Number.isFinite(t)) return;
    const list = times.get(k);
    if (list) list.push(t); else times.set(k, [t]);
  };
  // vehicleId → kind → fleet day → n: the same counts a day at a time, for the
  // Driver conduct trend cards (25 Nov 2026)
  const perVehicleDay = new Map();
  const tally = (byKind, kind, t) => {
    const days = byKind.get(kind) ?? new Map();
    byKind.set(kind, days);
    const d = fleetDay(t);
    days.set(d, (days.get(d) ?? 0) + 1);
  };
  const bump = (it, kind, t, alarm = false) => {
    const hit = find(it);
    if (!hit) return;
    let r = perVehicle.get(hit.v.vehicleId);
    if (!r) perVehicle.set(hit.v.vehicleId, (r = { accel: 0, brake: 0, corner: 0, seatbelt: 0, phone: 0, covered: 0 }));
    r[kind] += 1;
    const vd = perVehicleDay.get(hit.v.vehicleId) ?? new Map();
    perVehicleDay.set(hit.v.vehicleId, vd);
    tally(vd, kind, t);
    seenAt(hit.u.key, t);
    if (alarm) {
      const byKind = alarmTimes.get(hit.u.key) ?? new Map();
      alarmTimes.set(hit.u.key, byKind);
      const list = byKind.get(kind);
      if (list) list.push(t); else byKind.set(kind, [t]);
    }
  };
  for (const e of harsh ?? []) {
    const t = Date.parse(e?.ts);
    if (!Number.isFinite(t) || t < from || t >= to) continue;
    if (e.alertType === 'HARSH_ACCELERATION') bump(e, 'accel', t);
    else if (e.alertType === 'HARSH_BRAKING') bump(e, 'brake', t);
    // Harsh cornering (operator, 5 Nov 2026), read as the Movements report reads it (cornerAsHarsh)
    else if (e.alertType === 'HARSH_CORNERING') bump(e, 'corner', t);
  }
  for (const a of alarms ?? []) {
    const t = a?.occurredMs;
    const kind = alarmKind(a?.code);
    if (!kind || !Number.isFinite(t) || t < from || t >= to) continue;
    bump(a, kind, t, true);
  }

  // Operator entries: in the period, on a unit in scope.
  const manual = new Map();   // unit key → { kind: n }
  const manualDays = new Map();   // unit key → kind → fleet day → n
  const inScope = [];
  for (const e of logged ?? []) {
    if (!(e.at >= from && e.at < to)) continue;
    const hit = find(e);
    if (!hit) continue;
    const near = SEEN_KINDS.includes(e.kind)
      && dashcams && hit.u.dashcam !== false
      && (alarmTimes.get(hit.u.key)?.get(e.kind) ?? []).some((t) => Math.abs(t - e.at) <= SAME_INCIDENT_MS);
    const counted = SEEN_KINDS.includes(e.kind) && !near;
    if (counted) {
      seenAt(hit.u.key, e.at);
      const m = manual.get(hit.u.key) ?? {};
      m[e.kind] = (m[e.kind] ?? 0) + 1;
      manual.set(hit.u.key, m);
      const md = manualDays.get(hit.u.key) ?? new Map();
      manualDays.set(hit.u.key, md);
      tally(md, e.kind, e.at);
    }
    inScope.push({ ...e, unit: hit.u, matched: near, counted });
  }

  const days = Math.max(1, (to - from) / DAY);
  const loggedOn = new Set(inScope.map((e) => e.unit.key));
  const rows = [];
  for (const u of units) {
    const auto = { accel: 0, brake: 0, corner: 0, seatbelt: 0, phone: 0, covered: 0 };
    const autoFrom = {};   // kind → the vehicle whose count the unit takes
    for (const v of u.vehicles) {
      const c = perVehicle.get(v.vehicleId);
      if (c) for (const k of BEHAVIOUR_KINDS) if (c[k] > auto[k]) { auto[k] = c[k]; autoFrom[k] = v.vehicleId; }
    }
    const m = manual.get(u.key) ?? {};
    // No dashcam (from the client's list, or none in the whole fleet): its own
    // seatbelt, phone and cover counts cannot exist, so the columns say "–" —
    // unless an operator saw one, which counts whatever the unit carries.
    const dashcam = dashcams && u.dashcam !== false;
    const r = { unit: u, dashcam, accel: auto.accel, brake: auto.brake, corner: auto.corner, manual: m, logged: 0 };
    for (const k of SEEN_KINDS) {
      r[k] = (dashcam ? auto[k] : 0) + (m[k] ?? 0);
      r.logged += m[k] ?? 0;
    }
    r.total = r.accel + r.brake + r.corner + r.seatbelt + r.phone + r.covered;
    // The same counts by fleet day, { day: { harsh, dashcam } }: they add up to the row's own
    r.days = {};
    const addDays = (days, group) => {
      for (const [d, k] of days ?? []) {
        const at = (r.days[d] ??= { harsh: 0, dashcam: 0 });
        at[group] += k;
      }
    };
    for (const k of BEHAVIOUR_KINDS) {
      const group = SEEN_KINDS.includes(k) ? 'dashcam' : 'harsh';
      if (group === 'harsh' || dashcam) addDays(perVehicleDay.get(autoFrom[k])?.get(k), group);
      if (group === 'dashcam') addDays(manualDays.get(u.key)?.get(k), group);
    }
    r.suspect = r.accel / days > HARSH_SUSPECT_PER_DAY || r.brake / days > HARSH_SUSPECT_PER_DAY;
    // The driver AT THE TIME of its incidents, not the one on the unit now
    r.driver = driversAt(u, times.get(u.key) ?? [], runs);
    r.firstAt = firstAt.get(u.key) ?? null;
    if (r.total > 0 || loggedOn.has(u.key)) rows.push(r);
  }
  rows.sort(unitOrder);
  return Object.assign(rows, { logged: inScope.sort((a, b) => a.at - b.at) });
}

/**
 * Overspeeds over OVERSPEED_MIN_SEC, per unit.
 * @param episodesByVehicle Map vehicleId → speeding incidents
 *   { startedAt, durationSec, distanceM, peakKmh, limitKmh, driverName }
 */
export function overspeedRows(units, episodesByVehicle, minSec = OVERSPEED_MIN_SEC) {
  const perVehicle = new Map();
  for (const [vehicleId, list] of episodesByVehicle) {
    const long = (list ?? []).filter((e) => Number(e?.durationSec) > minSec);
    if (!long.length) continue;
    const peak = long.reduce((m, e) => (Number(e.peakKmh) > (m?.peakKmh ?? -1) ? e : m), null);
    const num = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
    perVehicle.set(vehicleId, {
      count: long.length,
      seconds: long.reduce((s, e) => s + Number(e.durationSec || 0), 0),
      km: long.reduce((s, e) => s + (Number(e.distanceM) || 0), 0) / 1000,
      kmKnown: long.every((e) => Number.isFinite(Number(e.distanceM)) && e.distanceM != null),
      peakKmh: peak ? Number(peak.peakKmh) : null,
      limitKmh: peak ? Number(peak.limitKmh) : null,
      longestSec: Math.max(...long.map((e) => Number(e.durationSec) || 0)),
      driver: long.find((e) => e.driverName)?.driverName ?? null,
      // The overspeed with the top speed, to find the reading it peaked on
      peak: peak ? {
        vehicleId, startedAt: Date.parse(peak.startedAt), endedAt: Date.parse(peak.endedAt),
        peakKmh: num(peak.peakKmh), lat: num(peak.peakLat), lng: num(peak.peakLng),
      } : null,
      peakAt: null,
    });
  }
  return bestPerUnit(units, perVehicle, (r) => r.count)
    .filter((r) => r.count > 0)
    .sort(unitOrder);
}

/**
 * One unit's overspeeds one by one, oldest first: the report made for one unit
 * lists each (operator, 2 Nov 2026). `lists` are its trackers' episodes; the
 * same OVERSPEED_MIN_SEC as the totals, so the list and the totals agree.
 */
export function overspeedEvents(lists, minSec = OVERSPEED_MIN_SEC) {
  const num = (x) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
  return lists.flat()
    .filter((e) => Number(e?.durationSec) > minSec)
    .map((e) => ({
      vehicleId: e.vehicleId ?? null,
      startedAt: Date.parse(e.startedAt),
      endedAt: Date.parse(e.endedAt),
      durationSec: Number(e.durationSec),
      peakKmh: num(e.peakKmh),
      avgKmh: num(e.avgKmh),
      limitKmh: num(e.limitKmh),
      km: num(e.distanceM) == null ? null : Number(e.distanceM) / 1000,
      driver: e.driverName || null,
      lat: num(e.peakLat),
      lng: num(e.peakLng),
      peakAt: null,
    }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * The reading an overspeed peaked on (Mufindi, 10 Nov 2026: "the date and
 * exact time of the highest peak speed ... traceable to the specific
 * overspeeding event"). The episode keeps where it peaked but not when, so
 * this is the fastest reading inside it; equal speeds go to the one nearest
 * the recorded peak, then the earliest. `pings` are the tracker's readings
 * ({t, speedKmh, lat, lng}); null when none falls inside the overspeed.
 */
export function peakFix(pings, ep, slackMs = 1000) {
  if (!ep || !Number.isFinite(ep.startedAt) || !Number.isFinite(ep.endedAt)) return null;
  const away = (p) => (ep.lat == null || ep.lng == null || p.lat == null || p.lng == null ? 0
    : (p.lat - ep.lat) ** 2 + (p.lng - ep.lng) ** 2);
  let best = null;
  for (const p of pings ?? []) {
    if (!(p.t >= ep.startedAt - slackMs && p.t <= ep.endedAt + slackMs) || !Number.isFinite(p.speedKmh)) continue;
    if (!best || p.speedKmh > best.speedKmh
      || (p.speedKmh === best.speedKmh && (away(p) < away(best) || (away(p) === away(best) && p.t < best.t)))) best = p;
  }
  return best ? { at: best.t, kmh: best.speedKmh } : null;
}

/**
 * Distance and time inside `windows`, from one unit's readings: each window
 * is summarised on its own (the vehicle panel's own sums, lib/vehicleDay),
 * then added up, so the gap between two nights is never counted.
 */
export function summariseWindows(pings, windows) {
  // usedL: litres the engine used, from the fuel counter or the tank level
  // (lib/vehicleDay). fuelSensor: the unit reports fuel at all; fuelSeen: a
  // figure could be worked out (too few readings, or a level that ends higher
  // than it started with no refill, gives none).
  // firstMovingAt / latestMovingAt: the first and last reading at walking pace
  // or faster, for the night report's "Moving between". nights: how many
  // windows the period has (several: the times need their date);
  // movingNights: in how many of them the unit moved.
  const out = {
    km: 0, movingMin: 0, engineOnMin: 0, idleMin: 0, usedL: 0, fuelSeen: false, fuelSensor: false, readings: 0,
    firstMovingAt: null, latestMovingAt: null, nights: windows.length, movingNights: 0,
  };
  for (const [a, b] of windows) {
    const sub = pings.filter((p) => p.t >= a && p.t < b);
    out.readings += sub.length;
    if (!out.fuelSensor && sub.some((p) => Number.isFinite(p.fuelLevelMl) || Number.isFinite(p.fuelUsedMl))) out.fuelSensor = true;
    // One reading is no movement (a lone speed spike): the same rule as the sums below
    if (sub.length < 2) continue;
    const moving = sub.filter((p) => (p.speedKmh ?? 0) >= MOVING_KMH);
    if (moving.length) {
      out.movingNights += 1;
      const first = moving[0].t;
      const last = moving[moving.length - 1].t;
      if (out.firstMovingAt == null || first < out.firstMovingAt) out.firstMovingAt = first;
      if (out.latestMovingAt == null || last > out.latestMovingAt) out.latestMovingAt = last;
    }
    const s = summariseDay(sub, null);
    out.km += s.distanceKm ?? 0;
    out.movingMin += s.movingMin ?? 0;
    out.engineOnMin += s.engineOnMin ?? 0;
    out.idleMin += s.idleMin ?? 0;
    if (s.usedL != null) { out.usedL += Math.max(0, s.usedL); out.fuelSeen = true; }
  }
  return out;
}

/** Units that covered ground at night, A–Z by plate. */
export function nightRows(units, perVehicle, { minKm = 0.5 } = {}) {
  return bestPerUnit(units, perVehicle, (r) => r.km)
    .filter((r) => (r.km ?? 0) >= minKm)
    .sort(unitOrder);
}

/** Every unit, the stationary ones included (they are the point). */
export function utilisationRows(units, perVehicle, { rated = false } = {}) {
  return bestPerUnit(units, perVehicle, (r) => r.km)
    .map((r) => {
      const row = { ...r, km: r.km ?? 0, engineOnMin: r.engineOnMin ?? 0, noData: !r.readings };
      return rated ? { ...row, ...burnAgainstRegister(row, ratedOf(r.unit)) } : row;
    })
    .sort(unitOrder);
}

// ── Burn against the register (Mufindi, operator 1 Nov 2026) ───────────────
//
// The machine register (KASULU = Mufindi Paper Mills, the only organisation
// with one) rates each unit on its own basis: L/h for machines (HOURS), km/L
// for vehicles (DISTANCE), turned round here to L/km. The Vehicle Utilization
// Report shows each unit's use in that unit and against that standard.

/** The sections a rated report is split into, in order. */
export const RATED_SECTIONS = ['Machines (L/h)', 'Vehicles (L/km)', 'No standard on the register'];
/** Below these a rate means nothing: a machine idling a few minutes, a vehicle moved across the yard. */
export const RATE_MIN_HOURS = 1;
export const RATE_MIN_KM = 10;
/** Over the standard by more than this is flagged (the vehicle panel's own threshold). */
export const OVER_STANDARD = 0.15;

/** A unit's register rating, from whichever of its trackers carries it. */
function ratedOf(unit) {
  for (const v of unit?.vehicles ?? []) if (v.ratedBurn?.value > 0 && v.ratedBurn.basis) return v.ratedBurn;
  return null;
}

/**
 * basis: 'HOURS' | 'DISTANCE' | null; std and actual in L/h or L/km;
 * over: actual against std as a share (0.12 = 12% more fuel); section: which
 * table it goes in.
 */
export function burnAgainstRegister(r, rated) {
  if (!rated) return { basis: null, std: null, actual: null, over: null, section: RATED_SECTIONS[2] };
  const hours = rated.basis === 'HOURS';
  const std = hours ? rated.value : 1 / rated.value;
  const base = hours ? r.engineOnMin / 60 : r.km;
  const enough = base >= (hours ? RATE_MIN_HOURS : RATE_MIN_KM);
  // A machine that ran 2 hours or more with the tank hardly moving: the sensor, not the machine.
  const suspect = hours ? r.fuelSeen && base >= 2 && r.usedL < 0.5 * base : r.fuelSeen && r.km >= 50 && r.usedL < 0.02 * r.km;
  const actual = enough && r.fuelSeen && r.usedL > 0 && !suspect ? r.usedL / base : null;
  return {
    basis: hours ? 'HOURS' : 'DISTANCE',
    std,
    actual,
    over: actual == null ? null : actual / std - 1,
    fuelSuspectRated: suspect,
    section: RATED_SECTIONS[hours ? 0 : 1],
  };
}

/**
 * Rows by group, in the list's order, each with its own total of `sum`.
 * One section with a null name when the organisation has no groups.
 */
export function sections(rows, groupOrder, sum = () => 0) {
  const by = new Map();
  for (const r of rows) {
    const g = r.section ?? r.unit.group ?? null;
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(r);
  }
  const names = groupOrder?.length ? groupOrder.filter((n) => by.has(n)) : [...by.keys()];
  return names.map((name) => ({ name, rows: by.get(name), total: by.get(name).reduce((s, r) => s + (sum(r) || 0), 0) }));
}

// ── Machinery (Mufindi, operator 16 Nov 2026) ───────────────────────────────
//
// Excavators and dozers, one row per machine per day: engine hours and fuel
// used, read live from the day's readings so the report is current to the
// hour. Area worked was taken out (operator, 16 Nov 2026): the server draws it
// overnight, so it held the report to whole days that had ended.

/** Excavator or dozer: the plate contains "EX " or "DZ ", the server's own test for the two. */
export function machineKind(unit) {
  const names = [unit?.plate, ...(unit?.vehicles ?? []).flatMap((v) => [v.regPlate, v.id, v.name])];
  for (const s of names) {
    const t = String(s ?? '').toUpperCase();
    if (t.includes('EX ')) return 'Excavators';
    if (t.includes('DZ ')) return 'Dozers';
  }
  return null;
}
/** The sections of the Machinery report, in order. */
export const MACHINE_SECTIONS = ['Excavators', 'Dozers'];

/** The hour meter may run a little past the window's own length (readings either side of an edge); past this it is a reset or a bad reading. */
const METER_SLACK_H = 0.25;
/** A reading further back than this before the window does not speak for its start. */
const EDGE_GAP_MS = 15 * 60_000;

/**
 * Engine hours over a window: the machine's own hour meter where it ticked
 * (the most trusted source: 0 s error against the ignition sums, fleet-server
 * schema), else the time the readings say the engine was on.
 *
 * `s` is summariseDay of the window's readings; `meterH` the meter's own
 * advance over the window (meterAdvance), and `maxH` the window's length.
 */
export function engineHoursOf(s, meterH = s?.engineHoursToday, maxH = 24) {
  if (Number.isFinite(meterH) && meterH > 0 && meterH <= maxH + METER_SLACK_H) return { hours: Math.min(meterH, maxH), from: 'meter' };
  if (Number.isFinite(s?.engineOnMin)) return { hours: s.engineOnMin / 60, from: 'ignition' };
  return { hours: 0, from: null };
}

/**
 * How far the hour meter moved over a window, counted from the last reading
 * before it where there is one close by. An hour's readings alone would lose
 * the minutes between the hour's edge and its first reading; measured from the
 * reading before, the hours of a day add up to the day.
 */
export function meterAdvance(before, sub) {
  const pts = [...(before ? [before] : []), ...sub].filter((p) => Number.isFinite(p.engineHoursMeter));
  if (pts.length < 2) return null;
  const d = pts[pts.length - 1].engineHoursMeter - pts[0].engineHoursMeter;
  return d >= 0 ? d : null;
}

/** The fleet days of [from, to), each cut to the period. */
export function dayWindows(from, to) {
  return daysCovering(from, to).map((day) => {
    const a = dayStart(day);
    return { day, from: Math.max(from, a), to: Math.min(to, a + DAY) };
  });
}

/** The clock hours of [from, to), each cut to the period (operator, 16 Nov 2026: "an hourly report"). */
export function hourWindows(from, to) {
  const out = [];
  // Nairobi is a whole number of hours from UTC, so its hours start on UTC's
  for (let h = Math.floor(from / HOUR) * HOUR; h < to; h += HOUR) {
    out.push({ day: fleetDay(h), hour: hourOf(h), from: Math.max(from, h), to: Math.min(to, h + HOUR) });
  }
  return out;
}

/**
 * The rows' windows for a period and the hours picked on each day of it
 * (operator, 16 Nov 2026: "from which hour to which hour", then "custom
 * hours"), to the minute: 06:30 to 14:15 over three days is that stretch on
 * each of the three, not one run from the first morning to the last
 * afternoon. `end` past `start` is a day shift; at or before it, the hours run
 * overnight (19:30 to 07:30), and a night counts on the day it starts. 0 to
 * 24 is the whole day.
 *
 * By day: a window per day, cut to its hours. By hour: those windows cut at
 * each clock hour, so 06:30 to 08:00 is 06:30–07:00 and 07:00–08:00.
 */
export function machineWindows(from, to, { start = 0, end = 24, byDay = false } = {}) {
  const len = (end > start ? end : end + 24) - start;
  const shifts = [];
  // From the day before: last night's hours may reach into the period's morning
  for (const day of daysCovering(from - DAY, to)) {
    const a = dayStart(day) + start * HOUR;
    const x = Math.max(from, a);
    const y = Math.min(to, a + len * HOUR);
    if (y > x) shifts.push({ day, from: x, to: y });
  }
  return byDay ? shifts : shifts.flatMap((w) => hourWindows(w.from, w.to));
}

const round1 = (x) => Math.round(x * 10) / 10;

/** The index of the first reading at or after `t` in a list sorted by time. */
function firstFrom(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m].t < t) lo = m + 1; else hi = m;
  }
  return lo;
}

/**
 * One row per machine per window (an hour, or a day) it ran. Windows a
 * machine did not run are left out; `idle` lists the machines that did not
 * run in any.
 *
 * @param units    scopeUnits().units, already narrowed to machines
 * @param pings    Map vehicleId → that tracker's readings over the period, sorted
 * @param windows  hourWindows(from, to) or dayWindows(from, to)
 */
export function machineryRows(units, pings, windows) {
  return machineryJoin(units, units.map((u) => machineryUnit(u, pings, windows)));
}

/**
 * machineryRows a machine at a time, handing the page back between machines
 * (lib/slices): a month of a whole site by the hour held the page for seconds.
 */
export async function machineryRowsSliced(units, pings, windows, { signal } = {}) {
  return machineryJoin(units, await mapSliced(units, (u) => machineryUnit(u, pings, windows), { signal }));
}

/** One machine's rows, a row for each window it worked in. */
function machineryUnit(u, pings, windows) {
  const rows = [];
  {
    const kind = machineKind(u);
    // The register's burn rate, where it rates the machine by the hour
    const rated = ratedOf(u);
    const std = rated?.basis === 'HOURS' ? rated.value : null;
    let any = false;
    for (const w of windows) {
      const maxH = (w.to - w.from) / HOUR;
      // The tracker with the most engine time stands for the unit in the window
      let best = null;
      for (const v of u.vehicles) {
        const list = pings.get(v.vehicleId) ?? [];
        // Found by halving, not by scanning: a week by the hour is 168 windows over a week of readings
        const i = firstFrom(list, w.from);
        const sub = list.slice(i, firstFrom(list, w.to));
        const prior = i > 0 ? list[i - 1] : null;
        const before = prior && w.from - prior.t <= EDGE_GAP_MS ? prior : null;
        const s = summariseDay(sub, null);
        const eh = engineHoursOf(s, meterAdvance(before, sub), maxH);
        const cand = { readings: sub.length, s, eh, fuelSensor: sub.some((p) => Number.isFinite(p.fuelLevelMl) || Number.isFinite(p.fuelUsedMl)) };
        if (!best || cand.eh.hours > best.eh.hours || (cand.eh.hours === best.eh.hours && cand.readings > best.readings)) best = cand;
      }
      const hours = best?.eh.hours ?? 0;
      if (hours < 1 / 60) continue;
      any = true;
      const usedL = best.s.usedL != null ? Math.max(0, best.s.usedL) : 0;
      const fuelSeen = best.s.usedL != null;
      // Fuel used over engine hours, as it is (operator, 16 Nov 2026: "everything should be calculated
      // as it is"): no least running time, and no reading set aside as a faulty sensor
      const actual = fuelSeen && hours > 0 ? usedL / hours : null;
      rows.push({
        unit: u,
        key: `${u.key}|${w.from}`,
        day: w.day,
        hour: w.hour ?? null,
        from: w.from,
        to: w.to,
        hours,
        hoursFrom: best.eh.from,
        usedL,
        fuelSeen,
        fuelSensor: best.fuelSensor,
        readings: best.readings,
        basis: 'HOURS',
        over: null,
        fuelSuspectRated: false,
        // Against the burn rate (operator, 16 Nov 2026): at or below is within, above is over
        std,
        actual,
        // Judged on the figures as printed, to one decimal: 12.04 L/h reads 12.0, and is
        // on a 12.0 burn rate, not above it (operator, 16 Nov 2026: MUFINDI - EX 02)
        vsStd: std != null && actual != null ? (round1(actual) <= round1(std) ? 'within' : 'above') : null,
        section: kind,
      });
    }
    if (!any) return null;
  }
  return rows;
}

/** The machines' rows in the report's order, and the machines that did not work. */
function machineryJoin(units, parts) {
  const rows = [];
  const idle = [];
  parts.forEach((p, i) => { if (p) for (const r of p) rows.push(r); else idle.push(units[i]); });
  // Greens first, the best of them at the top; then reds, the least over first and the
  // worst at the foot; then the rows with nothing to judge (operator, 16 Nov 2026)
  const rank = (r) => (r.vsStd === 'within' ? 0 : r.vsStd === 'above' ? 1 : 2);
  const ratio = (r) => (r.vsStd ? r.actual / r.std : 0);
  rows.sort((a, b) => rank(a) - rank(b) || ratio(a) - ratio(b) || unitOrder(a, b) || a.from - b.from);
  return { rows, idle };
}
