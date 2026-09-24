/**
 * Follow-ups on deleted fuel alerts — the client half of the server's
 * FuelTheftFollowUp (fleet-server: modules/fuel/fuel-followup.service).
 *
 * Deleting a fuel alert opens a follow-up for the organisation. Somebody with
 * case rights (`fuel_theft:triage`), other than the person who deleted it,
 * accepts it; from then on only they can add notes and escalate it (a
 * confirmed theft) or de-escalate it (not a theft). Every step is logged
 * server-side with who took it.
 *
 * One module-level store so the map button, the live feed and the case window
 * all read the same list, refetched when the server says one moved
 * (`fuel_followup` over SSE, see useFleetLive) rather than on a timer.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from '../services/api';

const base = (orgId) => `/api/v1/organisations/${orgId}/fuel/followups`;

// ── API ─────────────────────────────────────────────────────────────────────

export async function fetchFollowUps(orgId, status = 'active') {
  const res = await apiFetch(`${base(orgId)}?status=${status}&limit=200`);
  return res?.data ?? [];
}

export async function fetchFollowUp(orgId, id) {
  const res = await apiFetch(`${base(orgId)}/${encodeURIComponent(id)}`);
  return res?.data ?? null;
}

const post = async (orgId, id, verb, body) => {
  const res = await apiFetch(`${base(orgId)}/${encodeURIComponent(id)}/${verb}`, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  followUpsChanged();
  return res?.data ?? null;
};

export const acceptFollowUp     = (orgId, id)       => post(orgId, id, 'accept');
export const noteFollowUp       = (orgId, id, note) => post(orgId, id, 'notes', { note });
export const escalateFollowUp   = (orgId, id, note) => post(orgId, id, 'escalate', { note });
export const deescalateFollowUp = (orgId, id, note) => post(orgId, id, 'deescalate', { note });

// ── Wording ────────────────────────────────────────────────────────────────

export const STATUS_LABEL = {
  OPEN:        'Waiting to be accepted',
  ACCEPTED:    'Under review',
  ESCALATED:   'Confirmed theft',
  DEESCALATED: 'Not a theft',
};

export const ACTION_LABEL = {
  OPENED:      'deleted the alert',
  ACCEPTED:    'accepted the follow-up',
  NOTE:        'added a note',
  ESCALATED:   'escalated it: confirmed theft',
  DEESCALATED: 'de-escalated it: not a theft',
};

/**
 * What this viewer may do with a follow-up, from the server's per-viewer flags
 * and the viewer's own permission. The server enforces all of it; this only
 * decides which buttons to draw.
 */
export function followUpAbilities(f, canTriage) {
  if (!f || !canTriage) return { accept: false, act: false, why: canTriage ? null : 'no-rights' };
  if (f.status === 'OPEN') {
    return f.viewer?.deletedIt
      ? { accept: false, act: false, why: 'deleted-it' }
      : { accept: true, act: false, why: null };
  }
  if (f.status === 'ACCEPTED') {
    return f.viewer?.ownsIt
      ? { accept: false, act: true, why: null }
      : { accept: false, act: false, why: 'someone-else' };
  }
  return { accept: false, act: false, why: 'closed' };
}

/**
 * Whether this follow-up is waiting on THIS viewer: one they may accept, or one
 * they accepted and have not decided. What the System badge counts.
 */
export function needsMe(f) {
  if (f?.status === 'OPEN') return !f.viewer?.deletedIt;
  if (f?.status === 'ACCEPTED') return Boolean(f.viewer?.ownsIt);
  return false;
}

// ── Shared list store ──────────────────────────────────────────────────────

const listeners = new Set();
let state = { orgId: null, items: [], loading: false, error: null };
let generation = 0;

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

async function load(orgId) {
  const mine = ++generation;
  set({ loading: true });
  try {
    const items = await fetchFollowUps(orgId, 'active');
    if (mine === generation) set({ orgId, items, loading: false, error: null });
  } catch (err) {
    // 403 = no case rights here; the button simply does not appear.
    if (mine === generation) set({ orgId, items: [], loading: false, error: err?.status ?? 'error' });
  }
}

/** Something moved on the server (SSE) or here (a POST): read the list again. */
export function followUpsChanged() {
  if (state.orgId) load(state.orgId);
  window.dispatchEvent(new CustomEvent('ft-fuel-followup-changed'));
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => state;

/**
 * The organisation's outstanding follow-ups (waiting or under review).
 * Pass `enabled = false` for a viewer without case rights: nothing is fetched.
 */
export function useFollowUps(orgId, enabled = true) {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!enabled || !orgId) return;
    if (state.orgId !== orgId) { state = { ...state, orgId, items: [] }; }
    load(orgId);
  }, [orgId, enabled]);
  return enabled && s.orgId === orgId ? s : { orgId, items: [], loading: false, error: null };
}

// ── Which case window is open ──────────────────────────────────────────────

const openListeners = new Set();
let openId = null;

export function openFollowUp(id) {
  openId = id ?? null;
  openListeners.forEach((fn) => fn());
}
export const closeFollowUp = () => openFollowUp(null);

export function useOpenFollowUp() {
  return useSyncExternalStore(
    (fn) => { openListeners.add(fn); return () => openListeners.delete(fn); },
    () => openId,
    () => openId,
  );
}

/**
 * The follow-up a Live Feed item is about, if any. Live items carry
 * `followUpId`; items read back from history lose extras but keep their id,
 * which carries it too. `true` means "a follow-up, but which one is unknown".
 */
export function feedItemFollowUp(item) {
  if (item?.followUpId) return item.followUpId;
  // The feed id is minted as `fu-<followUpId>-<what>` (fuel-followup.service),
  // and it survives the round trip through history where extras do not.
  const m = /^fu-(.+)-(opened|escalated|deescalated)$/.exec(item?.id ?? '');
  if (m) return m[1];
  return typeof item?.alertType === 'string' && item.alertType.startsWith('FUEL_FOLLOWUP_') ? true : null;
}
