import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../services/api'

/**
 * One unit's recorded day, ready to replay.
 *
 * Served by /vehicles/:id/playback, which is deliberately NOT the endpoint the
 * map's breadcrumb line uses. That one returns three columns for a static
 * polyline; this returns heading and speed per fix as well, because a marker
 * has to point somewhere and a readout has to say something.
 *
 * NOT cached, unlike the sibling hooks in this folder. A day is up to ~15,000
 * fixes and the payload for the busiest unit in the fleet is around 74 KB after
 * simplification — too big to spend the shared localStorage budget on, and
 * pointless to keep: nobody replays the same day twice in a session, and a day
 * that is still in progress would be served stale.
 */
export function useVehiclePlayback(orgId, vehicleId, day) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!orgId || !vehicleId || !day) { setData(null); return undefined }

    // A day change while the previous request is in flight must not leave the
    // later response racing the earlier one — the day picker is a spinner and
    // people hold the arrow down.
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setError(null)

    apiFetch(
      `/api/v1/organisations/${orgId}/vehicles/${vehicleId}/playback?day=${day}`,
      { signal: ctrl.signal },
    )
      .then(res => {
        if (ctrl.signal.aborted) return
        setData(res.data ?? null)
        setLoading(false)
      })
      .catch(err => {
        if (ctrl.signal.aborted || err?.name === 'AbortError') return
        setError(err?.message ?? 'Could not load that day')
        setData(null)
        setLoading(false)
      })

    return () => ctrl.abort()
  }, [orgId, vehicleId, day])

  return {
    data,
    points: data?.points ?? [],
    /**
     * What happened during the day, in time order — stops, drains, refuels,
     * zone crossings, speeding runs. Positions are deliberately absent; the
     * server has none to give (no event table on this fleet carries a
     * coordinate), so each one is placed on the track by its timestamp.
     */
    events: data?.events ?? [],
    loading,
    error,
  }
}
