// Live fleet for the active company, straight from the fleet-server DB — mirrors
// fleetdash's useFleet: seed from GET /vehicles/snapshot, then keep positions
// current from the org-wide SSE 'position' stream. Returns the same vehicle shape
// FleetMap already renders (see lib/vehicleMap), so the map is a drop-in swap for
// the old mock getVehicles().
//
// First paint is instant: the last snapshot for each company is cached in
// localStorage and hydrated synchronously, so a reload/tab-revisit shows the
// fleet immediately and then silently swaps in fresh data + the live stream
// (the snapshot read itself is several seconds on the remote pooler).

import { useState, useEffect, useRef, useCallback } from 'react'
import { sseUrl } from '../services/api'
import { fetchSnapshot } from '../services/snapshot'
import { resolveOrgId } from '../api/org'
import { mapSnapshotVehicle, applyLiveUpdate, applyConnectionRefresh } from '../lib/vehicleMap'
import { readCache, writeCache } from '../services/cache'

const fleetCacheKey = (companyId) => `ft-fleet:${companyId}`
const orgCacheKey   = (companyId) => `ft-org:${companyId}`
const feedCacheKey  = (companyId) => `ft-feed:${companyId}`

function indexById(list) {
  const byId = {}
  for (const v of list) byId[v.vehicleId] = v
  return byId
}

/**
 * How much activity the panel keeps.
 *
 * Deliberately far more than the 40 the server replays on connect, because the
 * two numbers answer different questions. The replay is "what happened most
 * recently"; this is "what this operator has seen". Matching them meant a
 * refresh could only ever show the newest 40 events, and on a fleet where one
 * event type dominates that is the same 40 every time — SUKARI's newest 40 are
 * 37 fuel items, so an hour's worth of accumulated TRACTOR_OVERDUE and driver
 * changes vanished on reload while the fuel stayed. Keeping a longer tail is
 * what lets the minority events survive alongside a noisy majority.
 */
const MAX_FEED_ITEMS = 200

/**
 * How long a persisted feed stays useful. Older than this and the operator is
 * better served by the server's replay than by yesterday's screen.
 */
const FEED_CACHE_MAX_AGE_MS = 12 * 60 * 60_000

/** Coalescing window for feed writes — see scheduleFeedPersist. */
const FEED_PERSIST_DEBOUNCE_MS = 2_000

/**
 * Most of the list any ONE kind of event may occupy.
 *
 * A plain newest-N cap cannot keep a mixed feed mixed when the emitters are
 * this lopsided. KASULU produces about thirteen zone crossings a minute, so
 * 200 slots is roughly fifteen minutes — a fuel drop from an hour ago is
 * evicted by sheer volume, and no amount of extra capacity fixes that, it only
 * moves the cliff. SUKARI has the same problem mirrored, with fuel as the
 * majority and driver/dispatch alerts as the casualties.
 *
 * Reserving the remainder for everything else is what makes "do not discard the
 * other notifications" actually hold. The cost is that the list can show a
 * chronological GAP — recent zone crossings, then a jump back to an older fuel
 * event — which is a fair trade against not showing the fuel event at all.
 */
const MAJORITY_SHARE = 0.6

/** Newest first, nothing older than the horizon, and no type hogging the list. */
function pruneFeed(items) {
  const floor = Date.now() - FEED_CACHE_MAX_AGE_MS
  const sorted = items
    .filter(i => i && i.id && (Date.parse(i.ts) || 0) >= floor)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))

  if (sorted.length <= MAX_FEED_ITEMS) return sorted

  // Take newest-first, but stop admitting a type once it holds its share.
  const perType  = Math.ceil(MAX_FEED_ITEMS * MAJORITY_SHARE)
  const counts   = new Map()
  const kept     = []
  const overflow = []
  for (const it of sorted) {
    if (kept.length >= MAX_FEED_ITEMS) break
    const t = it.alertType || it.source || 'other'
    const n = counts.get(t) || 0
    if (n < perType) { counts.set(t, n + 1); kept.push(it) }
    else overflow.push(it)
  }

  // A feed with only ONE type must still fill the panel — otherwise reserving
  // space for events that do not exist would just show less.
  if (kept.length < MAX_FEED_ITEMS) {
    for (const it of overflow) {
      if (kept.length >= MAX_FEED_ITEMS) break
      kept.push(it)
    }
    kept.sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
  }
  return kept
}

