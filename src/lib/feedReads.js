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
//   since  — everything at or before it is read ("Mark all read", or the first
//            visit's 24-hour floor)
//   ids    — the lines opened one at a time since then
//   opened — when the bell was last opened or closed. The BADGE counts only
//            unread lines newer than this, so it still means "news since I
//            last looked" rather than sitting at 20 all day; the panel keeps
//            every unread line marked.
//
// "Mark all read" empties the ids and the list is capped, so it stays small
// however long the tab stays open. Every open tab follows the marks the others
// save (the `storage` event), so a line read in one is read in all.

import { useCallback, useEffect, useState } from 'react';

/** Read lines remembered above the cut-off; the oldest marks fall off first. */
export const MAX_READ_IDS = 500;

const sinceKey = (org) => `ft-feed-seen:${org}`;
const idsKey   = (org) => `ft-feed-read:${org}`;
const openedKey = (org) => `ft-feed-opened:${org}`;

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

/** Whether a line counts on the bell: unread, and new since the bell was opened. */
export function isBadged(item, reads) {
  const t = tsOf(item);
  return isUnread(item, reads) && t > (reads.opened ?? reads.since);
}

/** Mark these lines read; everything else keeps its mark. */
export function withRead(reads, items) {
  const add = items.filter((it) => it?.id != null && isUnread(it, reads));
  if (!add.length) return reads;
  const ids = [...reads.ids, ...add.map((it) => it.id)];
  return { ...reads, ids: new Set(ids.slice(-MAX_READ_IDS)) };
}

/** "Mark all read": everything so far, and the single marks it covers go. */
export const allRead = (reads, now = Date.now()) => ({ since: now, ids: new Set(), opened: Math.max(now, reads?.opened ?? 0) });

/** The bell was opened or closed: the badge starts counting from now. */
export const withOpened = (reads, now = Date.now()) => ({ ...reads, opened: now });

/**
 * Two copies of the marks (this tab's and another tab's) as one: the later
 * cut-off with its lines (an earlier cut-off's lines are all below it), both
 * sets of lines when the cut-offs agree, and the later bell time.
 */
export function mergeReads(a, b) {
  const since = Math.max(a.since, b.since);
  const ids = [...new Set([...(a.since === since ? a.ids : []), ...(b.since === since ? b.ids : [])])];
  return { since, ids: new Set(ids.slice(-MAX_READ_IDS)), opened: Math.max(a.opened ?? 0, b.opened ?? 0) };
}

function load(org) {
  let since = 0;
  let opened = 0;
  let ids = [];
  try {
    since = Number(localStorage.getItem(sinceKey(org))) || 0;
    opened = Number(localStorage.getItem(openedKey(org))) || 0;
    const raw = JSON.parse(localStorage.getItem(idsKey(org)) ?? '[]');
    if (Array.isArray(raw)) ids = raw.filter((x) => typeof x === 'string');
  } catch { /* storage off */ }
  // Never opened in this browser → count only the last 24 hours, so a first
  // visit isn't greeted with every alert in the replayed history.
  since = since || Date.now() - 24 * 3600_000;
  // Before the bell kept its own time, `since` WAS the last time it opened.
  return { since, ids: new Set(ids), opened: opened || since };
}

function save(org, reads) {
  try {
    localStorage.setItem(sinceKey(org), String(reads.since));
    localStorage.setItem(idsKey(org), JSON.stringify([...reads.ids]));
    localStorage.setItem(openedKey(org), String(reads.opened));
  } catch { /* storage off */ }
}

/** The bell's and the panel's shared read marks for one organisation. */
export function useFeedReads(org) {
  const [reads, setReads] = useState(() => load(org));
  useEffect(() => { setReads(load(org)); }, [org]);

  // Another tab saved its marks: take them, so its next save cannot be
  // overwritten by this tab's older copy (or the other way round).
  useEffect(() => {
    const keys = new Set([sinceKey(org), idsKey(org), openedKey(org)]);
    const onStorage = (e) => { if (e.key == null || keys.has(e.key)) setReads(load(org)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [org]);

  const update = useCallback((next) => {
    setReads((cur) => {
      const n = next(cur);
      if (n === cur) return cur;
      // On top of what any other tab saved meanwhile, never over it.
      const merged = mergeReads(n, load(org));
      save(org, merged);
      return merged;
    });
  }, [org]);

  const markRead    = useCallback((...items) => update((cur) => withRead(cur, items)), [update]);
  const markAllRead = useCallback(() => update((cur) => allRead(cur)), [update]);
  const markOpened  = useCallback(() => update((cur) => withOpened(cur)), [update]);
  return { reads, markRead, markAllRead, markOpened };
}
