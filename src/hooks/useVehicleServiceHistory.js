import { useState, useEffect } from 'react'
import { apiFetch } from '../services/api'
import { readCache, writeCache } from '../services/cache'

/**
 * Real, persisted service history for one vehicle — one row per completed
 * scheduled service. Powers the Maintenance page's service-history report.
 * Ported from fleetdash. Stale-while-revalidate: re-selecting a vehicle paints
 * its last-known history instantly while the fresh rows load.
 */
export function useVehicleServiceHistory(orgId, vehicleId) {
  const cacheKey = vehicleId ? `ft-svc:${vehicleId}` : null
  const [services, setServices] = useState(() => (cacheKey && readCache(cacheKey)) || [])
  const [loading, setLoading]   = useState(() => !(cacheKey && readCache(cacheKey)))

  useEffect(() => {
    if (!orgId || !vehicleId) return
    let alive = true

    const cached = readCache(`ft-svc:${vehicleId}`)
    if (cached) { setServices(cached); setLoading(false) }
    else { setServices([]); setLoading(true) }

    apiFetch(`/api/v1/organisations/${orgId}/vehicles/${vehicleId}/maintenance/services`)
      .then(res => {
        if (!alive) return
        const rows = res.data ?? []
        setServices(rows)
        setLoading(false)
        writeCache(`ft-svc:${vehicleId}`, rows)
      })
      .catch(() => { if (alive && !cached) { setServices([]); setLoading(false) } })

    return () => { alive = false }
  }, [orgId, vehicleId])

  return { services, loading }
}
