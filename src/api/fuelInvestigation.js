import { apiFetch } from '../services/api'

/** A fuel alert's investigation map — see fleet-server fuel-investigation. */
export async function getTheftInvestigation(orgId, theftId, { signal } = {}) {
  const res = await apiFetch(
    `/api/v1/organisations/${orgId}/fuel/thefts/${encodeURIComponent(theftId)}/investigation`,
    { signal },
  )
  return res.data
}
