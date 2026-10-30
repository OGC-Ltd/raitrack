// One day of a vehicle, cut into trips, and any of them (or the whole day)
// shaped as trip-report data — all from what Playback already loads, with no
// backend route of its own (operator, 2026-10-30: pick a day, see that day's
// trips, report on one of them).
//
// Pure: the readings come in, trips and report data go out. Tested in
// dayTrips.test.js. api/dayReport gathers the readings.
//
// ## What a trip is
//
// Driving, until the unit has stood still for BREAK_MS. A short stop (fuel,
// traffic, a gate) stays inside the trip; a long one ends it. Standing is
// measured by POSITION, as Playback's legs are, because some units report a
// dead speed line (lib/playbackLegs). A trip that covers less than MIN_TRIP_M
// is moving about a yard, not a journey, and is left out.
//
// A trip that began within DISPATCH_LEAD_MS of a gate sign-out carries that
// dispatch: its destination, driver and load, read from the sign-out line the
// feed already shows ("… signed out to RAIPLY and left the premises.").

import { haversineM } from './tripProgress';

export const BREAK_MS = 30 * 60_000;
export const MIN_TRIP_M = 500;
const MOVING_KMH = 3;
const MOVING_MIN_M = 40;
/** A sign-out this long before the wheels turned (or a little after) belongs to the trip. */
const DISPATCH_LEAD_MS = 60 * 60_000;
const DISPATCH_LAG_MS = 30 * 60_000;
const SERIES_POINTS = 300;

const pt = (lat, lng) => ({ lat, lng });
const ok = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

function thin(rows, max) {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
  out[out.length - 1] = rows[rows.length - 1];
  return out;
}

/**
 * The day's trips, in time order: `{ from, to, distanceM }`.
 * @param {{t:number, lat:number, lng:number}[]} pings  the day's readings, any order
 */
export function splitTrips(pings, { breakMs = BREAK_MS, minM = MIN_TRIP_M } = {}) {
  const pts = pings.filter(ok).sort((a, b) => a.t - b.t);
  const trips = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    const m = haversineM(pt(a.lat, a.lng), pt(b.lat, b.lng));
    const moving = m >= MOVING_MIN_M && (m / 1000) / (dt / 3_600_000) >= MOVING_KMH;
    if (!moving) continue;
    // A long silence or a long stand since the last movement ends the trip.
    if (cur && a.t - cur.to >= breakMs) { trips.push(cur); cur = null; }
    if (!cur) cur = { from: a.t, to: b.t, distanceM: 0 };
    cur.to = b.t;
    cur.distanceM += m;
  }
  if (cur) trips.push(cur);
  return trips.filter((x) => x.distanceM >= minM);
}

/**
 * A gate sign-out line, as the feed writes it, read back into its parts.
 * "KCP 134P · Dickson Kiplagat signed out to RAIPLY and left the premises."
 * "KCP 134P · Dickson signed out at Naitiri with 29.0 t bound for RAIPLY and left the premises."
 */
export function parseDispatch(text) {
  const s = String(text ?? '');
  if (!/signed out/i.test(s)) return null;
  const driver = /·\s*(.+?)\s+signed out/i.exec(s)?.[1] ?? null;
  const at = /signed out at (.+?)(?= with | to | bound for | and left|$)/i.exec(s)?.[1] ?? null;
  const tonnes = /with ([\d.]+)\s*t\b/i.exec(s)?.[1];
  const destination = /(?:\bto|bound for) (.+?)(?= and left|\.$|$)/i.exec(s)?.[1] ?? null;
  return { driver, at, tonnes: tonnes != null ? Number(tonnes) : null, destination: destination?.trim() || null };
}

/** The day's sign-outs from the Playback events, in time order. */
export function dispatchesOf(events) {
  return (events ?? [])
    .filter((e) => e.kind === 'dispatch' || /DISPATCH/i.test(e.label ?? ''))
    .map((e) => ({ t: e.t, ...parseDispatch(e.detail) }))
    .filter((d) => d.driver || d.destination || d.at)
    .sort((a, b) => a.t - b.t);
}

/** "KCP 134P left NAITIRI YARD" / "… arrived at RAIPLY" → the zone's name. */
const zoneName = (text) => /(?:arrived at|left|entered|exited)\s+(.+?)\.?$/i.exec(String(text ?? ''))?.[1]?.trim() ?? null;

