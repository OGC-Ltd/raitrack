// Reports › Fuel › Fuelling Plan (operator 2026-11-27): one day's approved
// work plans and vehicle requests against the fuellings at FactorySuite's
// pumps, worked out by fleet-server planner/fuelling-plan. The page shows the
// figures; the PDF is the server's, drawn with the logos as the Logbook's is.
// `{ factory: null }` for an organisation with no FactorySuite fuel plans.

import { apiFetch, apiFetchBlob } from '../services/api'

const base = (orgId) => `/api/v1/organisations/${orgId}/planner/fuelling-plan`

// One day, or `from`..`to` (operator 2026-11-27: "the date picker should allow a range"), at most 14 days.
export async function getFuellingPlan({ orgId, from, to = from, signal }) {
  const res = await apiFetch(`${base(orgId)}?${new URLSearchParams({ from, to })}`, { signal })
  return res.data ?? { factory: null, from, to }
}

/** The PDF: `{ blob, filename }`. */
export async function fuellingPlanPdf({ orgId, from, to = from }) {
  const { blob, filename } = await apiFetchBlob(`${base(orgId)}.pdf?${new URLSearchParams({ from, to })}`)
  return { blob, filename: filename ?? `Fuelling plan vs actual ${from}${to !== from ? ` to ${to}` : ''}.pdf` }
}
