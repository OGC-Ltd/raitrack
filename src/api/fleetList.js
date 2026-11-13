// The client's fleet list, kept by the server for the organisation (fleet-server
// modules/fleet-list, fleet_list_versions): uploaded once, read by every user
// (operator, 13 Nov 2026: it was kept in each browser, so everyone had to upload
// it). Every upload is kept; the newest is the list in use. The Excel file itself
// is kept too, in S3 (operator, 13 Nov 2026), and can be downloaded again.

import { apiFetch } from "../services/api";
import { fileAsBase64 } from "./planner";

/** The largest fleet Excel the server keeps. */
export const MAX_FLEET_FILE_BYTES = 5 * 1024 * 1024;

const base = (orgId) => `/api/v1/organisations/${orgId}/fleet-list`;

/**
 * The list in use and the last uploads:
 * { current: { id, fileName, count, at, by, file, entries, sheets, conflicts } | null,
 *   history: [{ id, fileName, count, at, by, reset, file }] }; `file`: the Excel is kept and can be downloaded.
 */
export async function fetchFleetList(orgId) {
  const res = await apiFetch(base(orgId));
  return res.data ?? { current: null, history: [] };
}

/**
 * Keep a fleet Excel as the page read it (lib/fleetListFile), with the file itself (`file`, a File),
 * which the server stores in S3; it is the list in use from now.
 */
export async function uploadFleetList(orgId, { file, fileName = file?.name, entries, sheets = [], conflicts = [] }) {
  const data = await fileAsBase64(file);
  const res = await apiFetch(base(orgId), { method: "POST", body: JSON.stringify({ fileName, file: data, entries, sheets, conflicts }) });
  return res.data;
}

/** A link (minutes long) that downloads an uploaded fleet Excel as it was uploaded: { fileName, url, expiresIn }. */
export async function fleetListFileLink(orgId, id) {
  const res = await apiFetch(`${base(orgId)}/${encodeURIComponent(id)}/file`);
  return res.data;
}

/** Back to the list built into the app; the uploads stay on record. */
export async function resetFleetList(orgId) {
  const res = await apiFetch(`${base(orgId)}/reset`, { method: "POST", body: "{}" });
  return res.data;
}
