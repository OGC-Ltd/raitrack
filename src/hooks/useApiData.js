// Fetch hook with loading/error/retry state, and optional polling.
//
// Pass options.cacheKey to get stale-while-revalidate: the last successful
// response is kept in localStorage and hydrated synchronously on mount, so a
// tab switch or reload paints instantly with last-known data while the fresh
// request runs in the background (same pattern as useFleetLive / the
// maintenance history hook). A revalidation failure keeps showing the cached
// data instead of an error screen.

import { useState, useEffect, useCallback, useRef } from "react";
import { readCache, writeCache } from "../services/cache";

/**
 * @param options.keepPreviousData  On a deps/key change with nothing cached for
 *   the NEW key, keep showing the old key's data instead of blanking to null.
 *
 *   Off by default, so no existing caller changes behaviour. The Analytics page
 *   turns it on because its filter changes six keys at once: every card emptied
 *   the moment a vehicle type was picked and stayed empty until the slowest
 *   request landed, which read as the page hanging rather than as it working.
 *
 *   The returned `stale` flag says the visible data belongs to a PREVIOUS
 *   selection. A caller that opts in must show that — figures from the whole
 *   fleet sitting silently under a heading that names one machine family is a
 *   worse failure than the blank was.
 */
export function useApiData(
  fetchFn, deps = [], { cacheKey = null, pollMs = 0, keepPreviousData = false } = {},
) {
  const [data, setData] = useState(() => (cacheKey ? readCache(cacheKey) : null));
  const [loading, setLoading] = useState(() => !(cacheKey && readCache(cacheKey) != null));
  const [error, setError] = useState(null);

  const [retryToken, setRetryToken] = useState(0);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  // `revalidate` is a stable callback that outlives any one key, so it cannot
  // close over `identity` — it would stamp a poll's result with whichever key
  // was current when the callback was built.
  const identityRef = useRef(null);

  // Which request the state above belongs to. The effect below also resets on a
  // deps change, but effects run AFTER render — so the first paint following an
  // org switch showed the previous organisation's numbers. Adjusting state
  // during render (React re-runs immediately, before painting) means the old
  // org's data is never displayed.
  const identity = cacheKey ?? JSON.stringify(deps);
  identityRef.current = identity;
  const [stateIdentity, setStateIdentity] = useState(identity);
  // Which request the VISIBLE data belongs to. Tracked separately from
  // `stateIdentity` so `keepPreviousData` can show one key's data while another
  // is in flight, and still say truthfully which one it is.
  const [dataIdentity, setDataIdentity] = useState(identity);
  if (stateIdentity !== identity) {
    const cached = cacheKey ? readCache(cacheKey) : null;
    setStateIdentity(identity);
    setError(null);
    if (cached != null) {
      setData(cached);
      setDataIdentity(identity);
      setLoading(false);
    } else if (keepPreviousData && data != null) {
      // Leave `data` and `dataIdentity` alone — the old figures stay on screen,
      // marked stale, until this key's request lands.
      setLoading(true);
    } else {
      setData(null);
      setDataIdentity(identity);
      setLoading(true);
    }
  }

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);

  // What is on screen right now, readable from a stable callback. `mutate`
  // outlives any one render, so it cannot close over `data`.
  const dataRef = useRef(data);
  dataRef.current = data;

  /**
   * Apply a change the caller already knows the answer to — to the state AND
   * to the cache, in one step.
   *
   * The case this exists for is a write whose result the client can compute
   * exactly: a row deleted is a row gone from the list, and nothing about the
   * server's next answer is needed to know that. Without this the only way to
   * reflect it was `retry()`, which blanks `data`, raises `loading`, and
   * repaints the whole page as a spinner to tell the reader something they
   * watched happen.
   *
   * Writing the CACHE is the half that actually matters. `retry()`'s refetch
   * does write it, but only if it succeeds — and on failure this hook
   * deliberately keeps the last good data rather than showing an error, so a
   * failed refresh after a successful delete would leave the deleted row on
   * screen and in localStorage, where it survives a reload and outlives the
   * account itself. Correcting the cache from what we know, then revalidating,
   * cannot land in that state.
   *
   * Pair it with `revalidate()`, not `retry()`: the local edit is a good
   * enough answer to paint immediately, and the server's is worth having
   * quietly a moment later.
   */
  const mutate = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(dataRef.current) : updater;
    setData(next);
    setDataIdentity(identityRef.current);
    if (cacheKey && next != null) writeCache(cacheKey, next);
    return next;
  }, [cacheKey]);

  /**
   * Refresh in place: same request, no spinner, and a failure leaves whatever
   * is on screen alone.
   *
   * Deliberately not `retry()`. That bumps a token the main effect depends on,
   * which re-runs the whole mount path — clearing `data` and raising `loading`
   * — and on a sixty-second interval that would strobe every card on the page.
   */
  const revalidate = useCallback(() => {
    fetchFnRef.current()
      .then((result) => {
        if (result == null) return;
        setData(result);
        setDataIdentity(identityRef.current);
        setError(null);
        if (cacheKey) writeCache(cacheKey, result);
      })
      .catch((err) => {
        // Silent on purpose. The reader is looking at the last good numbers;
        // replacing them with an error because one refresh was rate-limited
        // would be a downgrade.
        console.warn("[useApiData] refresh failed, keeping last good data:", err);
      });
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;

    // Deps changed (company/selection switch): hydrate the NEW key's cache
    // immediately so the UI never flashes a spinner over stale-but-usable data.
    const cached = cacheKey ? readCache(cacheKey) : null;
    if (cached != null) {
      setData(cached);
      setDataIdentity(identity);
      setLoading(false);
    } else if (keepPreviousData) {
      // Whatever is on screen stays there, flagged stale by `dataIdentity`.
      setLoading(true);
    } else {
      setData(null);
      setDataIdentity(identity);
      setLoading(true);
    }
    setError(null);

    fetchFnRef.current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setDataIdentity(identity);
        setLoading(false);
        if (cacheKey && result != null) writeCache(cacheKey, result);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[useApiData] request failed:", err);
        // Stale data beats an error screen — only surface the failure when
        // there was nothing to show.
        if (cached == null) setError(err);
        setLoading(false);
        // The attempt is OVER, so stop calling the visible data stale even
        // though it belongs to the previous key. Without this a request that
        // never succeeds — and machine-summary against this database is one —
        // leaves `stale` true forever, which reads to the page above as a
        // filter change that is still in flight and pins "Updating…" on screen
        // permanently. The figures are still the old selection's, which is why
        // `error` is what a caller should show once this settles.
        setDataIdentity(identity);
      });

    return () => { cancelled = true; };

  }, [...deps, cacheKey, retryToken]);

  useEffect(() => {
    if (!pollMs) return undefined;

    let id = null;
    const start = () => { if (id == null) id = setInterval(revalidate, pollMs); };
    const stop  = () => { if (id != null) { clearInterval(id); id = null; } };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // One immediate refresh on return: a tab hidden for an hour is showing
        // an hour-old figure, and waiting a further interval to correct it is
        // the moment the number is least trustworthy.
        revalidate();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [pollMs, revalidate, ...deps]);

  // True while the figures on screen belong to a previous selection. Callers
  // that opted into `keepPreviousData` must surface this.
  const stale = dataIdentity !== identity;

  return { data, loading, error, retry, revalidate, mutate, stale };
}