/**
 * Merge one SSE feed item into the panel's list: keyed by `id`, ordered by
 * EVENT time, capped.
 *
 * This used to be `[item, ...prev].slice(0, MAX)` — a blind prepend, which was
 * wrong in two ways once fuel events joined the feed.
 *
 * **Identity.** Both panels render `key={item.id}`, so any republished item put
 * two siblings with the same React key in the list; React keeps the first and
 * stops updating the rest, which is why the feed appeared to freeze until a
 * page reload. Three things republish: the SSE reconnect replay (EventSource
 * reconnects internally, so the effect never re-runs and never clears `feed`,
 * yet the server replays 40 items on every connect), the fuel sync (it
 * publishes by event AGE, so one filling is re-emitted on each cycle inside its
 * 2-hour window), and any reconcile pass re-surfacing a provider alert. Keying
 * by id makes all three idempotent: a republish REPLACES its item — which is
 * also what makes a corrected volume or a resolved plate land in place.
 *
 * **Order.** Every other emitter publishes with `at ≈ now`, so arrival order
 * was event order. Wialon only recognises a filling once settled readings
 * follow it, so a fuel item arrives with a timestamp up to two hours old and a
 * prepend put it ABOVE events from thirty seconds ago — then a reload, which
 * replays in server-side score order, silently moved it back down. Sorting on
 * `ts` here means the live list and the replayed list agree.
 *
 * `ts` is always an ISO-8601 UTC string (`Date.toISOString()` server-side), so
 * a lexical compare is a chronological one — no Date parsing per comparison.
 */
function mergeFeedItem(prev, item) {
  const byId = new Map(prev.map(i => [i.id, i]))
  byId.set(item.id, item)
  // pruneFeed owns ordering, the age horizon and the per-type share, so the
  // live path and the rehydrated path cannot drift apart.
  return pruneFeed([...byId.values()])
}

// How often to re-read the snapshot purely to refresh ONLINE/OFFLINE.
//
// The provider's verdict flaps on a scale of a minute or two — DZ 08 went
// true -> false inside 90 s — so anything much slower shows a stale badge, and
// anything much faster just re-reads a 190 KB payload for no new information.
const CONNECTION_REFRESH_MS = 60_000

