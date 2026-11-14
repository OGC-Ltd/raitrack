// The Fuel page: FactorySuite's fuel module through fleet-server
// planner/factory-fuel — every machine-shift its work plans asked fuel for,
// the request each became, and what the pump issued, for `from`..`to` (both
// inclusive, at most 31 days). `{ factory: null }` for an organisation whose
// FactorySuite factory does not fuel by work plan.

import { apiFetch } from '../services/api'
import { resolveOrgId } from './org'

export async function getFactoryFuel({ companyId, from, to }) {
  const orgId = await resolveOrgId(companyId)
  if (!orgId) return { factory: null, from, to }
  const q = new URLSearchParams({ from, to })
  const res = await apiFetch(`/api/v1/organisations/${orgId}/planner/factory-fuel?${q}`)
  return res.data ?? { factory: null, from, to }
}
