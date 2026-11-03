// The Tankers Report (operator, 2–3 Nov 2026): Menengai's tankers on the
// road from the Mombasa depot to MORL, and how far each went in the 4 hours up
// to the report time (operator, 3 Nov 2026: "the time left storage facility is
// time the vehicle left Mombasa depot and not MORL"; "we shall only be
// highlighting units that left Mombasa and in transit").
//
//   Reg No                         the tanker
//   Time left storage facility     when it drove out of the Mombasa depot
//                                  (the loading point Movements marks,
//                                  lib/movementReport MOMBASA_LOADING)
//   Time period                    the 4 hours up to the report time
//   Location                       where it was at the report time (the
//                                  Movements report's place name)
//   Distance covered within 4 h    km driven in that window
//   Distance (km)                  km driven since it left the depot
//
// Which tankers: those whose last visit to the depot is followed by the road,
// not by the depot again: still on the road to MORL, or arrived at MORL in the
// last COMPLETED_SHOWN_MS. One still at the depot is loading; one that reached
// MORL before that, or that left MORL since, is not on a trip from Mombasa.
//
// Rows, as the operator's sheet colours them:
//   white   in transit
//   green   trip completed: reached the MORL geofence
//   red     covered under half of what the middle tanker on the road covered
//           in the same 4 hours (operator, 3 Nov 2026: "50 percent less than
//           the others"), or did not move at all
//
// Pure: no React, no network.

import { summariseWindows, km2 } from './fleetReports';
import { fenceContains } from './zoneContainment';
import { MOMBASA_LOADING } from './movementReport';
import { renderLetterheadHtml, table, cells, esc } from './letterhead';
import { reportNumber } from './reportLetterhead';

/** Menengai's tanker group on the fleet list (data/fleetGroups). */
export const TANKER_GROUP = 'Tankers';
export const WINDOW_MS = 4 * 3600_000;
/** How far back a tanker's readings are followed to its departure from the depot. */
export const LOOKBACK_DAYS = 10;
/**
 * A trip that reached MORL longer ago than this is done with: off the report.
 * Every completed trip in it is listed; the operator leaves out the ones
 * already reported before making the PDF (operator, 3 Nov 2026: "include all,
 * will drop them before generating").
 */
export const COMPLETED_SHOWN_MS = 24 * 3600_000;
/** Under this in the window is "no movement": a parked tanker's GPS still wanders a few hundred metres. */
export const MIN_MOVE_KM = 0.5;
/** Out of a fence and back within this is the fix wandering at the gate, not a trip. */
export const BLIP_MS = 15 * 60_000;
const DAY = 86_400_000;

/** The storage facility: the Mombasa depot, a circle round the loading point. */
export const DEPOT = {
  type: 'Feature',
  properties: { name: 'Mombasa depot', radiusM: MOMBASA_LOADING.radiusM },
  geometry: { type: 'Point', coordinates: [MOMBASA_LOADING.lng, MOMBASA_LOADING.lat] },
};
export const DEPOT_WORDS = 'Mombasa depot';

/** The row colours, on the PDF and the screen. */
export const ROW_TINT = { transit: null, completed: '#c6efce', still: '#ffc7ce' };
export const STATUS_WORDS = { transit: 'In transit', completed: 'Trip completed', still: 'Under half the others' };
/** Red: under this share of the middle (median) tanker's distance in the 4 hours. */
export const SLOW_SHARE = 0.5;

/** A fence's name, wherever the platform keeps it. */
const fenceName = (f) => String(f?.properties?.name ?? f?.properties?.title ?? f?.properties?.label ?? f?.properties?.zoneName ?? '').trim();
const radiusOf = (f) => {
  const p = f?.properties ?? {};
  const r = Number(p.radiusM ?? p.radius_m ?? p.radiusMeters ?? p.radius);
  return Number.isFinite(r) && r > 0 ? r : null;
};

/**
 * A fence as an area the containment test reads (lib/zoneContainment): a
 * polygon as it is, a circle with its radius as radiusM, and a boundary drawn
 * as a closed line as the polygon it encloses. Null for anything else.
 */
