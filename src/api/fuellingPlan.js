// Reports › Fuel › Fuelling Plan (operator 2026-11-27): one day's approved
// work plans and vehicle requests against the fuellings at FactorySuite's
// pumps, worked out by fleet-server planner/fuelling-plan. The page shows the
// figures; the PDF is the server's, drawn with the logos as the Logbook's is.
// `{ factory: null }` for an organisation with no FactorySuite fuel plans.

import { apiFetch, apiFetchBlob } from '../services/api'

const base = (orgId) => `/api/v1/organisations/${orgId}/planner/fuelling-plan`

export async function getFuellingPlan({ orgId, day, signal }) {
  const res = await apiFetch(`${base(orgId)}?${new URLSearchParams({ day })}`, { signal })
  return res.data ?? { factory: null, day }
}

/** The day's PDF: `{ blob, filename }`. */
export async function fuellingPlanPdf({ orgId, day }) {
  const { blob, filename } = await apiFetchBlob(`${base(orgId)}.pdf?${new URLSearchParams({ day })}`)
  return { blob, filename: filename ?? `Fuelling plan vs actual ${day}.pdf` }
}
