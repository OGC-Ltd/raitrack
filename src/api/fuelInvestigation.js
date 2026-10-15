import { apiFetch } from '../services/api'

/** A fuel alert's investigation map — see fleet-server fuel-investigation. */
export async function getTheftInvestigation(orgId, theftId, { signal } = {}) {
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/fuel/thefts/${encodeURIComponent(theftId)}/investigation`,
    { signal },
  )
  return res.data
}

/** A halted unit's investigation — its stop, route and drive zones. */
export async function getHaltInvestigation(orgId, dbVehicleId, sinceMs, { signal } = {}) {
  const since = new Date(sinceMs).toISOString()
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(dbVehicleId)}/halt-investigation?since=${encodeURIComponent(since)}`,
    { signal },
  )
  return res.data
}

/**
 * A unit's run from its factory — the yard it left, the dispatch's
 * destination and the planned road, its route, stops and drive zones.
 * `snap` also matches the route to roads (billed, so only when asked).
 */
export async function getTripInvestigation(orgId, dbVehicleId, { snap = false, signal } = {}) {
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(dbVehicleId)}/trip-investigation${snap ? '?snap=1' : ''}`,
    { signal },
  )
  return res.data
}
