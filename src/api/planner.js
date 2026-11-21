// Planner: fleet-server modules/planner. A truck's delivery sheet for a day,
// its customers (each with a geofence of its own), and what happened at each
// stop (operator, 2026-11-11).

import { apiFetch } from '../services/api'

const base = (orgId) => `/api/v1/organisations/${orgId}/planner`

/** An .xlsx File as base64, the way the server reads it. */
export function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('The file could not be read.'))
    r.readAsDataURL(file)
  })
}

/** What the sheet holds and what saving it would do. Writes nothing. */
export async function previewSheet(orgId, { fileName, data }) {
  const res = await apiFetch(`${base(orgId)}/sheets/preview`, { method: 'POST', body: JSON.stringify({ fileName, data }) })
  return res.data
}

/** Save it: customers, their fences, the plan. `body` adds what the person corrected. */
export async function saveSheet(orgId, body) {
  const res = await apiFetch(`${base(orgId)}/sheets`, { method: 'POST', body: JSON.stringify(body) })
  return res.data
}

export async function listPlans(orgId, from, to) {
  const res = await apiFetch(`${base(orgId)}/plans?from=${from}&to=${to}`)
  return res.data
}

export async function getPlan(orgId, id) {
  const res = await apiFetch(`${base(orgId)}/plans/${id}`)
  return res.data
}

/**
 * Which Deliveries report a sheet is read on (operator, 2026-11-21): 'vs',
 * 'fg', or null for its truck's fleet group. Answers `{ id, list }`.
 */
export async function setPlanList(orgId, planId, list) {
  const res = await apiFetch(`${base(orgId)}/plans/${planId}/list`, { method: 'PATCH', body: JSON.stringify({ list }) })
  return res.data
}
/** Told to both Deliveries reports when a sheet moves, so the other one picks it up at once. */
export const PLAN_LIST_MOVED = 'planner:plan-list-moved'

/** `{ outcome?: 'FULL'|'PARTLY'|'REJECTED'|null, remarks?: string }` */
export async function updateStop(orgId, planId, stopId, body) {
  const res = await apiFetch(`${base(orgId)}/plans/${planId}/stops/${stopId}`, { method: 'PATCH', body: JSON.stringify(body) })
  return res.data
}

/**
 * A fence for a customer that has none: a circle `{ name, lat, lng, radiusM }`
 * drawn and tied to the customer. Answers `{ customerId, geofence }`.
 */
export async function fenceCustomer(orgId, customerId, body) {
  const res = await apiFetch(`${base(orgId)}/customers/${customerId}/fence`, { method: 'POST', body: JSON.stringify(body) })
  return res.data
}

/** Planner customers; `fenced`: only those tied to a geofence. */
export async function listCustomers(orgId, { q, fenced } = {}) {
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(fenced ? { fenced: 'true' } : {}) }).toString()
  const res = await apiFetch(`${base(orgId)}/customers${qs ? `?${qs}` : ''}`)
  return res.data
}

export async function deletePlan(orgId, id) {
  try {
    await apiFetch(`${base(orgId)}/plans/${id}`, { method: 'DELETE' })
  } catch (e) {
    // 204 has no body for apiFetch's res.json(): that is the success case
    if (!(e instanceof SyntaxError)) throw e
  }
}