function asArea(f) {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return f;
  if (g.type === 'Point') { const r = radiusOf(f); return r ? { ...f, properties: { ...f.properties, radiusM: r } } : null; }
  if (g.type === 'LineString') {
    const c = g.coordinates ?? [];
    const closed = c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
    return closed ? { ...f, geometry: { type: 'Polygon', coordinates: [c] } } : null;
  }
  return null;
}

/**
 * MORL's geofence, picked as the server's Movements report picks it
 * (fleet-server movement-report.service findMorl): an active fence named
 * MORL itself, else one with MORL in its name that is not a farm, else any
 * with MORL; failing those, the HQ yard ("Menengai Yard - Nakuru HQ"), which
 * the server calls "MORL HQ" (operator, 2 Nov: "the refinery is there"),
 * switched off or not. Null when there is none.
 */
export function findMorlFence(featureCollection, name) {
  const all = featureCollection?.features ?? [];
  const active = (f) => f?.properties?.isActive !== false;
  const morl = all.filter((f) => active(f) && /MORL/i.test(fenceName(f)));
  const hq = all.filter((f) => /\bHQ\b/i.test(fenceName(f)))
    .sort((a, b) => Number(active(b)) - Number(active(a)) || fenceName(a).localeCompare(fenceName(b)));
  const want = String(name ?? '').trim().toLowerCase();
  const order = [
    ...all.filter((f) => want && fenceName(f).toLowerCase() === want),
    ...morl.filter((f) => /^\s*MORL\s*$/i.test(fenceName(f))),
    ...morl.filter((f) => /\bMORL\b/i.test(fenceName(f)) && !/farm/i.test(fenceName(f))),
    ...morl,
    ...hq,
  ];
  for (const f of order) { const area = asArea(f); if (area) return area; }
  return null;
}

/** Why no MORL fence was found, in words for the page: what the platform did send. */
export function morlFenceProblem(featureCollection, name) {
  const all = featureCollection?.features ?? [];
  const near = all.filter((f) => /MORL|\bHQ\b/i.test(fenceName(f)) || (name && fenceName(f).toLowerCase() === String(name).trim().toLowerCase()));
  const listed = near.slice(0, 5).map((f) => `"${fenceName(f)}" (${f?.geometry?.type ?? 'no shape'})`).join(', ');
  return `MORL's geofence could not be read, so departures cannot be found. `
    + `${name ? `Movements uses "${name}". ` : ''}`
    + `The platform sent ${all.length} geofence${all.length === 1 ? '' : 's'}`
    + (near.length ? `; with MORL or HQ in the name: ${listed}, none of them an area.` : `: ${all.slice(0, 5).map((f) => `"${fenceName(f)}"`).join(', ') || 'none'}, none with MORL or HQ in its name.`);
}

/**
 * One tanker's trip from the depot, from its readings (sorted by time) up to
 * `to`. `need`: true when the readings do not reach back far enough to say,
 * so more days should be read. Otherwise `trip` is null (not on a trip from
 * Mombasa) or { leftAt, arrivedAt, windowKm, tripKm, status }.
 */
