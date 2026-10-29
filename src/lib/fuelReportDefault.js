/**
 * Which unit Fuel › Report › Vehicle analytics opens on (operator, 2026-10-08):
 *
 *   1. the unit of the LATEST possible-theft case — a drain the server judged
 *      a siphon (lib/fuelReport isTheft), not ending on a dead probe, not
 *      dismissed and not reviewed away — over that case's fleet day;
 *   2. with no such case, the unit that covered the most ground today
 *      (fleet-state's distanceTodayKm), over today;
 *   3. otherwise nothing, and the page waits for a pick as before.
 *
 * Only the choice lives here; the screen sets the unit and the period from it
 * and executes, exactly as if the operator had.
 */

import { apiFetch } from "../services/api";
import { fleetDayKey } from "../hooks/useFuelEvents";
import { isTheft, DEAD_PROBE_ML } from "./fuelReport";

const DAY = 86_400_000;
/** How far back to look for a case, and how many pages of drains to read. */
const LOOKBACK_DAYS = 30;
const MAX_PAGES = 5;
/** Reviewers' conclusions that take a case off the table. */
const CLEARED = new Set(["DISMISSED", "NOT_THEFT", "PROBE_FAULT"]);

const dayStart = (key) => Date.parse(`${key}T00:00:00.000+03:00`);

/** A drain row that still stands as a possible theft. */
export function isOpenTheftCase(d) {
  if (!d || !isTheft(d)) return false;
  if (d.dismissedAt) return false;
  if (d.reviewStatus && CLEARED.has(d.reviewStatus)) return false;
  if (Number.isFinite(d.finalFuelLevelMl) && d.finalFuelLevelMl < DEAD_PROBE_ML) return false;
  return true;
}

/** The newest open case among `rows` for a unit in `known`, or null. */
export function latestCase(rows, known) {
  return [...rows]
    .filter((d) => isOpenTheftCase(d) && known.has(d.vehicleId))
    .sort((a, b) => Date.parse(b.beganAt) - Date.parse(a.beganAt))[0] ?? null;
}

/** The unit that covered the most ground today among `known`, or null. */
export function furthestUnit(units, known) {
  return (units ?? [])
    .filter((u) => known.has(u.vehicleId) && (u.distanceTodayKm ?? 0) > 0)
    .sort((a, b) => b.distanceTodayKm - a.distanceTodayKm)[0] ?? null;
}

/**
 * The default pick for `orgId`, or null:
 *   { unitId, from, to, reason: "theft", at, litres }  — the case's fleet day
 *   { unitId, from, to, reason: "distance", km }       — today, to now
 */
export async function pickDefaultUnit({ orgId, vehicleIds, now = Date.now() }) {
  const known = new Set(vehicleIds);
  if (!orgId || !known.size) return null;

  const from = new Date(now - LOOKBACK_DAYS * DAY).toISOString();
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const q = new URLSearchParams({ from, limit: "200", ...(cursor ? { cursor } : {}) });
    const res = await apiFetch(`/api/v1/organisations/${orgId}/fuel/thefts?${q}`);
    const hit = latestCase(res?.data ?? [], known);
    if (hit) {
      const t0 = dayStart(fleetDayKey(new Date(hit.beganAt)));
      const litres = (hit.cleanDropMl ?? hit.measuredDropMl ?? hit.stolenMl ?? 0) / 1000;
      return { unitId: hit.vehicleId, from: t0, to: Math.min(t0 + DAY, now), reason: "theft", at: Date.parse(hit.beganAt), litres };
    }
    if (!res?.hasNextPage || !res?.cursor) break;
    cursor = res.cursor;
  }

  const state = await apiFetch(`/api/v1/organisations/${orgId}/analytics/fleet-state`);
  const top = furthestUnit(state?.data?.units, known);
  if (top) return { unitId: top.vehicleId, from: dayStart(fleetDayKey(new Date(now))), to: now, reason: "distance", km: top.distanceTodayKm };
  return null;
}