export function useFleetLive(companyId) {
  // Hydrate the very first render synchronously from cache (no blank frame).
  const [vehicles, setVehicles] = useState(() => (companyId && readCache(fleetCacheKey(companyId))) || [])
  // Live activity feed — real fleet events (dispatch/arrival/offload/fuel/
  // alerts) streamed as SSE 'feed' events, merged over what this browser has
  // already seen.
  //
  // Persisted, and hydrated synchronously here, for the same reason the fleet
  // is: a reload must not blank it. But the feed needs it more than the fleet
  // does, because the server's replay is only the newest 40 events and a fleet
  // with one dominant event type spends all 40 on it — SUKARI's newest 40 are
  // 37 fuel items, KASULU's are 40 zone crossings. Without this, every refresh
  // discarded the sparse TRACTOR_OVERDUE / driver-change / breach items the
  // operator actually cares about and replaced them with more of the majority.
  const [feed, setFeed] = useState(() => (companyId && pruneFeed(readCache(feedCacheKey(companyId)) || [])) || [])
  const [orgId, setOrgId]       = useState(() => (companyId && readCache(orgCacheKey(companyId))) || null)
  const [loading, setLoading]   = useState(() => !(companyId && readCache(fleetCacheKey(companyId))))
  const [error, setError]       = useState(null)
  const [retryToken, setRetryToken] = useState(0)
  const retry = useCallback(() => setRetryToken(t => t + 1), [])

  // vehicleId (cuid) → mapped vehicle. Seeded from cache so live SSE events can
  // merge onto the cached fleet before the fresh snapshot lands.
  const byIdRef = useRef(indexById((companyId && readCache(fleetCacheKey(companyId))) || []))

  // Which company the state above currently describes.
  //
  // Resetting on an org switch inside the effect is too late: effects run AFTER
  // render, so the first paint of the new company showed the PREVIOUS
  // company's fleet, and `orgId` still pointed at the old org — long enough for
  // dependent hooks to fetch the wrong organisation's data. Adjusting state
  // during render (React re-runs the component immediately, before painting)
  // means the previous org's rows are never displayed at all.
  const [stateCompanyId, setStateCompanyId] = useState(companyId)
  if (stateCompanyId !== companyId) {
    const cached = (companyId && readCache(fleetCacheKey(companyId))) || []
    byIdRef.current = indexById(cached)
    setStateCompanyId(companyId)
    setVehicles(cached)                                                  // never inherit the old fleet
    setOrgId((companyId && readCache(orgCacheKey(companyId))) || null)   // nor the old orgId
    // Never inherit the old company's activity either — but load THIS one's,
    // rather than blanking, so switching back and forth does not destroy it.
    setFeed((companyId && pruneFeed(readCache(feedCacheKey(companyId)) || [])) || [])
    setLoading(cached.length === 0)
    setError(null)
  }

  useEffect(() => {
    if (!companyId) return
    let alive = true
    let es = null
    let pending = false
    let connTimer = null
    let feedPersistTimer = null
    let feedToPersist = null

    // Persisting on every item would re-serialise the whole list on each SSE
    // frame, and KASULU emits a zone crossing every few seconds — localStorage
    // writes are synchronous and block the main thread. Coalesce instead; the
    // only cost of the delay is losing the last couple of seconds of feed on a
    // hard crash, which the server's replay restores anyway.
    const scheduleFeedPersist = (items) => {
      feedToPersist = items
      if (feedPersistTimer) return
      feedPersistTimer = setTimeout(() => {
        feedPersistTimer = null
        if (alive && feedToPersist) writeCache(feedCacheKey(companyId), feedToPersist)
      }, FEED_PERSIST_DEBOUNCE_MS)
    }

    // Stale-while-revalidate: paint this company's cached fleet immediately (also
    // covers org switches, where the initial useState no longer re-runs), then
    // refresh from the network below.
    //
    // The feed is NOT cleared here. It used to be, on the theory that the
    // server replays history on connect — but that replay is the newest 40
    // events, and on a fleet dominated by one event type it is 40 of that type,
    // so clearing threw away every sparse event the operator had accumulated.
    // The replay is merged onto what is already here instead; mergeFeedItem
    // dedupes by id, so anything the replay repeats is an update, not a copy.
    setFeed(prev => pruneFeed(prev.length ? prev : (readCache(feedCacheKey(companyId)) || [])))

    const cached = readCache(fleetCacheKey(companyId))
    if (cached && cached.length) {
      byIdRef.current = indexById(cached)
      setVehicles(cached)
      setLoading(false)
    } else {
      // Clear explicitly. Omitting setVehicles([]) here left the PREVIOUS
      // company's fleet on screen for any org with no cached snapshot, right
      // up until the network answered.
      byIdRef.current = {}
      setVehicles([])
      setLoading(true)
    }
    setError(null)

    // Coalesce a burst of position events (one per vehicle each poll cycle) into
    // a single state update per frame.
    const flush = () => { pending = false; if (alive) setVehicles(Object.values(byIdRef.current)) }
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(flush) } }

    resolveOrgId(companyId)
      .then(orgId => {
        if (!alive) return
        setOrgId(orgId)
        if (!orgId) { byIdRef.current = {}; setVehicles([]); setLoading(false); return }
        writeCache(orgCacheKey(companyId), orgId)

        return fetchSnapshot(orgId).then(res => {
          if (!alive) return
          const list = Array.isArray(res.data) ? res.data : []
          const byId = {}
          for (const v of list) {
            const mv = mapSnapshotVehicle(v)
            byId[mv.vehicleId] = mv
          }
          byIdRef.current = byId
          const mapped = Object.values(byId)
          setVehicles(mapped)
          setLoading(false)
          writeCache(fleetCacheKey(companyId), mapped)   // refresh cache for next paint

          es = new EventSource(sseUrl(`/api/v1/organisations/${orgId}/live`))
          es.addEventListener('feed', (e) => {
            try {
              const item = JSON.parse(e.data)
              // The server scopes the feed per org; drop anything else that
              // slips through (e.g. a replay raced by an org switch).
              if (item.orgId && item.orgId !== orgId) return
              setFeed(prev => {
                const next = mergeFeedItem(prev, item)
                scheduleFeedPersist(next)
                return next
              })
            } catch { /* ignore malformed frame */ }
          })
          es.addEventListener('position', (e) => {
            try {
              const data = JSON.parse(e.data)
              const existing = byIdRef.current[data.vehicleId]
              if (!existing) return // vehicle not in this org's snapshot
              byIdRef.current[data.vehicleId] = applyLiveUpdate(existing, data)
              schedule()
            } catch { /* ignore malformed frame */ }
          })
          // EventSource reconnects on its own; nothing to do on error.

          // Connection verdicts do NOT arrive on the stream for the vehicles
          // that matter most. A position frame is emitted only when a unit's
          // fix time advances, so a parked unit stops emitting and its
          // ONLINE/OFFLINE freezes at whatever it was when the page loaded —
          // DZ 02 sat on a 03:50:16 position while its netconn flipped
          // true/false for another ten minutes, reading OFFLINE against an API
          // saying online until a reload. Re-read the snapshot on a slow timer
          // and take the verdict from it, nothing else.
          //
          // The snapshot is ~1.2 s / 190 KB for 218 vehicles, so a minute is
          // cheap; it is also the same request the first paint already makes,
          // so there is no new endpoint to keep in step.
          connTimer = setInterval(() => {
            fetchSnapshot(orgId)
              .then(res => {
                if (!alive) return
                const rows = Array.isArray(res.data) ? res.data : []
                let changed = 0
                for (const row of rows) {
                  const existing = byIdRef.current[row.vehicleId]
                  if (!existing) continue
                  const next = applyConnectionRefresh(existing, row)
                  if (next !== existing) { byIdRef.current[row.vehicleId] = next; changed++ }
                }
                if (changed) {
                  schedule()
                  writeCache(fleetCacheKey(companyId), Object.values(byIdRef.current))
                }
              })
              .catch(() => { /* transient — the next tick retries */ })
          }, CONNECTION_REFRESH_MS)
        })
      })
      .catch(err => { if (alive) { setError(err); setLoading(false) } })

    return () => {
      alive = false
      if (es) es.close()
      if (connTimer) clearInterval(connTimer)
      // FLUSH rather than cancel. A pending write dropped here is exactly the
      // case that matters — closing the tab or switching org is when the feed
      // most needs to have been saved, and the debounce means there is almost
      // always something in flight.
      if (feedPersistTimer) clearTimeout(feedPersistTimer)
      if (feedToPersist) writeCache(feedCacheKey(companyId), feedToPersist)
    }
  }, [companyId, retryToken])

  return { vehicles, orgId, loading, error, retry, feed }
}
