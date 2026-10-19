// Live feed read marks, per organisation, in this browser.
//
// One message read is ONE message read (operator 2026-10-19). The feed used to
// keep a single "last seen" time and move it to now whenever the panel opened
// or closed — and clicking a row closes it — so reading one line cleared every
// other unread line with it.
//
// Now a line is read when it is opened, and only "Mark all read" moves the
// line under which everything counts as read:
//
//   since — everything at or before it is read ("Mark all read", or the first
//           visit's 24-hour floor)
//   ids   — the lines opened one at a time since then
//
// The ids are pruned to the ones still newer than `since` and capped, so the
// stored list stays small however long the tab stays open.

import { useCallback, useEffect, useState } from 'react';

/** Read lines remembered above the cut-off; the oldest marks fall off first. */
export const MAX_READ_IDS = 500;

const sinceKey = (org) => `ft-feed-seen:${org}`;
const idsKey   = (org) => `ft-feed-read:${org}`;

const tsOf = (item) => {
  const t = Date.parse(item?.ts);
  return Number.isFinite(t) ? t : null;
};

/** Whether a feed line is still unread. A line without a usable time is read. */
export function isUnread(item, reads) {
  const t = tsOf(item);
  if (t == null || t <= reads.since) return false;
  return !(item?.id != null && reads.ids.has(item.id));
}

/** Mark these lines read; everything else keeps its mark. */
export function withRead(reads, items) {
  const add = items.filter((it) => it?.id != null && isUnread(it, reads));
  if (!add.length) return reads;
  const ids = [...reads.ids, ...add.map((it) => it.id)];
  return { since: reads.since, ids: new Set(ids.slice(-MAX_READ_IDS)) };
}

/** "Mark all read": everything so far, and the single marks it covers go. */
export const allRead = (now = Date.now()) => ({ since: now, ids: new Set() });

function load(org) {
  let since = 0;
  let ids = [];
  try {
    since = Number(localStorage.getItem(sinceKey(org))) || 0;
    const raw = JSON.parse(localStorage.getItem(idsKey(org)) ?? '[]');
    if (Array.isArray(raw)) ids = raw.filter((x) => typeof x === 'string');
  } catch { /* storage off */ }
  // Never opened in this browser → count only the last 24 hours, so a first
  // visit isn't greeted with every alert in the replayed history.
  return { since: since || Date.now() - 24 * 3600_000, ids: new Set(ids) };
}

function save(org, reads) {
  try {
    localStorage.setItem(sinceKey(org), String(reads.since));
    localStorage.setItem(idsKey(org), JSON.stringify([...reads.ids]));
  } catch { /* storage off */ }
}

/** The bell's and the panel's shared read marks for one organisation. */
export function useFeedReads(org) {
  const [reads, setReads] = useState(() => load(org));
  useEffect(() => { setReads(load(org)); }, [org]);

  const update = useCallback((next) => {
    setReads((cur) => {
      const n = next(cur);
      if (n !== cur) save(org, n);
      return n;
    });
  }, [org]);

  const markRead    = useCallback((...items) => update((cur) => withRead(cur, items)), [update]);
  const markAllRead = useCallback(() => update(() => allRead()), [update]);
  return { reads, markRead, markAllRead };
}
