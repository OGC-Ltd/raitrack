// Deliveries report: fleet-server modules/deliveries. The list of vehicles
// shared on a day (each with its stops) and the orders typed over the report's
// count, kept on the server and read through its Redis cache (operator,
// 11 Nov 2026: "we don't want it to be kept in the browser").

import { apiFetch } from '../services/api'

const base = (orgId) => `/api/v1/organisations/${orgId}/deliveries`

/** { day, vehicles, updatedAt }; an empty list for a day nobody has filled. */
export async function getDeliveryDay(orgId, day) {
  const res = await apiFetch(`${base(orgId)}/days/${day}`)
  return res.data
}

/** Save the whole list for the day; returns it as stored. */
export async function saveDeliveryDay(orgId, day, vehicles) {
  const res = await apiFetch(`${base(orgId)}/days/${day}`, { method: 'PUT', body: JSON.stringify({ vehicles }) })
  return res.data
}

/** The latest earlier day with vehicles on it (two weeks back at most), or null. */
export async function lastDeliveryDayBefore(orgId, day) {
  const res = await apiFetch(`${base(orgId)}/days?before=${day}`)
  return res.data
}

/** { plate: "8/10" }: the last count typed for each plate. */
export async function getDeliveryOrders(orgId) {
  const res = await apiFetch(`${base(orgId)}/orders`)
  return res.data ?? {}
}

/** Keep one plate's typed count; an empty text forgets it. */
export async function saveDeliveryOrder(orgId, plate, text) {
  const res = await apiFetch(`${base(orgId)}/orders/${encodeURIComponent(plate)}`, { method: 'PUT', body: JSON.stringify({ text }) })
  return res.data ?? {}
}
