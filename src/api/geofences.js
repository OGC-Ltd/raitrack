// Geofences — fleet-server modules/geofences. Used by the Logbook map's fence
// tool to add the areas inside a site (yard, weighbridge, workshop) that the
// provider's zones do not have.
//
// Rings travel as [lng, lat] pairs, closed (the last point repeats the first):
// the order the server stores and reads them in, and what PostGIS expects of
// the derived shape.

import { apiFetch } from '../services/api'

const base = (orgId) => `/api/v1/organisations/${orgId}/geofences`

/** Draw a polygon fence. `points`: [{ lat, lng }, …], open; closed here. */
export async function createFence(orgId, { name, points }) {
  const ring = points.map((p) => [round(p.lng), round(p.lat)])
  ring.push(ring[0])
  const res = await apiFetch(base(orgId), {
    method: 'POST',
    body: JSON.stringify({ type: 'POLYGON', name, polygonCoords: ring }),
  })
  return res.data
}

export async function renameFence(orgId, id, name) {
  const res = await apiFetch(`${base(orgId)}/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
  return res.data
}

export async function deleteFence(orgId, id) {
  try {
    await apiFetch(`${base(orgId)}/${id}`, { method: 'DELETE' })
  } catch (e) {
    // The server answers 204 with no body, which apiFetch's res.json() cannot
    // read. That is the success case, not a failure.
    if (!(e instanceof SyntaxError)) throw e
  }
}

/** ~1 cm: enough for a fence, and keeps the stored ring readable. */
const round = (v) => Math.round(v * 1e7) / 1e7