export function depotTrip(pings, depot, morl, { from, to }) {
  const marks = [];
  for (const p of pings) {
    if (p.t > to) break;
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      marks.push({ t: p.t, depot: fenceContains(p, depot), morl: morl ? fenceContains(p, morl) : false });
    }
  }
  if (!marks.length) return { need: true, trip: null };
  // The last reading inside the depot, and the departure after it. A reading
  // out and back in within BLIP_MS is the fix wandering, so it is skipped.
  let lastIn = -1;
  for (let i = marks.length - 1; i >= 0; i--) {
    if (!marks[i].depot) continue;
    const next = marks.slice(i + 1).find((m) => !m.depot);
    if (!next) { lastIn = i; break; }
    const backIn = marks.slice(marks.indexOf(next) + 1).find((m) => m.depot);
    if (backIn && backIn.t - next.t < BLIP_MS) continue;
    lastIn = i;
    break;
  }
  if (lastIn < 0) {
    // Not at the depot in what was read. At MORL before COMPLETED_SHOWN_MS ago:
    // any trip from Mombasa ended before that, so no more need be read.
    const oldMorl = marks.some((m) => m.morl && m.t < to - COMPLETED_SHOWN_MS);
    return { need: !oldMorl, trip: null };
  }
  const out = marks.slice(lastIn + 1).find((m) => !m.depot);
  if (!out) return { need: false, trip: null };                    // still at the depot: loading
  const leftAt = out.t;
  const arrived = marks.find((m) => m.t > leftAt && m.morl);
  const arrivedAt = arrived?.t ?? null;
  if (arrivedAt != null) {
    if (arrivedAt < to - COMPLETED_SHOWN_MS) return { need: false, trip: null };
  }
  const tripEnd = arrivedAt ?? to;
  const tripKm = summariseWindows(pings, [[leftAt, tripEnd]]).km;
  const a = Math.max(from, leftAt);
  const b = Math.min(to, tripEnd);
  const win = b > a ? summariseWindows(pings, [[a, b]]) : { km: 0 };
  // Red or not is read against the other tankers once all are known (markSlow)
  const status = arrivedAt != null ? 'completed' : 'transit';
  return { need: false, trip: { leftAt, arrivedAt, windowKm: win.km, tripKm, status } };
}

/**
 * The report's rows from what is held: each tanker on a trip from the depot.
 * `need`: the units whose readings must reach further back to say.
 */
export function tankerRows(units, pingsOf, depot, morl, { from, to }, placeOf = () => null) {
  const rows = [];
  const need = [];
  for (const unit of units) {
    let best = null;
    let unsure = false;
    for (const v of unit.vehicles) {
      const pings = pingsOf(v.vehicleId) ?? [];
      const r = depotTrip(pings, depot, morl, { from, to });
      if (r.trip && (!best || pings.length > best.n)) best = { trip: r.trip, n: pings.length };
      else if (r.need) unsure = true;
    }
    if (best) rows.push({ unit, ...best.trip, location: best.trip.status === 'completed' ? 'MORL' : placeOf(unit) ?? '' });
    else if (unsure) need.push(unit);
  }
  return { rows: sortRows(rows), need };   // markSlow once every tanker is in
}

/**
 * Red: the tankers on the road that covered under half of what the middle one
 * covered in the 4 hours, and any that did not move at all. Returns the line
 * in km, for the PDF to state. Run once every row is known.
 */
export function markSlow(rows) {
  const road = rows.filter((r) => r.status !== 'completed');
  const km = road.map((r) => r.windowKm ?? 0).sort((a, b) => a - b);
  const mid = km.length ? (km.length % 2 ? km[(km.length - 1) / 2] : (km[km.length / 2 - 1] + km[km.length / 2]) / 2) : 0;
  const line = Math.max(SLOW_SHARE * mid, MIN_MOVE_KM);
  for (const r of road) r.status = (r.windowKm ?? 0) < line ? 'still' : 'transit';
  return { median: mid, line };
}

/** On the road first, by the time they left the depot; then those that reached MORL. */
export function sortRows(rows) {
  return rows.sort((x, y) => Number(x.status === 'completed') - Number(y.status === 'completed') || x.leftAt - y.leftAt
    || String(x.unit.plate).localeCompare(String(y.unit.plate)));
}

