// The Planner's sheets on the Deliveries report (operator, 2026-11-11: "the
// planner already tracks, we just need to render a report on the deliveries
// report"). Nothing is tracked again here: each sheet runs through the same
// planActual the Planner's plan view runs, over the same span, and comes out
// as a Deliveries row, so the table, the typed orders, CSV, PDF and JPEG all
// take it as they take a hand-listed vehicle.
//
// Pure: no React, no network.

import { customerName } from './customerName';
import { displayOf } from './fleetGroups';
import { findStorages } from './deliveriesReport';
import { planActual, planWindow, LOOKBACK_MS, OUTCOMES, spanWords } from './plannerActual';
import { stopsForDays, shortDay } from './plannerDayMarks';

const DAY = 86_400_000;
export const plateKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The truck's trackers: the plan's unit and any other carrying its plate. */
export function trackersFor(plan, vehicles) {
  if (!plan) return [];
  const k = plateKey(plan.plate);
  return (vehicles ?? []).filter((v) => v.vehicleId === plan.vehicleId || (k && plateKey(displayOf(v)) === k));
}

/** Plan against actual, exactly as the Planner works it out: the sheet's own span, its fences by id. */
export function actualFor(plan, routes, zones, dayStartOf, now = Date.now()) {
  const window_ = planWindow(plan, dayStartOf, now);
  const zonesById = new Map((zones?.features ?? []).map((f) => [f.properties?.id, f]));
  return { window: window_, actual: planActual(plan, routes, findStorages(zones), zonesById, window_) };
}

/** The span a sheet's track is read over: a day before its window, to find where the truck started. */
export function readSpan(plan, dayStartOf, now = Date.now()) {
  const w = planWindow(plan, dayStartOf, now);
  return { from: w.from - LOOKBACK_MS, to: w.to };
}

/**
 * The days to ask the Planner for, for a report over [from, to]: the sheet's
 * Date is the day sales booked it and the truck drives it the next day, so the
 * day before the window's first counts too.
 */
export function sheetDays(from, to, dayOf) {
  return { from: dayOf(from - DAY), to: dayOf(to) };
}

/**
 * Every sheet the Planner lists over the last ALL_SHEETS_DAYS days, when on
 * (operator, 11 Nov 2026: "show everything from the planner atm"). OFF since
 * 12 Nov 2026: it put the 11 Nov trucks on the 12 Nov report, and the operator
 * wants no earlier day's work carried onto a day (see sheetOnDays).
 */
export const ALL_SHEETS = false;
export const ALL_SHEETS_DAYS = 7;

/** The days to ask the Planner for: the window's sheets, or the last ALL_SHEETS_DAYS days while ALL_SHEETS is on. */
export function sheetDaysFor(from, to, dayOf, all = ALL_SHEETS) {
  const d = sheetDays(from, to, dayOf);
  if (!all) return d;
  const back = dayOf(to - (ALL_SHEETS_DAYS - 1) * DAY);
  return { from: back < d.from ? back : d.from, to: d.to };
}

/** The sheets a report over [from, to] takes: all of those listed while ALL_SHEETS is on. */
export function sheetsForReport(plans, from, to, dayStartOf, now = Date.now(), all = ALL_SHEETS) {
  if (!all) return sheetsForWindow(plans, from, to, dayStartOf, now);
  // Never one printed after the window ends
  return (plans ?? []).filter((p) => planWindow(p, dayStartOf, now).from < to);
}

/** The sheets whose own span (printing, then 48 h) meets the report's window. */
export function sheetsForWindow(plans, from, to, dayStartOf, now = Date.now()) {
  return (plans ?? []).filter((p) => {
    const w = planWindow(p, dayStartOf, now);
    return w.from < to && w.to > from;
  });
}

/**
 * Whether a sheet's row belongs on a report over these fleet days (operator,
 * 12 Nov 2026: no carried-forward records). A truck that left for it belongs to
 * the day it left; one that has not left yet stays on (its sheet is booked the
 * day before it is driven); and stops marked for one of the days with "Mark for
 * today" keep a sheet from an earlier day on, as an order that takes two days.
 * @param {object} row    sheetRow's row
 * @param {object} marks  the sheet's marks, { stopId: 'YYYY-MM-DD' } (lib/plannerDayMarks)
 * @param {string[]} days the report's fleet days
 * @param {(ms: number) => string} dayOf  a time's fleet day
 */
export function sheetOnDays(row, marks, days, dayOf) {
  const want = new Set(days ?? []);
  if (Object.values(marks ?? {}).some((d) => want.has(d))) return true;
  const left = row?.trip?.leftAt;
  return left == null || want.has(dayOf(left));
}

/**
 * The fleet days a sheet's own run is on: the day its truck left; before it
 * leaves, its plan's day (a sales sheet also the next, as it is booked the day
 * before it is driven); and any day one of its stops is marked for.
 */
