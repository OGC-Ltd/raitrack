// One dispatch as a trip report: the server's measured ingredients (fleet-server
// trips/trip-report.service) shaped into what lib/tripReportHtml lays out on
// the letterhead. Pure, so it is tested on its own.
//
// Everything is worked out from the unit's own fixes. Distance only counts
// segments the unit was actually moving on, so GPS jitter in a parked truck is
// not mileage; a stop is a run of standing segments of 5 minutes or more; and
// where a figure cannot be measured (no probe, no destination point, no
// camera) it is null and the page prints a dash or says why.

import { haversineM } from './tripProgress';

/**
 * The driver's conduct for the DAY of the trip, in print order (operator,
 * 2026-10-29). Escalated fuel theft is a theft case confirmed on review.
 */
export const BREACH_KINDS = [
  { key: 'theft', label: 'Escalated fuel theft' },
  { key: 'brake', label: 'Harsh braking' },
  { key: 'speed', label: 'Overspeeding' },
  { key: 'accel', label: 'Harsh acceleration' },
];

/** Driver-camera alarms, added to the conduct table only for a unit with a dashcam. */
export const DASHCAM_KINDS = [
  { key: 'seatbelt', label: 'No seat belt' },
  { key: 'phone', label: 'Phone use while driving' },
  { key: 'hands', label: 'Hands off the wheel' },
];

const YARD_RADIUS_M = 800;
const arrivalRadiusM = (spreadM) => Math.min(Math.max((spreadM ?? 0) * 2, 800), 3000);
/** Below this a segment is standing: walking pace, or drift under 40 m. */
const MOVING_KMH = 3;
const MOVING_MIN_M = 40;
/** A stop that wanders further than this from where it began has become driving. */
const STOP_DRIFT_M = 200;
const STOP_MIN_MS = 5 * 60_000;
/** An unexplained stop this long is flagged on the page. */
const LONG_STOP_MS = 30 * 60_000;
/** A reported speed above this is a bad fix, not a truck. */
const MAX_PLAUSIBLE_KMH = 160;

const ROWS = { stops: 8, fuel: 6, breaches: 6, geo: 6, weighings: 8 };
const SVG_POINTS = 600;

const pt = (lat, lng) => ({ lat, lng });

function thin(rows, max) {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
  out[out.length - 1] = rows[rows.length - 1];
  return out;
}

/** Segment by segment: moving or standing, how far, how long, engine on throughout. */
function segments(track) {
  const segs = [];
  for (let i = 1; i < track.length; i++) {
    const [t0, lat0, lng0, , ign0] = track[i - 1];
    const [t1, lat1, lng1, , ign1] = track[i];
    const dt = t1 - t0;
    if (dt <= 0) continue;
    const m = haversineM(pt(lat0, lng0), pt(lat1, lng1));
    const kmh = (m / 1000) / (dt / 3_600_000);
    segs.push({ i, t0, t1, dt, m, moving: m >= MOVING_MIN_M && kmh >= MOVING_KMH, idle: ign0 === 1 && ign1 === 1 });
  }
  return segs;
}

function findStops(track, segs) {
  const stops = [];
  let cur = null;
  const close = () => {
    if (cur && cur.ms >= STOP_MIN_MS) stops.push(cur);
    cur = null;
  };
  for (const s of segs) {
    if (s.moving) { close(); continue; }
    const [, lat, lng] = track[s.i - 1];
    if (cur && haversineM(cur, pt(track[s.i][1], track[s.i][2])) > STOP_DRIFT_M) close();
    if (!cur) cur = { t: s.t0, endT: s.t1, ms: 0, idleMs: 0, lat, lng };
    cur.endT = s.t1;
    cur.ms += s.dt;
    if (s.idle) cur.idleMs += s.dt;
  }
  close();
  return stops;
}

/** What to call a point at a moment: the yard, the destination, the zone it was in, or nothing. */
function placer(d) {
  const visits = d.zones?.visits ?? [];
  const dest = d.dest;
  return (t, lat, lng) => {
    if (lat != null && lng != null) {
      if (d.yard && haversineM(d.yard, pt(lat, lng)) <= YARD_RADIUS_M) return { place: d.yard.name ?? 'Yard', at: 'yard' };
      if (dest && haversineM(dest, pt(lat, lng)) <= arrivalRadiusM(dest.spreadM)) return { place: dest.name, at: 'dest' };
    }
    if (t != null) {
      const v = visits.find((z) => t >= z.enteredAt && t <= z.leftAt);
      if (v) return { place: v.name, at: 'zone' };
    }
    return { place: null, at: null };
  };
}

