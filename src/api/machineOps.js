// KASULU machine operations — when plant starts, and how long it runs.
//
// Separate from operations-today's earlyDepartures, which counts tractor
// SIGN-OUTS. That is the yard's record and exists for every vehicle whether or
// not it carries a tracker; it is the right clock for a fleet of tractors and
// the wrong one for plant. An excavator is never signed out — it is switched on
// in a pit and works without going anywhere, so only its telemetry sees it.

import { apiFetch } from "../services/api";
import { resolveOrgId } from "./org";

/** Units that started work before 04:00 / 05:00 / 06:00 today, by category.
 *  Cumulative buckets — before05 includes before04. */
export async function getMachineStarts({ companyId } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  const res = await apiFetch(`/api/v1/organisations/${orgId}/analytics/machine-starts`);
  return res.data ?? null;
}

/** Hours actually run against the 18-hour day, by category.
 *  @param {{companyId: string, range?: 'day'|'week'|'month'}} opts */
export async function getMachineHours({ companyId, range = "day" } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/machine-hours?range=${encodeURIComponent(range)}`
  );
  return res.data ?? null;
}

/**
 * The week, for the summary card: average working hours, fleet distance, and
 * what was worked.
 *
 * It carries BLOCKS WORKED rather than area cleared. Converting ground covered
 * into ground cleared needs the width of the implement doing it, and nothing
 * records one — `vehicles.model` is empty on all 218 KASULU units. The server's
 * field is `blocksExtentHa`, deliberately not called an area: it is the size of
 * the blocks entered, and FARM#211 alone is 16,301 ha, so a machine crossing
 * its corner has cleared none of it.
 */
export async function getMachineSummary({ companyId, days = 7, to, categories, vehicles } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  const qs = new URLSearchParams({ days: String(days) });
  // `to` anchors the window on a past month or a custom range. Without it this
  // card always reported the trailing N days ending today — it was the one
  // component on the Analytics page the date picker could not move.
  if (to) qs.set("to", to);
  if (categories?.length) qs.set("categories", categories.join(","));
  if (vehicles?.length) qs.set("vehicles", vehicles.join(","));
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/machine-summary?${qs}`
  );
  return res.data ?? null;
}

/**
 * What machine families this fleet HAS, with unit counts — the vehicle-type
 * filter's options.
 *
 * Read from the fleet rather than hard-coded, because the vocabulary is
 * per-fleet: KASULU's plates carry a family (EX, CTR, DZ) and SUKARI's are
 * ordinary registrations that carry none. A fleet that answers with a single
 * category is telling the page to render no filter at all.
 */
export async function getVehicleCategories({ companyId } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  const res = await apiFetch(`/api/v1/organisations/${orgId}/analytics/vehicle-categories`);
  return res.data?.categories ?? null;
}

/**
 * Sales hauls out of the factory — tonnage per day and per unit.
 *
 * Passes the window but NOT `categories`, for the same reason getFleetState
 * does not: this answers at per-unit grain, so the page narrows it in the
 * browser and the server keeps one warm entry per window rather than one per
 * selection.
 */
export async function getSugarHauls({ companyId, days, to, categories, vehicles } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  const qs = new URLSearchParams();
  if (days) qs.set("days", String(days));
  if (to) qs.set("to", to);
  if (categories?.length) qs.set("categories", categories.join(","));
  if (vehicles?.length) qs.set("vehicles", vehicles.join(","));
  const q = qs.toString();
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/sugar-hauls${q ? `?${q}` : ""}`
  );
  return res.data ?? null;
}

/**
 * Where this fleet's units actually stop.
 *
 * Its own window rather than the page's: the pass behind it scans every fix in
 * the window, so the server offers 3, 7 and 14 days and nothing longer. Asking
 * for 90 would be answered with 7 and labelled 7, which is worse than not
 * asking — see the note in StopClusters.
 */
export async function getStopClusters({ companyId, days = 7 } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/stop-clusters?days=${days}`
  );
  return res.data ?? null;
}

/** Every unit's live state plus hours, stationary time and distance for today,
 *  the week and the month. */
export async function getFleetState({ companyId, days, to } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  // The WINDOW, so the per-unit totals (fuel litres above all) describe the
  // range the operator picked. Deliberately no `categories`: this answers at
  // per-unit grain, so the page narrows it in the browser and the server keeps
  // one warm entry per window rather than one per selection.
  const qs = new URLSearchParams();
  if (days) qs.set("days", String(days));
  if (to) qs.set("to", to);
  const q = qs.toString();
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/fleet-state${q ? `?${q}` : ""}`
  );
  return res.data ?? null;
}

/** Ground each excavator worked over, and the hours it spent. Defaults to the
 *  last COMPLETE fleet day — a day four hours old reports a quarter of a day's
 *  work while looking like a full result. */
export async function getExcavatorArea({ companyId, day } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  // Deliberately NOT given the vehicle filter. It returns one row per machine
  // with a vehicleId on each, so the page narrows it in the browser and this
  // stays on the server's warm cache — see lib/analyticsFilter.
  const qs = day ? `?day=${encodeURIComponent(day)}` : "";
  const res = await apiFetch(`/api/v1/organisations/${orgId}/analytics/excavator-area${qs}`);
  return res.data ?? null;
}

/**
 * Ground worked per fleet day, for the plant daily-activity heatmap.
 *
 * Plant only. A haulage fleet's daily card counts trips; an excavator completes
 * none, so this is the equivalent question for a machine that works without
 * going anywhere.
 */
export async function getAreaByDay({ companyId, days = 30, to, categories, vehicles } = {}) {
  const orgId = await resolveOrgId(companyId);
  const qs = new URLSearchParams({ days: String(days) });
  // Same anchor the delivery analytics take, so the heatmap and the figures
  // beside it describe the same month rather than drifting apart.
  if (to) qs.set("to", to);
  if (categories?.length) qs.set("categories", categories.join(","));
  if (vehicles?.length) qs.set("vehicles", vehicles.join(","));
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/excavator-area-days?${qs}`
  );
  return res?.data ?? null;
}

/**
 * Litres per hectare and per kilometre, day by day.
 *
 * Plant only. The two rates answer different questions for different machine
 * kinds, which is why they arrive together rather than as one series with a
 * unit attached.
 */
export async function getFuelRateSeries({ companyId, days = 30, to, categories, vehicles } = {}) {
  const orgId = await resolveOrgId(companyId);
  const qs = new URLSearchParams({ days: String(days) });
  if (to) qs.set("to", to);
  if (categories?.length) qs.set("categories", categories.join(","));
  if (vehicles?.length) qs.set("vehicles", vehicles.join(","));
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/fuel-rate-days?${qs}`
  );
  return res?.data ?? null;
}
