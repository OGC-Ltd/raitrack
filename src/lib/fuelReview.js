/**
 * Escalating and de-escalating a LIVE fuel alert, from its window.
 *
 * An administrator (the org's system administrator, or the platform one: the
 * same people who assign Cases) marks the alert a confirmed theft
 * (escalate) or not a theft (de-escalate), with a reason. The alert stays on
 * the dashboard either way and can be decided again the other way. A DELETED
 * alert is not decided here: it has a Case, and the Case's holder decides it.
 *
 * The decision reaches the screen at once through a small store of decisions
 * made in this session, laid over the snapshot's `incident.review` until a new
 * snapshot carries it.
 */

import { useSyncExternalStore } from 'react';
import { apiFetch } from '../services/api';

const base = (orgId) => `/api/v1/organisations/${orgId}/fuel/thefts`;

// ── Who may decide ──────────────────────────────────────────────────────────

const rights = new Map(); // orgId -> Promise<boolean>
const rightsKnown = new Map(); // orgId -> boolean, once the answer is in

/** Whether this viewer may escalate or de-escalate here. Asked once per org. */
export function fetchReviewRights(orgId) {
  if (!orgId) return Promise.resolve(false);
  if (!rights.has(orgId)) {
    rights.set(orgId, apiFetch(`${base(orgId)}/review-rights`)
      .then((res) => {
        const ok = Boolean(res?.data?.canReview);
        rightsKnown.set(orgId, ok);
        return ok;
      })
      .catch(() => { rights.delete(orgId); return false; }));
  }
  return rights.get(orgId);
}

/**
 * The answer, if it is already in — so a window opened after lib/fuelPrefetch
 * asked shows its controls in its first frame instead of a moment later.
 */
export function reviewRightsNow(orgId) {
  return rightsKnown.get(orgId);
}

// ── Decisions made in this session ──────────────────────────────────────────

const listeners = new Set();
let decided = new Map(); // incidentId -> review

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const snapshot = () => decided;

export async function reviewIncident(orgId, incidentId, outcome, note) {
  const res = await apiFetch(`${base(orgId)}/${encodeURIComponent(incidentId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ outcome, note }),
  });
  const review = res?.data?.review ?? null;
  if (review) {
    decided = new Map(decided).set(incidentId, review);
    listeners.forEach((fn) => fn());
  }
  return review;
}

/** The incident's decision: this session's if one was made, else the snapshot's. */
export function useIncidentReview(incident) {
  const map = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!incident) return null;
  return map.get(incident.id) ?? incident.review ?? null;
}

/** Test hook. */
export function _resetReviews() {
  decided = new Map();
  rights.clear();
  rightsKnown.clear();
}

// ── Wording ─────────────────────────────────────────────────────────────────

/**
 * What the decision is, and what the one button left should offer. A decided
 * alert offers only the other way; an undecided one offers both.
 */
export function reviewState(review) {
  const status = review?.status ?? null;
  if (status === 'CONFIRMED_THEFT') return { status, label: 'Escalated', meaning: 'confirmed theft', tone: 'bad', offer: ['DEESCALATED'] };
  if (status === 'NOT_THEFT') return { status, label: 'De-escalated', meaning: 'not a theft', tone: 'ok', offer: ['ESCALATED'] };
  return { status: null, label: null, meaning: null, tone: null, offer: ['ESCALATED', 'DEESCALATED'] };
}

export const OUTCOME = {
  ESCALATED: { verb: 'Escalate', confirm: 'Escalate as confirmed theft', placeholder: 'Why is this a theft? e.g. seen on camera, driver admitted it' },
  DEESCALATED: { verb: 'De-escalate', confirm: 'De-escalate as not a theft', placeholder: 'Why is this not a theft? e.g. probe fault, refuel mis-read' },
};
