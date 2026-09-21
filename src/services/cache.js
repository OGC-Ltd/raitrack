// Tiny localStorage-backed cache for a stale-while-revalidate first paint.
//
// The server's fleet snapshot query is slow (several seconds on the remote
// pooler), so a cold load has nothing to show until it returns. The data hooks
// cache their last successful response here and hydrate from it synchronously on
// mount, so the app paints instantly with last-known state and then silently
// swaps in fresh data the moment the request lands (the live SSE stream keeps it
// current from there). Ported from fleetdash.
//
// Everything is best-effort: any failure (private mode, quota, corrupt JSON) is
// swallowed and treated as "no cache", so a bad entry can never break a load.

// Bump when a cached payload's MEANING changes, so browsers holding an older
// shape (or data since invalidated server-side) discard it instead of painting
// something stale. v2: the fleet no longer carries simulated positions — every
// vehicle is coordinate-less until RaiFactorySuite supplies real telemetry, and a
// v1 cache would otherwise resurrect retired positions as ghost map markers.
const CACHE_VERSION = 'v2'
const versioned = (key) => `${key}::${CACHE_VERSION}`

export function readCache(key) {
  try {
    const raw = localStorage.getItem(versioned(key))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeCache(key, value) {
  try {
    localStorage.setItem(versioned(key), JSON.stringify(value))
  } catch {
    /* private mode / quota exceeded — first paint just won't be cached */
  }
}
