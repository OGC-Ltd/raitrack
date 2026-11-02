// Driver conduct follow-up on the server (fleet-server reports/driver-conduct):
// the cases a report run finds and what was done on each, and the incidents
// operators log by hand. Kept there since 2 Nov 2026 so every machine sees the
// same; each browser kept its own before. Shapes are lib/followUp's and
// lib/operatorLog's: epoch ms times, a case id of "<unit key>|<fleet day>".

import { apiFetch } from '../services/api';

const base = (orgId) => `/api/v1/organisations/${orgId}/driver-conduct`;
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Tells the sidebar's count that the cases changed. */
export const CHANGED = 'ft-followup-changed';
const changed = () => window.dispatchEvent(new Event(CHANGED));

export async function listCases(orgId) {
  return (await apiFetch(`${base(orgId)}/cases`)).data;
}

export async function pendingCount(orgId) {
  return (await apiFetch(`${base(orgId)}/cases/pending-count`)).data.pending;
}

/** The cases a run found, merged on the server; answers with every case. */
export async function sendFound(orgId, cases) {
  const out = (await apiFetch(`${base(orgId)}/cases/found`, json('POST', { cases }))).data;
  changed();
  return out;
}

/** What was done on a case (the server records who and when); a null action reopens it. */
export async function recordAction(orgId, caseId, { action, note }) {
  const out = (await apiFetch(`${base(orgId)}/cases/${encodeURIComponent(caseId)}/action`, json('PUT', { action, note: note ?? '' }))).data;
  changed();
  return out;
}

/** Cases from a file or a browser; one held already takes the record acted on last. */
export async function importCases(orgId, cases) {
  const out = (await apiFetch(`${base(orgId)}/cases/import`, json('POST', { cases }))).data;
  changed();
  return out;
}

export async function listIncidents(orgId) {
  return (await apiFetch(`${base(orgId)}/incidents`)).data;
}

export async function saveIncident(orgId, entry) {
  return (await apiFetch(`${base(orgId)}/incidents/${encodeURIComponent(entry.id)}`, json('PUT', entry))).data;
}

export async function deleteIncident(orgId, id) {
  await apiFetch(`${base(orgId)}/incidents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function importIncidents(orgId, entries) {
  return (await apiFetch(`${base(orgId)}/incidents/import`, json('POST', { entries }))).data;
}
