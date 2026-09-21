// Human place label for a coordinate — reverse-geocoded through the backend
// (/api/v1/reverse-geocode, OSM Nominatim behind a per-grid-cell disk cache).
// Client-side it caches per ~1.1 km grid cell in module memory + localStorage,
// so a moving vehicle refetches only when it crosses into a new cell and
// revisited cells (fixed routes!) cost nothing. Returns null until resolved —
// callers show the raw coordinates as the fallback.

import { useState, useEffect } from 'react'
import { apiFetch } from '../services/api'

// -v2 discards labels cached under the previous single-word format; keep in
// step with the server's key prefix in lib/geocode.ts.
const LS_KEY = 'ft-geocode-v2'
const LS_MAX = 600           // cap the localStorage cache; reset when exceeded

const mem = new Map()
let ls = null
function lsCache() {
  if (!ls) {
    try { ls = JSON.parse(localStorage.getItem(LS_KEY)) ?? {} } catch { ls = {} }
    if (Object.keys(ls).length > LS_MAX) ls = {}
  }
  return ls
}
function lsSave() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(ls)) } catch { /* quota */ }
}

const keyOf = (lat, lng) => `${lat.toFixed(2)},${lng.toFixed(2)}`

export function usePlaceName(lat, lng) {
  const key = lat != null && lng != null ? keyOf(lat, lng) : null
  const [place, setPlace] = useState(() =>
    key ? mem.get(key) ?? lsCache()[key] ?? null : null)

  useEffect(() => {
    if (!key) { setPlace(null); return }
    const cached = mem.get(key) ?? lsCache()[key]
    if (cached !== undefined && cached !== null) { setPlace(cached); return }
    let alive = true
    apiFetch(`/api/v1/reverse-geocode?lat=${lat}&lng=${lng}`)
      .then((res) => {
        const p = res.data?.place
        if (!p) return                       // unresolvable — keep coords fallback
        mem.set(key, p)
        lsCache()[key] = p
        lsSave()
        if (alive) setPlace(p)
      })
      .catch(() => { /* transient — coords fallback stays */ })
    return () => { alive = false }
    // lat/lng intentionally keyed by grid cell, not raw floats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return place
}