/** The track position nearest a moment, for events that carry no coordinates. */
function positionAt(track, t) {
  if (!track.length || t == null) return { lat: null, lng: null };
  let lo = 0, hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid][0] < t) lo = mid + 1; else hi = mid;
  }
  const best = lo > 0 && Math.abs(track[lo - 1][0] - t) < Math.abs(track[lo][0] - t) ? lo - 1 : lo;
  return Math.abs(track[best][0] - t) <= 10 * 60_000 ? { lat: track[best][1], lng: track[best][2] } : { lat: null, lng: null };
}

const capped = (rows, n) => ({ rows: rows.slice(0, n), more: Math.max(0, rows.length - n) });
const byTime = (a, b) => a.t - b.t;
const round1 = (v) => Math.round(v * 10) / 10;

function reportNumber(d) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d.dispatch.dispatchedAt).replace(/-/g, '');
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d.dispatch.dispatchedAt).replace(':', '');
  return `TR-${String(d.vehicle.plate).replace(/\s+/g, '')}-${day}-${hm}`;
}

/** @param {object} d  GET /organisations/:orgId/vehicles/:vehicleId/trip-report → data */
export function buildTripReport(d) {
  const track = (d.track ?? []).filter((p) => Number.isFinite(p[1]) && Number.isFinite(p[2]));
  const w = d.window;
  const segs = segments(track);
  const where = placer(d);

  // ── summary ──
  const moving = segs.filter((s) => s.moving);
  const distanceM = moving.reduce((a, s) => a + s.m, 0);
  const movingMs = moving.reduce((a, s) => a + s.dt, 0);
  const durationMs = w.to - w.from;
  const idleMs = segs.filter((s) => !s.moving && s.idle).reduce((a, s) => a + s.dt, 0);
  const speeds = track.map((p) => p[3]).filter((v) => Number.isFinite(v) && v <= MAX_PLAUSIBLE_KMH);
  const hasIgnition = track.some((p) => p[4] != null);

  // ── fuel ──
  const F = d.fuel ?? { series: [], fillings: [], drains: [], hasProbe: false };
  const series = F.series ?? [];
  const startL = F.hasProbe && series.length ? series[0][1] : null;
  const endL = F.hasProbe && series.length ? series[series.length - 1][1] : null;
  const counted = (x) => x.review !== 'NOT_THEFT' && x.review !== 'PROBE_FAULT' && x.review !== 'DISMISSED';
  const filledL = (F.fillings ?? []).reduce((a, x) => a + (x.litres ?? 0), 0);
  const drainL = (F.drains ?? []).filter(counted).reduce((a, x) => a + (x.litres ?? 0), 0);
  let fuelUsedL = F.usedByCounterL ?? null;
  if (fuelUsedL == null && startL != null && endL != null) {
    const v = startL - endL + filledL - drainL;
    fuelUsedL = v >= 0 ? round1(v) : null;
  }
  const located = (x) => {
    const p = x.lat != null ? { lat: x.lat, lng: x.lng } : positionAt(track, x.t);
    return { ...p, place: x.place || where(x.t, p.lat, p.lng).place };
  };
  const drainLabel = (r) => (r === 'CONFIRMED_THEFT' ? 'Confirmed theft' : r === 'NOT_THEFT' ? 'Drop, cleared' : r === 'PROBE_FAULT' ? 'Probe fault' : 'Suspected theft');
  const fuelRows = [
    ...(F.fillings ?? []).map((x) => ({ t: x.t, kind: 'refill', label: 'Refill', litres: x.litres, after: x.after, flag: false, ...located(x) })),
    ...(F.drains ?? []).map((x) => ({ t: x.t, kind: 'drain', label: drainLabel(x.review), litres: x.litres, after: x.after, flag: counted(x), ...located(x) })),
  ].sort(byTime);
  const fuelCap = capped(fuelRows, ROWS.fuel);

  // ── stops ──
  const allStops = findStops(track, segs).map((s) => {
    const { place, at } = where(s.t, s.lat, s.lng);
    // The bare fact, no extra words (operator, 2026-10-29).
    const remark = at === 'yard' ? 'At the yard' : at === 'dest' ? 'At destination' : at === 'zone' ? 'In zone' : 'Unscheduled stop';
    return { ...s, place, remark, flag: at == null && s.ms >= LONG_STOP_MS };
  });
  const stops = [...allStops].sort((a, b) => b.ms - a.ms).slice(0, ROWS.stops).sort(byTime).map((s, i) => ({ ...s, n: i + 1 }));

  // ── driver conduct, for the day ──
  // Dashcam columns are there only when the unit has a camera (dynamic).
  const cam = { fitted: false, complete: true, alarms: [], ...(d.dashcam ?? {}) };
  const kinds = [...BREACH_KINDS, ...(cam.fitted ? DASHCAM_KINDS : [])];
  const mins = (sec) => `${Math.max(1, Math.round(sec / 60))} min`;
  const breaches = [
    ...(d.escalatedThefts ?? []).map((x) => ({ t: x.t, key: 'theft', place: x.place ?? null, lat: null, lng: null,
      detail: `${Math.round(x.litres)} L, confirmed on review` })),
    ...(d.speeding ?? []).map((s) => ({ t: s.t, key: 'speed', lat: s.lat, lng: s.lng,
      detail: `${Math.round(s.peakKmh)} in ${Math.round(s.limitKmh)}, ${mins(s.durationSec)}${s.distanceM != null ? `, ${round1(s.distanceM / 1000)} km` : ''}` })),
    ...(d.harsh ?? []).map((h) => ({ t: h.t, key: h.type === 'brake' ? 'brake' : 'accel', lat: h.lat, lng: h.lng,
      detail: h.speedKmh != null ? `at ${Math.round(h.speedKmh)} km/h` : null })),
    ...(cam.fitted ? cam.alarms ?? [] : []).map((a) => ({ t: a.t, key: a.kind, lat: a.lat, lng: a.lng,
      detail: [a.label, a.speed != null ? `at ${a.speed} km/h` : null].filter(Boolean).join(', ') })),
  ].map((b) => {
    const p = b.lat != null ? { lat: b.lat, lng: b.lng } : positionAt(track, b.t);
    return { ...b, ...p, label: kinds.find((k) => k.key === b.key)?.label ?? b.key, place: b.place || where(b.t, p.lat, p.lng).place };
  }).sort(byTime);
  const counts = Object.fromEntries(kinds.map((k) => [k.key, breaches.filter((b) => b.key === k.key).length]));
  const breachCap = capped(breaches, ROWS.breaches);
  const overspeedMs = (d.speeding ?? []).reduce((a, s) => a + (s.durationSec ?? 0) * 1000, 0);
  const measuredKm = (d.speeding ?? []).filter((s) => s.distanceM != null);
  const overspeedKm = measuredKm.length ? round1(measuredKm.reduce((a, s) => a + s.distanceM, 0) / 1000) : (d.speeding?.length ? null : 0);

  // ── geofence ──
  const edge = 60_000;
  const geoRows = (d.zones?.visits ?? []).flatMap((v) => [
    v.enteredAt > w.from + edge ? { t: v.enteredAt, label: v.enforced ? 'Entered restricted zone' : 'Entered', zone: v.name, flag: v.enforced } : null,
    v.leftAt < w.to - edge ? { t: v.leftAt, label: 'Left', zone: v.name, flag: false } : null,
  ]).filter(Boolean).sort(byTime);
  const geoCap = capped(geoRows, ROWS.geo);

  // ── load ──
  const D = d.dispatch;
  const declared = D.tonnageT != null
    ? { cargo: D.cargoName, bags: D.bags, netKg: D.tonnageT * 1000, ref: D.serialNumber ?? D.externalId }
    : null;
  // Every weighing on every ticket the unit raised that day, in time order,
  // each with the time since the one before. A weighing whose date is doubtful
  // at source (stamped before its own ticket) is printed but never measured
  // against, so it cannot produce a negative or a day-long gap.
  const tickets = [...(d.weighments ?? [])].sort((a, b) => a.tokenAt - b.tokenAt);
  const weighings = tickets.flatMap((tk) => {
    const list = (tk.weighings ?? []).filter((x) => !x.doubtful).sort((a, b) => a.at - b.at);
    const odd = (tk.weighings ?? []).filter((x) => x.doubtful);
    return [...list, ...odd].map((x, i, all) => ({
      ...x, ticket: tk.ticket, cargo: tk.cargo,
      // The ticket's net goes on its last weighing, where the load is settled.
      netKg: i === all.length - 1 ? tk.netKg : null,
    }));
  });
  let prev = null;
  for (const x of weighings) {
    x.sinceMs = !x.doubtful && prev != null ? x.at - prev : null;
    x.sameTicketAsPrev = false;
    if (!x.doubtful) prev = x.at;
  }
  for (let i = 1; i < weighings.length; i++) weighings[i].sameTicketAsPrev = weighings[i].ticket === weighings[i - 1].ticket;
  const weighCap = capped(weighings, ROWS.weighings);
  const bridges = [...new Set(weighings.map((x) => x.bridge).filter(Boolean))];
  // Load details are always printed: what the dispatch says, then what was weighed.
  const kind = D.kind ? D.kind.charAt(0) + D.kind.slice(1).toLowerCase() : null;
  const load = {
    cargo: D.cargoName ?? tickets.find((x) => x.cargo)?.cargo ?? kind,
    kind,
    // A cane dispatch has no serial, only an internal UUID nobody can quote.
    ref: D.serialNumber ?? (/^[0-9a-f]{8}-/i.test(D.externalId ?? '') ? null : D.externalId ?? null),
    bags: D.bags ?? null,
    declaredKg: D.tonnageT != null ? D.tonnageT * 1000 : null,
    weighedKg: tickets.some((x) => x.netKg != null) ? tickets.reduce((a, x) => a + (x.netKg ?? 0), 0) : null,
  };

  return {
    reportNo: reportNumber(d),
    generatedAt: d.generatedAt ?? Date.now(),
    companyName: d.companyName ?? null,
    vehicle: { plate: d.vehicle.plate, type: d.vehicle.type ?? null, driver: D.driverName ?? null },
    window: w,
    from: { name: d.yard?.name ?? null, at: D.dispatchedAt },
    to: { name: d.dest?.name ?? D.destination ?? null, arrivedAt: d.arrivedAt ?? null },
    toDestinationMs: d.arrivedAt != null ? d.arrivedAt - D.dispatchedAt : null,
    yard: d.yard ? { lat: d.yard.lat, lng: d.yard.lng } : null,
    dest: d.dest ? { lat: d.dest.lat, lng: d.dest.lng } : null,
    track: thin(track, SVG_POINTS).map((p) => [p[1], p[2]]),
    map: d.map ?? null,
    summary: {
      distanceKm: track.length > 1 ? round1(distanceM / 1000) : null,
      movingMs: track.length > 1 ? movingMs : null,
      stoppedMs: track.length > 1 ? Math.max(0, durationMs - movingMs) : null,
      idleMs: hasIgnition ? idleMs : null,
      durationMs,
      avgKmh: movingMs > 0 ? round1(distanceM / 1000 / (movingMs / 3_600_000)) : null,
      maxKmh: speeds.length ? Math.max(...speeds) : null,
      fuelUsedL,
    },
    declared,
    load,
    weighbridge: { rows: weighCap.rows, more: weighCap.more, tickets: tickets.length, weighings: weighings.length,
      bridges, doubtful: weighings.some((x) => x.doubtful),
      netKg: tickets.reduce((a, x) => a + (x.netKg ?? 0), 0) },
    stops,
    stopsTotal: allStops.length,
    fuel: { series, hasProbe: !!F.hasProbe, startL, endL, rows: fuelCap.rows, more: fuelCap.more, drainL: round1(drainL) },
    day: d.day ?? { from: w.from, to: w.to },
    breaches: { kinds, dashcam: { fitted: !!cam.fitted, complete: cam.complete !== false }, counts, total: breaches.length, rows: breachCap.rows, more: breachCap.more, overspeedMs, overspeedKm },
    geo: { rows: geoCap.rows, more: geoCap.more, timedOut: !!d.zones?.timedOut },
  };
}
