// The Reports page's four reports, as rows from the records the loaders read
// (api/fleetReports). Pure: no React, no network, so the test runs it.
//
//   Harsh acceleration  per unit, per hour of the day
//   Night driving       distance covered inside the night hours
//   Overspeeding        overspeeds lasting MORE than 5 minutes, unbroken,
//                       and the distance covered during them
//   Utilisation         distance, moving and engine time for every unit,
//                       including those that did not move
//
// Times are fleet time, Africa/Nairobi (UTC+3 all year, no daylight saving).

import { summariseDay } from './vehicleDay';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OFFSET = 3 * HOUR;

/** An overspeed must last longer than this to count (operator, 1 Nov 2026: continuous). */
export const OVERSPEED_MIN_SEC = 5 * 60;
/** Night hours, by default 19:00 to 05:00. */
export const NIGHT = { start: 19, end: 5 };
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
export const BEHAVIOUR_KINDS = ['accel', 'brake', 'seatbelt', 'phone', 'covered'];
/** The kinds a dashcam reports, and an operator can log by hand. */
export const SEEN_KINDS = ['seatbelt', 'phone', 'covered'];
/** An operator entry and a camera alarm of one kind this close on one vehicle are one incident. */
export const SAME_INCIDENT_MS = 5 * 60_000;

const alarmKind = (code) => (PHONE_CODES.has(code) ? 'phone' : SEATBELT_CODES.has(code) ? 'seatbelt' : COVER_CODES.has(code) ? 'covered' : null);

