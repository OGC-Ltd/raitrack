// FactorySuite's Plan submissions board for the Maintenance page
// (fleet-server planner/plan-submissions): per department and day, whether
// the work plan was sent by 16:00 the day before. `{ factory: null }` for an
// organisation that keeps no work plans.

import { apiFetch } from '../services/api'

export async function fetchPlanSubmissions(orgId, day, { signal } = {}) {
  const q = day ? `?day=${encodeURIComponent(day)}` : ''
  const res = await apiFetch(`/api/v1/organisations/${orgId}/planner/plan-submissions${q}`, { signal })
  return res.data
}
