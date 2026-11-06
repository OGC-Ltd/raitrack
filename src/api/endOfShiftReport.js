// The end-of-shift report for one organisation: today from midnight (Nairobi)
// up to now, or the period picked on the Reports page (epoch ms, a week at most). The server gathers the shift, builds the report and draws the
// PDF (fleet-server reports/end-of-shift); this only asks for it and saves it.

import { apiFetch, apiFetchBlob } from "../services/api";
import { saveFile } from "./tripReport";

const periodQuery = (from, to) => (Number.isFinite(from) && Number.isFinite(to) ? `?from=${Math.round(from)}&to=${Math.round(to)}` : "");

/**
 * The report as the document the PDF is drawn from (lib/shiftDoc), for the Reports page to paint and edit.
 * `category` ({ name, vehicleIds }): one category of the fleet list only (Menengai: Tankers, …), sent in a body.
 */
export async function loadEndOfShiftDoc({ orgId, from, to, category = null }) {
  if (!orgId) throw new Error("No organisation selected");
  if (category) {
    const period = Number.isFinite(from) && Number.isFinite(to) ? { from: Math.round(from), to: Math.round(to) } : {};
    const res = await apiFetch(`/api/v1/organisations/${orgId}/reports/end-of-shift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...period, category: category.name, vehicleIds: category.vehicleIds }),
    });
    return res.data;
  }
  const res = await apiFetch(`/api/v1/organisations/${orgId}/reports/end-of-shift${periodQuery(from, to)}`);
  return res.data;
}

/** The document as the operator edited it, drawn as the PDF by the server: `{ blob, filename }`; `landscape` turns the pages on their side. */
export async function makeEditedEndOfShift({ orgId, doc, landscape = false }) {
  if (!orgId) throw new Error("No organisation selected");
  const { blob, filename } = await apiFetchBlob(`/api/v1/organisations/${orgId}/reports/end-of-shift.pdf${landscape ? "?landscape=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  return { blob, filename: filename ?? "End of shift report.pdf" };
}

/** The same PDF, saved. */
export async function downloadEditedEndOfShift({ orgId, doc, landscape = false }) {
  const { blob, filename } = await makeEditedEndOfShift({ orgId, doc, landscape });
  saveFile(blob, filename);
}
