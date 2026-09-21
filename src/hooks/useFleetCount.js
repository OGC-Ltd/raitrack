// Live vehicle count for the header brand logo. Snapshot-only (no SSE) — the
// fleet size is stable within a session. Hydrates instantly from the fleet cache
// that useFleetLive keeps warm (same `ft-fleet:<company>` key), then refreshes.
// Returns null until loaded (and for companies with no backend org), so the
// caller can fall back to the mock companyData count.

import { useState, useEffect } from 'react'
import { fetchSnapshot } from '../services/snapshot'
import { resolveOrgId } from '../api/org'
import { readCache } from '../services/cache'

const fleetCacheKey = (companyId) => `ft-fleet:${companyId}`

function cachedCount(companyId) {
  const c = companyId ? readCache(fleetCacheKey(companyId)) : null
  return Array.isArray(c) ? c.length : null
}

export function useFleetCount(companyId) {
  const [count, setCount] = useState(() => cachedCount(companyId))

  // Swap to the new company's cached count during render, so the header never
  // shows the previous company's vehicle count for a frame.
  const [stateCompanyId, setStateCompanyId] = useState(companyId)
  if (stateCompanyId !== companyId) {
    setStateCompanyId(companyId)
    setCount(cachedCount(companyId))
  }

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setCount(cachedCount(companyId))   // instant on mount / company switch

    resolveOrgId(companyId)
      .then(orgId => {
        if (!alive || !orgId) return
        return fetchSnapshot(orgId)
          .then(res => { if (alive) setCount(Array.isArray(res.data) ? res.data.length : null) })
      })
      .catch(() => { /* leave prior/cached value → caller falls back to mock count */ })

    return () => { alive = false }
  }, [companyId])

  return count
}