/**
 * Zone visits, paired from the entry and exit events: `{ name, enteredAt, leftAt }`.
 * A visit already running at the start of the day begins at `dayFrom`; one
 * still running at the end of the data ends at `dayTo`.
 */
export function zoneVisits(events, dayFrom, dayTo) {
  const open = new Map();
  const out = [];
  for (const e of [...(events ?? [])].filter((x) => x.kind === 'zone').sort((a, b) => a.t - b.t)) {
    const name = zoneName(e.detail);
    if (!name) continue;
    if (/entered|arrived/i.test(e.label ?? '') || /arrived at|entered/i.test(e.detail ?? '')) {
      if (!open.has(name)) open.set(name, e.t);
    } else {
      out.push({ name, enteredAt: open.get(name) ?? dayFrom, leftAt: e.t, enforced: e.severity === 'critical' });
      open.delete(name);
    }
  }
  for (const [name, t] of open) out.push({ name, enteredAt: t, leftAt: dayTo, enforced: false });
  return out.sort((a, b) => a.enteredAt - b.enteredAt);
}

/** Which zone the unit was in at a moment, or null. */
export const zoneAt = (visits, t) => visits.find((v) => t >= v.enteredAt && t <= v.leftAt)?.name ?? null;

/**
 * The day's trips, labelled: where each began and ended (a zone, or null for
 * api/dayReport to name from the map), and the sign-out it belongs to.
 */
export function dayTrips({ pings, events, dayFrom, dayTo }) {
  const visits = zoneVisits(events, dayFrom, dayTo);
  const sign = dispatchesOf(events);
  const pos = [...pings].filter(ok).sort((a, b) => a.t - b.t);
  const at = (t) => pos.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), pos[0]);
  const used = new Set();
  return splitTrips(pings).map((tr, i) => {
    const d = sign.find((x) => !used.has(x) && x.t >= tr.from - DISPATCH_LEAD_MS && x.t <= tr.from + DISPATCH_LAG_MS) ?? null;
    if (d) used.add(d);
    const a = at(tr.from), b = at(tr.to);
    return {
      n: i + 1,
      ...tr,
      fromName: zoneAt(visits, tr.from) ?? d?.at ?? null,
      toName: d?.destination ?? zoneAt(visits, tr.to) ?? null,
      start: a ? { lat: a.lat, lng: a.lng } : null,
      end: b ? { lat: b.lat, lng: b.lng } : null,
      dispatch: d,
    };
  });
}

const speedOf = (detail) => {
  const m = /peak\s+(\d+)\s*km\/h,\s*limit\s+(\d+)/.exec(String(detail ?? ''));
  return m ? { peakKmh: Number(m[1]), limitKmh: Number(m[2]) } : { peakKmh: null, limitKmh: null };
};
const harshSpeed = (text) => { const m = /(\d+)\s*km\/h/.exec(String(text ?? '')); return m ? Number(m[1]) : null; };
const camKind = (label) => {
  const s = String(label ?? '').toLowerCase();
  if (/seat\s*belt/.test(s)) return 'seatbelt';
  if (/phone|call/.test(s)) return 'phone';
  if (/hand/.test(s)) return 'hands';
  return null;
};

/**
 * Report data, in the shape the trip-report endpoint answers with, for one of
 * the day's trips (`trip`) or the whole day (`trip` null). lib/tripReport and
 * lib/tripReportHtml then lay it out exactly as a dispatch's report.
 */
