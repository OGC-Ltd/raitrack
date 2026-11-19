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
  const data = res.data ?? { factory: null, from, to }
  // A cancelled plan was withdrawn: its lines are not shifts, and a line of it
  // would pick up the request of the plan that replaced it (same machine, day
  // and shift). Operator 2026-11-19 on EX-12, 18 Nov: WP-261118-FAC cancelled,
  // WP-261118-FAC-3 approved, both shift 1 at 08:00.
  if (Array.isArray(data.lines)) data.lines = data.lines.filter((l) => String(l.planStatus ?? '').toUpperCase() !== 'CANCELLED')
  return data
}

/**
 * Each probed machine's tank day by day over `from`..`to` (fleet days):
 * [{ vehicleId, day, openingL, closingL, fillL, drainL }], for the Consumed
 * column (lib/factoryFuel withConsumed). fleet-server planner tank-days.
 */
export async function getTankDays({ companyId, from, to }) {
  const orgId = await resolveOrgId(companyId)
  if (!orgId) return []
  const q = new URLSearchParams({ from, to })
  const res = await apiFetch(`/api/v1/organisations/${orgId}/planner/factory-fuel/tank-days?${q}`)
  return res.data ?? []
}

/**
 * One machine's fuellings over `from`..`to` with what only the tracker knows
 * (fleet-server planner fuel-refills): the meter either side of each fuelling
 * and the fuel burned in the shift it was for. For the machine panel's
 * Refills (lib/factoryFuel refillFigures).
 * `{ refills: [{ issueId, tracked, meterBefore, meterAfter, shift }] }`.
 */
export async function getFuelRefills({ companyId, from, to, machine }) {
  const orgId = await resolveOrgId(companyId)
  if (!orgId) return { refills: [] }
  const q = new URLSearchParams({ from, to, machine })
  const res = await apiFetch(`/api/v1/organisations/${orgId}/planner/factory-fuel/refills?${q}`)
  return res.data ?? { refills: [] }
}

/** Pages of fillings read at most: 200 a page, so up to 6,000 in a period. */
const MAX_FILL_PAGES = 30

/**
 * The fillings the fuel probes recorded over the same days (fleet-server
 * fuel/fillings, the ledger the Fuel Metrics page reads), for the pump against
 * probe check (lib/factoryFuel reconcileFills). `from`/`to` are fleet days;
 * the window is those days in full, first to last, in
 * Nairobi time, so the probe totals cover the same days as the pump.
 */
export async function getProbeFillings({ companyId, from, to }) {
  const orgId = await resolveOrgId(companyId)
  if (!orgId) return []
  const start = new Date(`${from}T00:00:00+03:00`).toISOString()
  const end = new Date(Date.parse(`${to}T00:00:00+03:00`) + 86_400_000).toISOString()
  const out = []
  let cursor = null
  for (let page = 0; page < MAX_FILL_PAGES; page++) {
    const q = new URLSearchParams({ from: start, to: end, limit: '200', ...(cursor ? { cursor } : {}) })
    const res = await apiFetch(`/api/v1/organisations/${orgId}/fuel/fillings?${q}`)
    out.push(...(res.data ?? []))
    cursor = res.meta?.cursor ?? null
    const more = Boolean(res.meta?.hasNextPage)
    if (!more || !cursor) break
  }
  return out
}
