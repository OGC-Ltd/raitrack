// The end-of-day report for one organisation: the fleet's day in four
// sections — fleet summary, safety, fuel, device health (operator, 2026-10-30:
// "a button where we can download an end of day report … one of them being
// safety: over speeding, harsh braking, no seat belt, use of phones").
//
// Pure: the day's records come in (api/endOfDayReport gathers them through
// routes the dashboard already reads), the report's sections come out. Tested
// in endOfDayReport.test.js.

import { faultLabel } from '../api/incidents';

/** Dashcam alarm codes (fleet-server dashcam/vss-events, as trip-report.service files them). */
const SEATBELT_CODES = new Set([125, 51]);
const PHONE_CODES = new Set([116, 264]);

/** What a dashcam alarm counts as here, or null for one this report does not count. */
export function alarmKind(a) {
  if (SEATBELT_CODES.has(a?.code)) return 'seatbelt';
  if (PHONE_CODES.has(a?.code)) return 'phone';
  const s = String(a?.label ?? '').toLowerCase();
  if (/seat\s*belt/.test(s)) return 'seatbelt';
  if (/phone|texting/.test(s)) return 'phone';
  return null;
}

export const SAFETY_KINDS = [
  { key: 'speed', label: 'Overspeeding' },
  { key: 'brake', label: 'Harsh braking' },
  { key: 'accel', label: 'Harsh acceleration' },
  { key: 'seatbelt', label: 'No seatbelt' },
  { key: 'phone', label: 'Phone use' },
];
const EVENT_WORD = { brake: 'Harsh braking', accel: 'Harsh acceleration', seatbelt: 'No seatbelt', phone: 'Phone use' };

const plateKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const round1 = (n) => Math.round(n * 10) / 10;
const ms = (iso) => (typeof iso === 'number' ? iso : Date.parse(iso));

/** Fuel verdicts that mean the fuel did not actually come or go. */
const NOT_REAL = new Set(['REDISTRIBUTION', 'SENSOR_FAULT']);
const DRAIN_STATUS = { DRAIN: 'Confirmed drain', PENDING: 'Being checked', REFILL: 'Was a refill', REDISTRIBUTION: 'Probe swing', SENSOR_FAULT: 'Probe fault' };

/**
 * @param {object} p
 * @param {number} p.dayFrom, p.dayTo  the fleet day, ms (dayTo capped at now for today)
 * @param {{vehicleId:string, plate:string, driver?:string}[]} p.vehicles  the organisation's units (snapshot)
 * @param {{km?:number, hours?:number, litres?:number, vehicles?:number}|null} p.totals  the day's measured totals
 * @param {object[]} p.speeding  incidents/speeding/summary rows
 * @param {object[]} p.harsh     feed items, HARSH_BRAKING / HARSH_ACCELERATION
 * @param {object[]|null} p.alarms  dashcam alarms (api/vssAlarms rows); null when the org has none or they failed
 * @param {object[]} p.fillings, p.thefts  fuel/fillings and fuel/thefts rows
 * @param {object[]} p.faults    incidents/faults/summary rows
 */