export function dayReportData({
  vehicle, companyName = null, dayFrom, dayTo, trip = null,
  pings = [], events = [], harsh = [], weighments = [], dashcam = null, now = Date.now(),
}) {
  const from = trip ? trip.from : dayFrom;
  const to = trip ? trip.to : Math.min(dayTo, now);
  const D = trip?.dispatch ?? null;
  // A whole day is driven by whoever signed the unit out that day, if anyone did.
  const dayDriver = trip ? null : dispatchesOf(events).find((x) => x.driver)?.driver ?? null;
  const sorted = [...pings].sort((a, b) => a.t - b.t);
  const track = sorted.filter(ok).map((p) => [p.t, p.lat, p.lng, p.speedKmh ?? null, p.engineOn == null ? null : p.engineOn ? 1 : 0]);
  const levels = sorted.filter((p) => Number.isFinite(p.fuelLevelMl) && p.fuelLevelMl >= 0);
  const ev = (k) => (events ?? []).filter((e) => e.kind === k);
  return {
    mode: trip ? 'trip' : 'day',
    generatedAt: now,
    companyName,
    vehicle: { plate: vehicle.plate, type: vehicle.type ?? null },
    dispatch: {
      externalId: null, serialNumber: null, kind: D?.tonnes != null ? 'SALES' : null, status: null,
      driverName: D?.driver ?? dayDriver ?? vehicle.driver ?? null, destination: D?.destination ?? null,
      dispatchedAt: from, returnedAt: null,
      tonnageT: D?.tonnes ?? null, bags: D?.tonnes != null ? Math.round(D.tonnes * 20) : null, cargoName: null,
    },
    window: { from, to, clipped: false },
    yard: null,
    dest: null,
    // A trip has arrived where it stopped; a day has no destination.
    arrivedAt: trip ? trip.to : null,
    fromName: trip ? trip.fromName ?? null : null,
    toName: trip ? trip.toName ?? null : null,
    track,
    fuel: {
      hasProbe: levels.length >= 10,
      series: thin(levels.map((p) => [p.t, Math.round(p.fuelLevelMl / 100) / 10]), SERIES_POINTS),
      usedByCounterL: null,
      fillings: ev('refill').map((e) => ({ t: e.t, litres: e.ml != null ? e.ml / 1000 : null, after: null, place: null, review: null })),
      drains: ev('theft').map((e) => ({ t: e.t, litres: e.ml != null ? e.ml / 1000 : null, after: null, place: null, review: null })),
    },
    speeding: ev('speeding').map((e) => ({
      t: e.t, durationSec: e.endT ? Math.max(1, Math.round((e.endT - e.t) / 1000)) : 60, distanceM: null, lat: null, lng: null, ...speedOf(e.detail),
    })),
    escalatedThefts: [],
    harsh: (harsh ?? []).map((n) => ({
      t: Date.parse(n.ts ?? n.occurredAt), type: n.alertType === 'HARSH_BRAKING' ? 'brake' : 'accel', lat: null, lng: null, speedKmh: harshSpeed(n.text),
    })).filter((h) => Number.isFinite(h.t)),
    zones: { timedOut: false, visits: zoneVisits(events, dayFrom, dayTo) },
    weighments: (weighments ?? []).map((w) => ({
      ticket: w.token, tokenAt: Date.parse(w.tokenAt), netKg: w.factoryNetWeightKg ?? w.netWeightKg ?? null,
      cargo: w.productName ?? (String(w.category ?? '').startsWith('CANE') ? 'Cane delivery' : null),
      weighings: [
        ['Tare', w.tareWeightKg, w.tareAt, w.tareBridgeNo, w.centerName],
        ['Gross', w.grossWeightKg, w.grossAt, w.grossBridgeNo, w.centerName],
        ['Factory gross', w.factoryGrossWeightKg, w.factoryGrossAt, w.factoryGrossBridgeNo, 'Factory'],
        ['Factory tare', w.factoryTareWeightKg, w.factoryTareAt, w.factoryTareBridgeNo, 'Factory'],
      ].filter(([, kg, at]) => kg != null && at != null).map(([kind, kg, at, no, centre]) => ({
        kind, kg, at: Date.parse(at), bridge: no != null ? `${centre} · bridge ${no}` : centre,
        doubtful: Date.parse(at) < Date.parse(w.tokenAt),
      })),
    })),
    dashcam: dashcam == null ? { fitted: false, complete: true, alarms: [] } : {
      fitted: true, complete: dashcam.complete !== false,
      alarms: (dashcam.alarms ?? []).map((a) => ({ t: a.occurredMs, kind: camKind(a.label), label: a.label, lat: a.lat, lng: a.lng, speed: a.speed }))
        .filter((a) => a.kind && Number.isFinite(a.t)),
    },
    altitude: sorted.filter((p) => Number.isFinite(p.altitudeM)).map((p) => [p.t, p.altitudeM]),
    map: null,
  };
}
