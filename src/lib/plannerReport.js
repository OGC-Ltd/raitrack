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
 */
export function sheetRow(plan, actual, { place = null, lastAt = null, why = null } = {}) {
  const byId = new Map((actual?.stops ?? []).map((s) => [s.id, s]));
  const origin = actual?.origin ? { key: actual.origin.key, label: actual.origin.label, short: actual.origin.short } : null;
  const customers = (plan.stops ?? []).map((s) => {
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
    place,
    lastAt,
    trip: {
      leftAt: actual?.leftAt ?? null,
      leftFrom: actual?.leftAt != null ? origin : null,
      arrivedAt: actual?.backAt ?? null,
      arrivedTo: actual?.backAt != null ? origin : null,
      need: false,
      why: actual?.leftAt != null ? null
        : why ?? (noTrack ? 'No telemetry for this sheet' : origin ? `Not seen leaving ${origin.label}` : 'Not seen at MORL/STO'),
    },
    customers,
    fulfilled: actual?.visited ?? 0,
    planned: customers.length,
    sheet: {
      planId: plan.id,
      planDate: plan.planDate,
      driverName: plan.driverName || null,
      km: actual?.km ?? null,
      durationMs: actual?.durationMs ?? null,
      outcomes: Object.fromEntries(OUTCOMES.map((o) => [o.id, customers.filter((c) => c.outcome === o.id).length])),
      open: customers.filter((c) => !c.outcome).length,
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
    ...(s.km != null && s.durationMs != null ? [`${kmWords(s.km)} in ${spanWords(s.durationMs)}`] : [])].join(', ');
}

/** "9 Full, 1 Rejected, 4 not marked": the office's marks on a sheet. */
export function outcomeWords(r) {
  const s = r.sheet;
  if (!s) return '';
  const parts = OUTCOMES.filter((o) => s.outcomes[o.id]).map((o) => `${s.outcomes[o.id]} ${o.label}`);
  if (s.open) parts.push(`${s.open} not marked`);
  return parts.join(', ');
}