export function buildEndOfDay({ dayFrom, dayTo, vehicles = [], totals = null, speeding = [], harsh = [], alarms = null, fillings = [], thefts = [], faults = [] }) {
  const inDay = (t) => Number.isFinite(t) && t >= dayFrom && t < dayTo;

  // One row per unit, found by id or by plate (feeds disagree on which they carry).
  const byId = new Map();
  const byPlate = new Map();
  const rows = new Map();
  for (const v of vehicles) {
    if (v.vehicleId) byId.set(v.vehicleId, v);
    if (v.plate) byPlate.set(plateKey(v.plate), v);
  }
  const unit = (vehicleId, plate, driver) => {
    const v = (vehicleId && byId.get(vehicleId)) || (plate && byPlate.get(plateKey(plate))) || null;
    const key = v?.vehicleId ?? vehicleId ?? plateKey(plate);
    if (!rows.has(key)) {
      rows.set(key, { vehicleId: v?.vehicleId ?? vehicleId ?? null, plate: v?.plate ?? plate ?? '?', driver: null,
        speed: 0, peakKmh: null, limitKmh: null, overSec: 0, brake: 0, accel: 0, seatbelt: 0, phone: 0 });
    }
    const r = rows.get(key);
    if (driver && driver !== 'Unassigned') r.driver = driver;
    else if (!r.driver && v?.driver && v.driver !== 'Unassigned') r.driver = v.driver;
    return r;
  };
  const plateOf = (vehicleId) => byId.get(vehicleId)?.plate ?? null;

  // ── safety ──
  const events = [];
  for (const s of speeding) {
    const r = unit(s.vehicleId, s.plate, s.driverName);
    r.speed += s.incidents ?? 0;
    r.peakKmh = Math.max(r.peakKmh ?? 0, s.peakKmh ?? 0) || null;
    r.limitKmh = s.limitKmh ?? r.limitKmh;
    r.overSec += s.totalSeconds ?? 0;
  }
  const seen = new Set();
  for (const h of harsh) {
    const t = ms(h.ts ?? h.time);
    if (!inDay(t) || seen.has(h.id)) continue;
    seen.add(h.id);
    const kind = h.alertType === 'HARSH_BRAKING' ? 'brake' : h.alertType === 'HARSH_ACCELERATION' ? 'accel' : null;
    if (!kind) continue;
    const r = unit(h.vehicleId, h.plate);
    r[kind] += 1;
    events.push({ t, plate: r.plate, kind, detail: String(h.text ?? '').replace(/^[^—-]*[—-]\s*/, '') });
  }
  for (const a of alarms ?? []) {
    const kind = alarmKind(a);
    if (!kind || !inDay(a.occurredMs)) continue;
    const r = unit(a.vehicleId, a.plate);
    r[kind] += 1;
    events.push({ t: a.occurredMs, plate: r.plate, kind, detail: [a.label, a.speed != null ? `${a.speed} km/h` : null].filter(Boolean).join(', ') });
  }
  const units = [...rows.values()]
    .map((r) => ({ ...r, total: r.speed + r.brake + r.accel + r.seatbelt + r.phone }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.plate.localeCompare(b.plate));
  const counts = Object.fromEntries(SAFETY_KINDS.map((k) => [k.key, units.reduce((n, r) => n + r[k.key], 0)]));

  // ── fuel ──
  const refills = fillings
    .map((f) => ({ t: ms(f.filledAt), plate: plateOf(f.vehicleId) ?? '?', litres: f.filledMl != null ? round1(f.filledMl / 1000) : null, place: f.location ?? null, real: !NOT_REAL.has(f.verdict) }))
    .filter((f) => inDay(f.t) && f.real)
    .sort((a, b) => a.t - b.t);
  const drains = thefts
    .map((d) => {
      const ml = d.cleanDropMl ?? d.stolenMl;
      return { t: ms(d.beganAt ?? d.detectedAt), plate: plateOf(d.vehicleId) ?? '?', litres: ml != null ? round1(ml / 1000) : null, place: d.initialLocation ?? null,
        verdict: d.verdict ?? 'PENDING', status: DRAIN_STATUS[d.verdict ?? 'PENDING'] ?? d.verdict };
    })
    .filter((d) => inDay(d.t) && (d.verdict === 'DRAIN' || d.verdict === 'PENDING'))
    .sort((a, b) => a.t - b.t);
  const sumL = (xs) => round1(xs.reduce((n, x) => n + (x.litres ?? 0), 0));

  // ── device health ──
  const devices = faults
    .map((f) => ({
      plate: f.plate ?? plateOf(f.vehicleId) ?? f.name ?? '?',
      faults: [...new Set(String(f.kinds ?? '').split(',').filter(Boolean))].map(faultLabel).join(', '),
      episodes: f.episodes ?? 0,
      downSec: f.totalSeconds ?? f.total_seconds ?? 0,
      stillDown: (f.open_now ?? f.openNow ?? 0) > 0,
    }))
    .sort((a, b) => Number(b.stillDown) - Number(a.stillDown) || b.downSec - a.downSec);

  return {
    dayFrom, dayTo,
    fleet: {
      units: vehicles.length,
      withData: totals?.vehicles ?? null,
      km: totals?.km != null ? Math.round(totals.km) : null,
      hours: totals?.hours != null ? round1(totals.hours) : null,
      litres: totals?.litres != null ? Math.round(totals.litres) : null,
    },
    safety: {
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      units,
      events: events.sort((a, b) => a.t - b.t),
      dashcam: alarms != null,
    },
    fuel: { refills, drains, refillL: sumL(refills), drainL: sumL(drains), confirmedDrains: drains.filter((d) => d.verdict === 'DRAIN').length },
    devices: { rows: devices, stillDown: devices.filter((d) => d.stillDown).length },
  };
}

export { EVENT_WORD };