/** "16.09.2026 15:54:53", fleet time. */
export function leftWords(ms) {
  const s = new Date(ms + 3 * 3600_000).toISOString();
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 19)}`;
}
const hm = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(11, 16);
/** "08:30-12:30". */
export const periodWords = (from, to) => `${hm(from)}-${hm(to)}`;
/** "16th September 2026". */
export function dayWords(day) {
  const d = Number(day.slice(8, 10));
  const th = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  const month = new Date(`${day}T12:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${d}${th} ${month} ${day.slice(0, 4)}`;
}

/** A row's cells, for the screen, the PDF and the CSV. */
export function rowCells(r, from, to) {
  const done = r.status === 'completed';
  return [r.unit.plate, leftWords(r.leftAt), periodWords(from, to), r.location || '-',
    done ? 'COMPLETED TRIP' : km2(r.windowKm), done ? '' : km2(r.tripKm)];
}
export const COLUMNS = ['Reg No', 'Time left storage facility', 'Time period', 'Location', 'Distance covered KM (4hrs)', 'Distance (km)'];

export function counts(rows) {
  const c = { all: rows.length, transit: 0, completed: 0, still: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

/** The CSV. */
export function csvTable(rows, from, to) {
  return { head: [...COLUMNS, 'Status'], body: rows.map((r) => [...rowCells(r, from, to), STATUS_WORDS[r.status]]) };
}

const dmy = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/');

/** The PDF, on the letterhead: the figures, then one table, coloured as the sheet is. */
export function tankersHtml(rows, { from, to, companyName, orgCode, logos, now = Date.now(), failed = 0, slowLine = null }) {
  const c = counts(rows);
  const tint = (r) => (ROW_TINT[r.status] ? `background:${ROW_TINT[r.status]}` : undefined);
  const flow = [
    `<h2>1. Overview <small>${esc(periodWords(from, to))}, ${esc(dmy(to))}</small></h2>`,
    cells([['Tankers from Mombasa', String(c.all)], ['In transit', String(c.transit + c.still)], ['Trip completed', String(c.completed)]]),
    `<h2>2. Tankers Movement <small>${esc(dmy(to))}</small></h2>`,
  ];
  if (!rows.length) flow.push('<div class="none">No tanker is on the road from the Mombasa depot.</div>');
  else {
    const cols = [{ h: 'Reg No', w: '20mm' }, { h: 'Time left storage facility', w: '34mm' }, { h: 'Time period', w: '20mm' },
      { h: 'Location', w: '54mm' }, { h: 'Distance covered KM (4hrs)', w: '34mm' }, { h: 'Distance (km)', w: '22mm' }];
    // Every column centred, as the operator's sheet is (operator, 3 Nov 2026)
    flow.push('<style>.lst th, .lst td { text-align: center } .lst td:first-child, .lst th:first-child { padding-left: 1.4mm }</style>');
    flow.push(table(cols, rows.map((r) => {
      const style = tint(r);
      const done = r.status === 'completed';
      return rowCells(r, from, to).map((v, i) => ({
        html: esc(v),
        cls: [i === 0 ? 'b' : '', i === 3 ? 'wrap' : '', done && i === 4 ? 'b' : ''].filter(Boolean).join(' '),
        style,
      }));
    })));
    flow.push(`<div class="note">Storage facility: the ${esc(DEPOT_WORDS)}. Green: trip completed, reached MORL in the last 24 hours. Red: covered under half of what the middle tanker covered in the 4 hours${slowLine != null ? ` (under ${km2(slowLine)} km)` : ''}.</div>`);
  }
  if (failed) flow.push(`<div class="note">${esc(`${failed} tanker${failed === 1 ? '' : 's'} could not be read and ${failed === 1 ? 'is' : 'are'} left out.`)}</div>`);
  // No "not tracked" note and no system-generated line on this report (operator, 3 Nov 2026)

  const html = renderLetterheadHtml({
    title: 'TANKERS REPORT',
    reportNo: reportNumber('TK', orgCode, now),
    date: dmy(to),
    companyName,
    info: [
      ['Fleet', esc(companyName)],
      ['Group', esc(TANKER_GROUP)],
      ['Storage facility', esc(DEPOT_WORDS)],
      ['Time period', esc(`${periodWords(from, to)} (4 hours)`)],
      ['Tankers', `${rows.length} in transit to HQ`],
      ['Generated', esc(leftWords(now).slice(0, 16))],
    ],
    flow,
    footNote: `${companyName} · Tankers Report · ${dmy(to)} · ${periodWords(from, to)}`,
    logos,
  });
  const d = new Date(to + 3 * 3600_000).toISOString().slice(0, 10);
  return { html, filename: `Tankers Report ${companyName} ${d} ${periodWords(from, to).replace(/:/g, '')}.pdf` };
}

export { DAY as DAY_MS };
