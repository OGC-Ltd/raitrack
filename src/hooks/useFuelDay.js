import { useEffect, useState } from 'react'
import { apiFetch } from '../services/api'
import { fleetDayBounds, fleetDayOf } from '../lib/fuelDay'

/**
 * One unit's fuel for one fleet day: its tank-ledger row, its refuels and its
 * flagged drops. Feeds the day breakdown in the fuel incident window; the
 * arithmetic is lib/fuelDay.
 *
 * The tank ledger is served per ORGANISATION, not per unit, so this reads the
 * whole fleet's row set and keeps one. That is the same request the Sensor
 * Monitor makes, cached server-side (warm for today, stored for past days), so
 * it costs a lookup rather than a recomputation. For a past day it is read as
 * the day stood at its end; today has no end yet, so it is read as of now.
 */
export function useFuelDay(orgId, vehicleId, day) {
  const [state, setState] = useState({ tank: null, fillings: [], drops: [], loading: false, error: null })

  useEffect(() => {
    if (!orgId || !vehicleId || !day) return undefined
    const ctrl = new AbortController()
    const { from, to } = fleetDayBounds(day)
    const isToday = day >= fleetDayOf(new Date().toISOString())
    const base = `/api/v1/organisations/${orgId}/fuel`
    const q = `vehicleId=${encodeURIComponent(vehicleId)}&from=${from}&to=${to}&limit=100`

    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.all([
      apiFetch(`${base}/tank-state${isToday ? '' : `?date=${day}`}`, { signal: ctrl.signal }),
      apiFetch(`${base}/fillings?${q}`, { signal: ctrl.signal }).catch(() => ({ data: [] })),
      apiFetch(`${base}/thefts?${q}`, { signal: ctrl.signal }).catch(() => ({ data: [] })),
    ])
      .then(([tankRes, fillRes, dropRes]) => {
        if (ctrl.signal.aborted) return
        setState({
          tank: (tankRes.data ?? []).find((r) => r.vehicleId === vehicleId) ?? null,
          fillings: fillRes.data ?? [],
          drops: dropRes.data ?? [],
          loading: false,
          error: null,
        })
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return
        setState((s) => ({ ...s, loading: false, error: err?.message ?? 'Could not load the day' }))
      })
    return () => ctrl.abort()
  }, [orgId, vehicleId, day])

  return state
}
