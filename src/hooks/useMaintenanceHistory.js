import { useState, useEffect } from 'react'
import { apiFetch } from '../services/api'
import { readCache, writeCache } from '../services/cache'

// One cache entry per org + calendar selection, so the default all-months view
// AND any previously-viewed range both paint instantly on revisit.
const histCacheKey = (orgId, rangeStart, rangeEnd) =>
  `ft-hist:${orgId}:${rangeStart ?? 'all'}:${rangeEnd ?? 'all'}`

// Default view (no calendar selection): request a full year so the charts show
// activity across ALL months at once. 366 is the server's max single-request
// window (telemetry.controller's clamp).
const DEFAULT_HISTORY_DAYS = 366

function daysBetweenInclusive(startKey, endKey) {
  const start = new Date(`${startKey}T00:00:00Z`)
  const end   = new Date(`${endKey}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000) + 1
}

/**
 * Daily-bucketed, org-wide maintenance-relevant history (trips, distance, avg
 * speed, fuel consumed, overspeeding + fuel-inconsistency incidents) — see the
 * server's telemetry.repository findMaintenanceHistory. Ported from fleetdash.
 *
 * `range` is the calendar selection ({start,end} day-keys, or null for the
 * default all-months view). When set, requests double the selected span (the
 * period PLUS an equal preceding period) so the chart cards' "this vs previous"
 * half-split works for any range length.
 */
export function useMaintenanceHistory(orgId, range) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const rangeStart = range?.start ?? null
  const rangeEnd   = range?.end ?? null

  // Reset during render on an org/range change — the effect below runs after
  // paint, so the charts briefly showed the previous organisation's history,
  // and for an org with no cached history they kept showing it until the
  // request returned.
  const identity = histCacheKey(orgId, rangeStart, rangeEnd)
  const [stateIdentity, setStateIdentity] = useState(identity)
  if (stateIdentity !== identity) {
    const cached = readCache(identity)
    setStateIdentity(identity)
    setHistory(cached ?? [])
    setLoading(!cached)
  }

  useEffect(() => {
    if (!orgId) return
    let alive = true

    // Stale-while-revalidate: paint the last response for this org+range
    // immediately, then refresh below.
    const cached = readCache(histCacheKey(orgId, rangeStart, rangeEnd))
    if (cached) {
      setHistory(cached)
      setLoading(false)
    }

    const params = new URLSearchParams()
    if (rangeStart && rangeEnd) {
      const days = daysBetweenInclusive(rangeStart, rangeEnd) * 2
      params.set('days', String(days))
      params.set('to', rangeEnd)
    } else {
      params.set('days', String(DEFAULT_HISTORY_DAYS))
    }
    const qs = params.toString()

    const load = () =>
      apiFetch(`/api/v1/organisations/${orgId}/maintenance/history${qs ? `?${qs}` : ''}`)
        .then(res => {
          if (!alive) return
          const rows = res.data ?? []
          setHistory(rows)
          setLoading(false)
          writeCache(histCacheKey(orgId, rangeStart, rangeEnd), rows)
        })
        .catch(() => { if (alive) setLoading(false) })

    load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [orgId, rangeStart, rangeEnd])

  return { history, loading }
}
