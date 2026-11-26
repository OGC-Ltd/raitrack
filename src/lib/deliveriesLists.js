// Van Sales and Finished Goods on one day's Deliveries list.
//
// The day's list on the server holds both reports' vehicles: one added on
// Van Sales carries `list: 'vs'`; one without a tag (every list kept before the
// split) is Finished Goods'. A unit can be on both lists on the same day, each
// entry with its own stops (operator, 2026-11-25: "we need the unit for that
// day to have its vs records, but for FG it judges its own stops ... vs was
// planned 11 routes on vs but on fg the vs car was planned 2 routes, on fg
// should focus and only display the two routes attached to it").
//
// So each report reads and judges only its own entry: nothing on the other
// list, and no Planner sheet of the other report, stands in for it or adds
// stops to it.
//
// Pure: no React, no network.

import { plateKey } from './plannerReport';

/** The report a day-list vehicle is on: 'vs', or 'fg' (also the untagged lists kept before). */
export const listOf = (v) => (v?.list === 'vs' ? 'vs' : 'fg');

/** The vehicle tagged for `list`: 'vs' carries the tag, FG goes untagged, as every list before. */
export const tagList = (v, list) => {
  const { list: _was, ...rest } = v; // eslint-disable-line no-unused-vars
  return list === 'vs' ? { ...rest, list: 'vs' } : rest;
};

/** One report's view of the day's whole list: its own entries only. */
export const listView = (full, list) => ({ ...full, vehicles: (full?.vehicles ?? []).filter((v) => listOf(v) === list) });

/**
 * The day's whole list after one report's list changed: the other report's
 * entries are kept as they are, the same unit's included.
 * @param {object} full  the day's whole list, { vehicles }
 * @param {'vs'|'fg'} list  the report that changed
 * @param {object} next  that report's list as it is now, { vehicles }
 */
export const withList = (full, list, next) => ({
  ...next,
  vehicles: [...(full?.vehicles ?? []).filter((v) => listOf(v) !== list), ...next.vehicles.map((v) => tagList(v, list))],
});

/** The report a Planner plan is read on: its own `list`, else its truck's fleet group. */
export const planList = (plan, groupOf) => plan?.list ?? (groupOf(plan) === 'Van Sales' ? 'vs' : 'fg');

/** The Planner plans one report reads: a sheet of the other report never adds stops to this one's. */
export const plansOnList = (plans, list, groupOf) => (plans ?? []).filter((p) => planList(p, groupOf) === list);

/**
 * The listed vehicles a report judges from their own stops. A Planner sheet
 * stands in for a vehicle only when that sheet is read on the same report: a
 * Van Sales itinerary never replaces the unit's Finished Goods line.
 * @param {object[]} vehicles  the report's list for a day
 * @param {string[]} sheetPlates  the plates of the sheets this report reads for that day
 */
export function judgedOnList(vehicles, sheetPlates) {
  const onSheets = new Set((sheetPlates ?? []).map(plateKey));
  return (vehicles ?? []).filter((v) => !onSheets.has(plateKey(v.plate)));
}