export function sheetRunDays(row, plan, marks, dayOf) {
  const days = new Set(Object.values(marks ?? {}));
  const left = row?.trip?.leftAt;
  if (left != null) days.add(dayOf(left));
  else if (plan?.planDate) {
    const d = String(plan.planDate).slice(0, 10);
    days.add(d);
    if (plan.source !== 'itinerary') days.add(new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Whether a sheet's unit is on this report's list for one of the sheet's own
 * days (`runs`: [{ day, vehicles }]). Only then does the list carry the sheet
 * onto another template's report (operator, 13 Nov 2026: KDM 138L, listed on
 * Finished Goods for 11 Nov, brought its 13 Nov Van Sales itinerary onto the
 * 11 to 13 Nov Finished Goods report as a record nobody added).
 */
export function sheetListed(row, plan, marks, runs, dayOf) {
  const days = sheetRunDays(row, plan, marks, dayOf);
  const key = plateKey(row?.plate);
  return (runs ?? []).some((run) => days.has(run.day) && run.vehicles.some((v) => plateKey(v.plate) === key));
}

const outcomeLabel = (id) => OUTCOMES.find((o) => o.id === id)?.label ?? null;

/**
 * One sheet as a Deliveries row (lib/deliveriesReport deliveryRow's shape).
 * @param {object} plan     getPlan's plan, with stops and customers
 * @param {object} actual   planActual's result
 * @param {object} [o.why]  why there is no track, when there is none to read
 * @param {object} [o.marks] the sheet's "Mark for today" marks, { stopId: 'YYYY-MM-DD' } (lib/plannerDayMarks)
 * @param {string[]} [o.days] the report's fleet days: only the stops due on them are counted
 */
export function sheetRow(plan, actual, { place = null, lastAt = null, why = null, atStorage = null, marks = null, days = null } = {}) {
  // Not left, and in MORL or the depot now: "At MORL" (operator, 11 Nov 2026),
  // rather than "Not seen leaving MORL" for a truck parked in the yard
  const parked = actual?.leftAt == null && actual?.telemetry && atStorage ? atStorage : null;
  const byId = new Map((actual?.stops ?? []).map((s) => [s.id, s]));
  const origin = actual?.origin ? { key: actual.origin.key, label: actual.origin.label, short: actual.origin.short } : null;
  // Orders that take two days (operator, 11 Nov 2026): x of the stops due on these days, not of the whole sheet
  const due = days ? stopsForDays(plan.stops, marks, days) : { stops: plan.stops ?? [], by: 'all' };
  const customers = due.stops.map((s) => {
    const a = byId.get(s.id) ?? {};
    return {
      name: s.id,
      label: [s.customer?.code, customerName(s.customer?.name)].filter(Boolean).join(' '),
      at: a.at ?? null,
      reachedAt: a.at == null ? a.reachedAt ?? null : null,
      // planActual keeps the distance only; the time of the closest approach is not judged there
      nearest: a.at == null && a.nearestM != null ? { m: a.nearestM, t: null } : null,
      stayMs: a.stayMs ?? null,
      kmFromPrev: a.kmFromPrev ?? null,
      outcome: s.outcome ?? null,
      outcomeLabel: outcomeLabel(s.outcome),
      remarks: s.remarks ?? null,
      sequence: s.sequence,
      // The sheet's own columns, for the PDF's stop table
      stop: {
        code: s.customer?.code ?? '', name: s.customer?.name ?? '', location: s.customer?.location ?? '',
        invoice: s.invoiceNo ?? '', amount: s.amount ?? null, tonnage: s.tonnage ?? null,
      },
    };
  });
  const noTrack = !actual?.telemetry;
  return {
    key: `sheet:${plan.id}`,
    plate: plan.plate,
    vehicleId: plan.vehicleId ?? null,
    place: parked ? parked.label : place,
    lastAt,
    trip: {
      leftAt: actual?.leftAt ?? null,
      leftFrom: actual?.leftAt != null ? origin : null,
      arrivedAt: actual?.backAt ?? null,
      arrivedTo: actual?.backAt != null ? origin : null,
      need: false,
      inStorage: parked ? { key: parked.key, label: parked.label, short: parked.short ?? parked.label } : null,
      why: actual?.leftAt != null ? null
        : parked ? `At ${parked.label}`
        : why ?? (noTrack ? 'No telemetry for this sheet' : origin ? `Not seen leaving ${origin.label}` : 'Not seen at MORL/STO'),
    },
    customers,
    fulfilled: due.by === 'all' ? actual?.visited ?? 0 : customers.filter((c) => c.at != null).length,
    planned: customers.length,
    sheet: {
      planId: plan.id,
      planDate: plan.planDate,
      driverName: plan.driverName || null,
      km: actual?.km ?? null,
      durationMs: actual?.durationMs ?? null,
      outcomes: Object.fromEntries(OUTCOMES.map((o) => [o.id, customers.filter((c) => c.outcome === o.id).length])),
      open: customers.filter((c) => !c.outcome).length,
      // How the stops were picked, when not all of them: printed beside the sheet
      due: due.by === 'all' ? null : { by: due.by, count: customers.length, of: (plan.stops ?? []).length, days: days ?? [] },
    },
  };
}

/** "Sheet of 09.11, driver JOHN DOE, 163 km in 4 h 43 min": what the Planner adds to a row. */
export function sheetWords(r, kmWords) {
  const s = r.sheet;
  if (!s) return '';
  const [y, m, d] = String(s.planDate).split('-');
  return [`Sheet of ${d}.${m}.${y}`,
    ...(s.driverName ? [`driver ${s.driverName}`] : []),
    ...(s.km != null && s.durationMs != null ? [`${kmWords(s.km)} in ${spanWords(s.durationMs)}`] : []),
    ...(s.due ? [s.due.by === 'marked'
      ? `${s.due.count} of ${s.due.of} stops marked for ${s.due.days.map(shortDay).join(', ')}`
      : `${s.due.count} of ${s.due.of} stops left from other days`] : [])].join(', ');
}

/** "9 Full, 1 Rejected, 4 not marked": the office's marks on a sheet. */
export function outcomeWords(r) {
  const s = r.sheet;
  if (!s) return '';
  const parts = OUTCOMES.filter((o) => s.outcomes[o.id]).map((o) => `${s.outcomes[o.id]} ${o.label}`);
  if (s.open) parts.push(`${s.open} not marked`);
  return parts.join(', ');
}

/**
 * The Planner plan a vehicle added on the Deliveries list runs that day
 * (operator, 13 Nov 2026: KDM 138L's itinerary "with the routes configured"
 * should tick its geofences when the unit is picked): an uploaded sheet or
 * itinerary, not a plan keyed in on Deliveries itself, whose span (printing,
 * then 48 h) meets the day; the latest printed when there are several.
 * @param {object[]} plans  listPlans' rows
 * @param {string} plate
 * @param {string} day      the list's fleet day, 'YYYY-MM-DD'
 */
export function planForDay(plans, plate, day, dayStartOf, now = Date.now()) {
  const k = plateKey(plate);
  if (!k) return null;
  const from = dayStartOf(day);
  const mine = sheetsForWindow((plans ?? []).filter((p) => p.source !== 'manual' && plateKey(p.plate) === k), from, from + DAY, dayStartOf, now);
  return mine.sort((a, b) => planWindow(b, dayStartOf, now).from - planWindow(a, dayStartOf, now).from)[0] ?? null;
}

/**
 * A plan's stops as a Deliveries vehicle's: each stop's geofence, by the name
 * the stops picker knows it by, in route order; a stop whose fence is gone, or
 * that never had one, as a point named after its customer, to be fenced like
 * any added point (lib/pinFences).
 * @param {object} plan  getPlan's plan
 * @param {object} fc    the organisation's geofences
 * @param {Set<string>} [pickable]  the names the stops picker offers; a fence not among them is a point instead
 * @returns {{ names: string[], pins: Array<{ name, lat, lng, radiusM }> }}
 */
export function planStopsForList(plan, fc, pickable = null, radiusM = 100) {
  return stopsPicked(planStopChoices(plan, fc, pickable, radiusM));
}

/**
 * A plan's stops one by one, in route order, for picking some of them: each a
 * geofence by the stops picker's name, else a point (as planStopsForList). A
 * fence the route passes twice is offered once.
 * @returns {Array<{ key: string, label: string, name?: string, pin?: { name, lat, lng, radiusM } }>}
 */
export function planStopChoices(plan, fc, pickable = null, radiusM = 100) {
  const nameOf = new Map((fc?.features ?? []).map((f) => [f.properties?.id, String(f.properties?.name ?? '').trim()]));
  const out = [];
  const seen = new Set();
  const stops = [...(plan?.stops ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  stops.forEach((s, i) => {
    const c = s.customer ?? {};
    const name = c.geofenceId ? nameOf.get(c.geofenceId) : null;
    if (name && (!pickable || pickable.has(name))) {
      if (!seen.has(name)) { seen.add(name); out.push({ key: `n:${name}`, label: name, name }); }
      return;
    }
    if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
      const pin = { name: String(c.name ?? '').trim() || String(c.code ?? '').replace(/^\w+:/, ''), lat: c.lat, lng: c.lng, radiusM };
      out.push({ key: `p:${i}:${c.lat},${c.lng}`, label: pin.name || `${c.lat}, ${c.lng}`, pin });
    }
  });
  return out;
}

/** The stops chosen from planStopChoices, as a Deliveries vehicle's (all of them when `keys` is not given). */
export function stopsPicked(choices, keys = null) {
  const want = keys ? new Set(keys) : null;
  const got = (choices ?? []).filter((c) => !want || want.has(c.key));
  return { names: got.filter((c) => c.name).map((c) => c.name), pins: got.filter((c) => c.pin).map((c) => c.pin) };
}
