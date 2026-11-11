// The Planner's plans printed as the Finished Goods Deliveries report
// (operator, 12 Nov 2026: "this is the template for the deliveries"): one line
// per customer, green when the truck delivered and came back to the yard,
// yellow delivered and not back, red not reached. Each plan is read exactly
// as the Deliveries tab reads a Planner sheet (lib/plannerReport): its own
// span, its fences by id, where the truck is now from Movements. Uploaded
// sheets, Wialon itineraries and plans keyed in on Deliveries alike.

import { getPlan } from '../api/planner';
import { loadPings } from '../api/fleetReports';
import { loadMovementReport } from '../api/reports';
import { dayStart } from './fleetReports';
import { findStorages, storageAt } from './deliveriesReport';
import { trackersFor, actualFor, readSpan, sheetRow } from './plannerReport';
import { marksOf } from './plannerDayMarks';
import { finishedGoodsDoc } from './finishedGoodsReport';

const HOUR = 3_600_000;

/**
 * The report's rows for `plans` (listPlans' rows), as Deliveries makes a sheet's.
 * @param {object} o
 * @param {string} o.orgId
 * @param {Array}  o.plans     the plans to print (listPlans' rows: id, plate)
 * @param {Array}  o.vehicles  the fleet's units ({ vehicleId, … }), to find each plan's trackers
 * @param {object} o.zones     the organisation's geofences, a FeatureCollection
 * @param {number} o.at        the report's "as at"
 * @param {(words: string, done?: number, total?: number) => void} [o.onProgress]
 */
export async function plannerFgRows({ orgId, plans, vehicles, zones, at, onProgress = () => {} }) {
  onProgress('Reading the plans');
  const full = await Promise.all(plans.map((p) => getPlan(orgId, p.id)));
  // Where each truck is now: help, not a need (the report runs without it)
  const moves = await loadMovementReport({ orgId, from: at - HOUR, to: at }).catch(() => null);
  const moveRow = new Map((moves?.groups ?? []).flatMap((g) => g.rows).map((r) => [r.vehicleId, r]));
  const storages = findStorages(zones, moves?.morl);

  const units = full.map((p) => ({ plan: p, trackers: trackersFor(p, vehicles), span: readSpan(p, dayStart, at) }));
  // Each plan's trucks over that plan's own span (about three days), one plan after another: a wide
  // range of dates never reads every truck over all of it
  const pings = new Map();   // plan id -> vehicle id -> readings
  const failed = new Set();
  let n = 0;
  for (const u of units) {
    n += 1;
    const got = new Map();
    pings.set(u.plan.id, got);
    if (!u.trackers.length) continue;
    onProgress('Reading the trucks’ positions', n, units.length);
    const r = await loadPings({ orgId, vehicles: u.trackers.map((v) => ({ vehicleId: v.vehicleId })), from: u.span.from, to: u.span.to });
    for (const [vid, list] of r.pings) got.set(vid, list);
    r.failed.forEach((x) => failed.add(x));
  }

  return units.map(({ plan: p, trackers, span }) => {
    const routes = trackers.map((v) => (pings.get(p.id)?.get(v.vehicleId) ?? []).filter((x) => x.t >= span.from && x.t <= span.to));
    const { actual } = actualFor(p, routes, zones, dayStart, at);
    const mv = trackers.map((v) => moveRow.get(v.vehicleId)).find(Boolean) ?? null;
    const why = !trackers.length ? 'No tracked unit carries this plate'
      : trackers.every((v) => failed.has(v.vehicleId)) ? 'Positions could not be read' : null;
    // Where the truck is now: Movements' MORL reading, else its latest position against MORL/STO
    const latest = routes.flat().reduce((a, x) => (!a || x.t > a.t ? x : a), null);
    const nowAt = mv?.lat != null && mv?.lastAt != null && (!latest || mv.lastAt >= latest.t) ? { lat: mv.lat, lng: mv.lng } : latest;
    const atStorage = (mv?.state === 'at' ? storages.find((s) => s.key === 'morl') ?? { key: 'morl', label: 'MORL', short: 'MORL' } : null)
      ?? (nowAt ? storageAt(nowAt, storages) : null);
    // Every stop on the plan counts: the Planner prints whole plans, not one day's share of them
    const row = sheetRow(p, actual, { place: mv?.location ?? null, why, atStorage, marks: marksOf(p), days: null });
    return row;
  });
}

/** The Finished Goods document for the plans of [from, at], ready for docHtml. */
export async function plannerFgDoc({ orgId, plans, vehicles, zones, from, at, fleet, orgCode, onProgress }) {
  const rows = await plannerFgRows({ orgId, plans, vehicles, zones, at, onProgress });
  return finishedGoodsDoc(rows, { from, at, fleet, orgCode });
}
