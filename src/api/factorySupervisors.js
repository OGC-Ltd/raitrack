// The Scorecard's Supervisors view: each FactorySuite supervisor's work plan
// lines with what the machine ran in each, through fleet-server
// planner/factory-supervisors, for `from`..`to` (both inclusive, at most 31
// days). `{ factory: null }` for an organisation whose FactorySuite factory
// keeps no work plans.

import { apiFetch } from '../services/api'
import { resolveOrgId } from './org'

export async function getFactorySupervisors({ companyId, from, to }) {
  const orgId = await resolveOrgId(companyId)
  if (!orgId) return { factory: null, from, to }
  const q = new URLSearchParams({ from, to })
  const res = await apiFetch(`/api/v1/organisations/${orgId}/planner/factory-supervisors?${q}`)
  return res.data ?? { factory: null, from, to }
}