/**
 * The Driver Behaviour Report (operator, 1 Nov 2026): per unit, its harsh
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
export function behaviourRows(units, harsh, alarms, { from, to, dashcams = true, logged = [] }) {
  const find = unitFinder(units);
  const perVehicle = new Map();
  const alarmTimes = new Map();   // unit key → kind → [ms]
  const firstAt = new Map();   // unit key → earliest incident in the period
  const seenAt = (k, t) => { if (Number.isFinite(t) && !(firstAt.get(k) <= t)) firstAt.set(k, t); };
  const bump = (it, kind, t, alarm = false) => {
    const hit = find(it);
    if (!hit) return;
    let r = perVehicle.get(hit.v.vehicleId);
    if (!r) perVehicle.set(hit.v.vehicleId, (r = { accel: 0, brake: 0, seatbelt: 0, phone: 0, covered: 0 }));
    r[kind] += 1;
    seenAt(hit.u.key, t);
    if (alarm) {
      const byKind = alarmTimes.get(hit.u.key) ?? new Map();
      alarmTimes.set(hit.u.key, byKind);
      byKind.set(kind, [...(byKind.get(kind) ?? []), t]);
    }
  };
  for (const e of harsh ?? []) {
    const t = Date.parse(e?.ts);
    if (!Number.isFinite(t) || t < from || t >= to) continue;
    if (e.alertType === 'HARSH_ACCELERATION') bump(e, 'accel', t);
    else if (e.alertType === 'HARSH_BRAKING') bump(e, 'brake', t);
  }
  for (const a of alarms ?? []) {
    const t = a?.occurredMs;
    const kind = alarmKind(a?.code);
    if (!kind || !Number.isFinite(t) || t < from || t >= to) continue;
    bump(a, kind, t, true);
  }

  // Operator entries: in the period, on a unit in scope.
  const manual = new Map();   // unit key → { kind: n }
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
    }
    inScope.push({ ...e, unit: hit.u, matched: near, counted });
  }

  const days = Math.max(1, (to - from) / DAY);
  const rows = [];
  for (const u of units) {
    const auto = { accel: 0, brake: 0, seatbelt: 0, phone: 0, covered: 0 };
    for (const v of u.vehicles) {
      const c = perVehicle.get(v.vehicleId);
      if (c) for (const k of BEHAVIOUR_KINDS) auto[k] = Math.max(auto[k], c[k]);
    }
    const m = manual.get(u.key) ?? {};
    // No dashcam (from the client's list, or none in the whole fleet): its own
    // seatbelt, phone and cover counts cannot exist, so the columns say "–" —
    // unless an operator saw one, which counts whatever the unit carries.
    const dashcam = dashcams && u.dashcam !== false;
    const r = { unit: u, dashcam, accel: auto.accel, brake: auto.brake, manual: m, logged: 0 };
    for (const k of SEEN_KINDS) {
      r[k] = (dashcam ? auto[k] : 0) + (m[k] ?? 0);
      r.logged += m[k] ?? 0;
    }
    r.total = r.accel + r.brake + r.seatbelt + r.phone + r.covered;
    r.suspect = r.accel / days > HARSH_SUSPECT_PER_DAY || r.brake / days > HARSH_SUSPECT_PER_DAY;
    r.driver = u.vehicles.map((v) => (v.driver && v.driver !== 'Unassigned' ? v.driver : null)).find(Boolean) ?? null;
    r.firstAt = firstAt.get(u.key) ?? null;
    if (r.total > 0 || inScope.some((e) => e.unit.key === u.key)) rows.push(r);
  }
  rows.sort((a, b) => b.total - a.total);
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
    perVehicle.set(vehicleId, {
      count: long.length,
      seconds: long.reduce((s, e) => s + Number(e.durationSec || 0), 0),
      km: long.reduce((s, e) => s + (Number(e.distanceM) || 0), 0) / 1000,
      kmKnown: long.every((e) => Number.isFinite(Number(e.distanceM)) && e.distanceM != null),
      peakKmh: peak ? Number(peak.peakKmh) : null,
      limitKmh: peak ? Number(peak.limitKmh) : null,
      longestSec: Math.max(...long.map((e) => Number(e.durationSec) || 0)),
      driver: long.find((e) => e.driverName)?.driverName ?? null,
    });
  }
  return bestPerUnit(units, perVehicle, (r) => r.count)
    .filter((r) => r.count > 0)
    .sort((a, b) => b.km - a.km || b.seconds - a.seconds);
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
  const out = { km: 0, movingMin: 0, engineOnMin: 0, idleMin: 0, usedL: 0, fuelSeen: false, fuelSensor: false, readings: 0 };
  for (const [a, b] of windows) {
    const sub = pings.filter((p) => p.t >= a && p.t < b);
    out.readings += sub.length;
    if (!out.fuelSensor && sub.some((p) => Number.isFinite(p.fuelLevelMl) || Number.isFinite(p.fuelUsedMl))) out.fuelSensor = true;
    if (sub.length < 2) continue;
    const s = summariseDay(sub, null);
    out.km += s.distanceKm ?? 0;
    out.movingMin += s.movingMin ?? 0;
    out.engineOnMin += s.engineOnMin ?? 0;
    out.idleMin += s.idleMin ?? 0;
    if (s.usedL != null) { out.usedL += Math.max(0, s.usedL); out.fuelSeen = true; }
  }
  return out;
}

/** Units that covered ground at night, farthest first. */
export function nightRows(units, perVehicle, { minKm = 0.5 } = {}) {
  return bestPerUnit(units, perVehicle, (r) => r.km)
    .filter((r) => (r.km ?? 0) >= minKm)
    .sort((a, b) => b.km - a.km);
}

/** Every unit, the stationary ones included (they are the point). */
export function utilisationRows(units, perVehicle, { rated = false } = {}) {
  return bestPerUnit(units, perVehicle, (r) => r.km)
    .map((r) => {
      const row = { ...r, km: r.km ?? 0, engineOnMin: r.engineOnMin ?? 0, noData: !r.readings };
      return rated ? { ...row, ...burnAgainstRegister(row, ratedOf(r.unit)) } : row;
    })
    // Machines are measured by the hour, so the busiest machine leads its table.
    .sort((a, b) => (a.basis === 'HOURS' && b.basis === 'HOURS' ? b.engineOnMin - a.engineOnMin : b.km - a.km));
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
