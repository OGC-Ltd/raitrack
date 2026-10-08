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

export async function getUsageReview({ orgId, vehicleId, from, to, fresh = false, signal }) {
  const q = new URLSearchParams({ from, to, ...(fresh ? { fresh: '1' } : {}) })
  const res = await apiFetch(`${base(orgId, vehicleId)}?${q}`, { signal })
  return res.data
}

/** Save the review's workbook or PDF. `kmpl` overrides the vehicle's rate for the fuel estimate. */
export async function downloadUsageReview({ orgId, vehicleId, from, to, kind, kmpl, names, fallbackName }) {
  // `names`: place id → Google's exact name, looked up by the page (the
  // server has no Google key), printed in the PDF and the workbook.
  const named = names && Object.keys(names).length ? { names: JSON.stringify(names) } : {}
  const q = new URLSearchParams({ from, to, ...(kmpl ? { kmpl: String(kmpl) } : {}), ...named })
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
 * One day's GPS fixes from the built review, for the Logbook's playback:
 * `{ date, points: [t ms, lat, lng, km/h, course|null, ignition 1/0/null][] }`.
 */
export async function getUsageReviewDay({ orgId, vehicleId, from, to, date, signal }) {
  const q = new URLSearchParams({ from, to, date })
  const res = await apiFetch(`${base(orgId, vehicleId)}/day?${q}`, { signal })
  return res.data
}
