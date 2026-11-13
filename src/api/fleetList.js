// The client's fleet list, kept by the server for the organisation (fleet-server
// modules/fleet-list, fleet_list_versions): uploaded once, read by every user
// (operator, 13 Nov 2026: it was kept in each browser, so everyone had to upload
// it). Every upload is kept; the newest is the list in use.

import { apiFetch } from "../services/api";

const base = (orgId) => `/api/v1/organisations/${orgId}/fleet-list`;

/**
 * The list in use and the last uploads:
 * { current: { id, fileName, count, at, by, entries, sheets, conflicts } | null,
 *   history: [{ id, fileName, count, at, by, reset }] }.
 */
export async function fetchFleetList(orgId) {
  const res = await apiFetch(base(orgId));
  return res.data ?? { current: null, history: [] };
}

/** Keep a fleet Excel as the page read it (lib/fleetListFile); it is the list in use from now. */
export async function uploadFleetList(orgId, { fileName, entries, sheets = [], conflicts = [] }) {
  const res = await apiFetch(base(orgId), { method: "POST", body: JSON.stringify({ fileName, entries, sheets, conflicts }) });
  return res.data;
}

/** Back to the list built into the app; the uploads stay on record. */
export async function resetFleetList(orgId) {
  const res = await apiFetch(`${base(orgId)}/reset`, { method: "POST", body: "{}" });
  return res.data;
}
