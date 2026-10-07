// Fuel performance review — every unit's refills against its register
// standard, computed on the server (fuel-performance-review.ts). `from`/`to`
// are fleet-day keys (YYYY-MM-DD), both inclusive; omitted, the server reads
// the 90 days ending yesterday.

import { apiFetch } from "../services/api";

export async function getPerformanceReview({ orgId, from, to } = {}) {
  if (!orgId) return null;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const res = await apiFetch(`/api/v1/organisations/${orgId}/fuel/performance-review?${qs}`);
  return res.data ?? null;
}

export async function getUnitPerformance({ orgId, vehicleId, from, to } = {}) {
  if (!orgId || !vehicleId) return null;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const res = await apiFetch(`/api/v1/organisations/${orgId}/fuel/performance-review/vehicles/${vehicleId}?${qs}`);
  return res.data ?? null;
}

/** The same review, addressed by the app's company id ("kasulu") as the analytics feeds are. */
export async function getPerformanceReviewForCompany({ companyId, from, to } = {}) {
  const { resolveOrgId } = await import("./org");
  const orgId = await resolveOrgId(companyId);
  return orgId ? getPerformanceReview({ orgId, from, to }) : null;
}
