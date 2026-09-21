import { useState, useEffect } from 'react'
import { apiFetch } from '../services/api'
import { readCache, writeCache } from '../services/cache'

/**
 * Real, persisted garage-visit history for one vehicle — one row per time it
 * was redirected to a garage because its service came due on the road. Merged
 * alongside scheduled services in the report. Ported from fleetdash.
 * Stale-while-revalidate, same as useVehicleServiceHistory.
 */
export function useVehicleGarageVisits(orgId, vehicleId) {
  const cacheKey = vehicleId ? `ft-visits:${vehicleId}` : null
  const [visits, setVisits]   = useState(() => (cacheKey && readCache(cacheKey)) || [])
  const [loading, setLoading] = useState(() => !(cacheKey && readCache(cacheKey)))

  useEffect(() => {
    if (!orgId || !vehicleId) return
    let alive = true

    const cached = readCache(`ft-visits:${vehicleId}`)
    if (cached) { setVisits(cached); setLoading(false) }
    else { setVisits([]); setLoading(true) }

    apiFetch(`/api/v1/organisations/${orgId}/vehicles/${vehicleId}/maintenance/garage-visits`)
      .then(res => {
        if (!alive) return
        const rows = res.data ?? []
        setVisits(rows)
        setLoading(false)
        writeCache(`ft-visits:${vehicleId}`, rows)
      })
      .catch(() => { if (alive && !cached) { setVisits([]); setLoading(false) } })

    return () => { alive = false }
  }, [orgId, vehicleId])

  return { visits, loading }
}
