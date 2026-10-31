// Driver analytics straight from the fleet-server DB — the /analytics/drivers
// endpoints. Turns the fleettrack company slug into a backend orgId (via
// /bootstrap, see api/org.js) and pulls the driver roster + per-driver deep
// analytics. Real persisted Trip + CargoManifest + FuelTheft + VehicleAlert
// rows — an unseeded company resolves to no org and returns empty, so the
// screen renders empty rather than fabricated numbers.

import { apiFetch, apiFetchBlob } from "../services/api";
import { resolveOrgId } from "./org";

const EMPTY_OVERVIEW = { drivers: [], details: {} };

/**
 * Batched driver analytics: the roster (sorted by tonnes, highest first) PLUS
 * every driver's deep analytics keyed by id, in one request. The server keeps
 * this payload warm in memory, so it returns instantly and selecting a driver
 * on the page is a pure in-memory lookup — no per-selection fetch.
 */
export async function getDriversOverview({ companyId, days = 90 } = {}) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return EMPTY_OVERVIEW;
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/drivers/overview?days=${days}`
  );
  return res.data ?? EMPTY_OVERVIEW;
}

/**
 * The driver scorecard and pay, by the molasses drivers' pay structure:
 * retainer, trip-wise pay, lunch, fuel, speed and safety per driver-day,
 * credited to whoever held the vehicle. `from` and `to` are fleet days
 * (YYYY-MM-DD), inclusive, at most 31 apart.
 */
export async function getDriverScores({ companyId, from, to }) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) return null;
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/analytics/driver-scores?from=${from}&to=${to}`
  );
  return res.data ?? null;
}

/**
 * The scorecard as a PDF, made on the server (fleet-server driver-score.pdf):
 * every driver in the period, or only `driverIds` when given.
 */
export async function downloadDriverScoresPdf({ companyId, from, to, driverIds = null }) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) throw new Error("This company has no backend organisation to report on");
  const q = new URLSearchParams({ from, to, ...(driverIds?.length ? { drivers: driverIds.join(",") } : {}) });
  const { blob, filename } = await apiFetchBlob(`/api/v1/organisations/${orgId}/analytics/driver-scores.pdf?${q}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `Driver scorecard ${from} to ${to}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
