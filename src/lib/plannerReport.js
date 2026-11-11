// The Planner's sheets on the Deliveries report (operator, 2026-11-11: "the
// planner already tracks, we just need to render a report on the deliveries
// report"). Nothing is tracked again here: each sheet runs through the same
// planActual the Planner's plan view runs, over the same span, and comes out
// as a Deliveries row, so the table, the typed orders, CSV, PDF and JPEG all
// take it as they take a hand-listed vehicle.
//
// Pure: no React, no network.

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
 * TEMPORARY (operator, 11 Nov 2026: "show everything from the planner atm"):
 * every sheet the Planner lists over its default range, the last
 * ALL_SHEETS_DAYS days to the window's end, not only those whose 48 hours meet
 * the window. Each is still read over its own span, so its row matches the
 * Planner. Set ALL_SHEETS to false to go back to sheetsForWindow alone.
 */
export const ALL_SHEETS = true;
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
      label: [s.customer?.code, s.customer?.name].filter(Boolean).join(' '),
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
