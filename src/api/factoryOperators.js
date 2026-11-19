// The Drivers page's Operators tab: FactorySuite's machine operators through
// fleet-server planner/factory-operators, read off the work plans and the pump
// for `from`..`to` (both inclusive, at most 31 days). `{ factory: null }` for
// an organisation whose FactorySuite factory keeps no work plans.

import { apiFetch } from '../services/api'
import { resolveOrgId } from './org'

export async function getFactoryOperators({ companyId, from, to }) {
  const orgId = await resolveOrgId(companyId)
  if (!orgId) return { factory: null, from, to }
  const q = new URLSearchParams({ from, to })
  const res = await apiFetch(`/api/v1/organisations/${orgId}/planner/factory-operators?${q}`)
  return res.data ?? { factory: null, from, to }
}
