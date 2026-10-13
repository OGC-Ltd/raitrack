// Unit usage review — fleet-server modules/usage-review. One unit over a chosen
// period: drive hours, distance, estimated fuel and the places it spent its
// time, with the full workbook (xlsx) and a short PDF.
//
// The review is built as a job on the server (it reads up to 92 days of Wialon
// history and names the places), so the first call usually answers
// `{ status: "running", stage, progress }` and the caller asks again until it
// is `ready` or `failed`.

import { apiFetch, apiFetchBlob } from '../services/api'

const base = (orgId, vehicleId) => `/api/v1/organisations/${orgId}/vehicles/${vehicleId}/usage-review`

/**
 * `cached`: only what is already built or building — `{ status: "none" }`
 * otherwise, and never a build started. A saved review of a period still open
 * comes back `outdated: true`.
 */
export async function getUsageReview({ orgId, vehicleId, from, to, fresh = false, cached = false, signal }) {
  const q = new URLSearchParams({ from, to, ...(fresh ? { fresh: '1' } : {}), ...(cached && !fresh ? { cached: '1' } : {}) })
  const res = await apiFetch(`${base(orgId, vehicleId)}?${q}`, { signal })
  return res.data
}

/** Save the review's workbook or PDF. `kmpl` overrides the vehicle's rate for the fuel estimate. */
export async function downloadUsageReview({ orgId, vehicleId, from, to, kind, kmpl, names, driver, fallbackName }) {
  // `names`: place id → Google's exact name, or { name, activity } where
  // Google says what the place is (Banking…), looked up by the page (the
  // server has no Google key), printed in the PDF and the workbook.
  const named = names && Object.keys(names).length ? { names: JSON.stringify(names) } : {}
  // `driver` names the PDF's subject; the workbook ignores it.
  const q = new URLSearchParams({ from, to, ...(kmpl ? { kmpl: String(kmpl) } : {}), ...named, ...(driver && kind === 'pdf' ? { driver } : {}) })
  const { blob, filename } = await apiFetchBlob(`${base(orgId, vehicleId)}/${kind}?${q}`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * What each named place is, read by OpenAI on the server from its exact name
 * (and Google's own type as a hint): `{ activities: { [name]: group | null } }`.
 * Names the model could not read are absent; the caller keeps its own guess.
 */
export async function getPlaceActivities({ orgId, vehicleId, places, signal }) {
  const res = await apiFetch(`${base(orgId, vehicleId)}/activities`, { method: 'POST', body: JSON.stringify({ places }), signal })
  return res.data
}

/**
 * One day's GPS fixes from the built review, for the Logbook's playback:
 * `{ date, points: [t ms, lat, lng, km/h, course|null, ignition 1/0/null][] }`.
 */
export async function getUsageReviewDay({ orgId, vehicleId, from, to, date, signal }) {
  const q = new URLSearchParams({ from, to, date })
  const res = await apiFetch(`${base(orgId, vehicleId)}/day?${q}`, { signal })
  return res.data
}
