// The Gate log (operator, 2026-11-25): the sign-outs and returns at the gate,
// one fleet day at a time, from fleet-server's own route on `gate_log:read`
// (modules/gate-log). The route only ever answers with the gate's four event
// types, whatever is asked of it; this file only pages through a day.

import { apiFetch } from "../services/api";

/** Lines per request: the route's own cap. */
export const GATE_LOG_PAGE = 200;
/** Requests per day at most. Sukari's busiest days carry about 1,000 gate lines. */
export const GATE_LOG_MAX_PAGES = 15;

/** Today's weighings, one line each, after `since` when given (fleet-server weighments/recent). */
export async function getRecentWeighings({ orgId, since }) {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await apiFetch(`/api/v1/organisations/${orgId}/weighments/recent${qs}`);
  return res.data ?? { weighings: [], checkedAt: null };
}

/** One page: { events, count, nextBefore }. */
export async function getGateLogPage({ orgId, day, before }) {
  const params = new URLSearchParams({ limit: String(GATE_LOG_PAGE) });
  if (day) params.set("day", day);
  if (before) params.set("before", before);
  const res = await apiFetch(`/api/v1/organisations/${orgId}/gate-log?${params}`);
  return res.data ?? { events: [], count: 0, nextBefore: null };
}

/**
 * A whole fleet day, newest first, read page by page (one after another, never
 * at once). `cut` is true when the day was longer than GATE_LOG_MAX_PAGES pages.
 * `isLive()` lets the caller stop the reading when the page has moved on.
 * `onPage(eventsSoFar)` hears each page as it lands, so the newest lines can
 * be shown while the earlier ones are still being read.
 */
export async function getGateLogDay({ orgId, day, isLive = () => true, readPage = getGateLogPage, onPage = () => {} }) {
  const seen = new Set();
  const events = [];
  let before = null;
  for (let i = 0; i < GATE_LOG_MAX_PAGES; i++) {
    const page = await readPage({ orgId, day, before });
    if (!isLive()) return null;
    for (const e of page.events ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      events.push(e);
    }
    onPage([...events]);
    // The route gives a cursor whenever its page had lines; an empty page is the end.
    if (!page.nextBefore || (page.events ?? []).length === 0) return { events, cut: false };
    if (page.nextBefore === before) return { events, cut: false };
    before = page.nextBefore;
  }
  return { events, cut: true };
}
