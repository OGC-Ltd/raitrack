// The end-of-shift report for one organisation: today from midnight (Nairobi)
// up to now, or the period picked on the Reports page (epoch ms, a week at most). The server gathers the shift, builds the report and draws the
// PDF (fleet-server reports/end-of-shift); this only asks for it and saves it.

import { apiFetchBlob } from "../services/api";
import { saveFile } from "./tripReport";

export async function downloadEndOfShiftReport({ orgId, from, to }) {
  if (!orgId) throw new Error("No organisation selected");
  const period = Number.isFinite(from) && Number.isFinite(to) ? `?from=${Math.round(from)}&to=${Math.round(to)}` : "";
  const { blob, filename } = await apiFetchBlob(`/api/v1/organisations/${orgId}/reports/end-of-shift.pdf${period}`);
  saveFile(blob, filename ?? "End of shift report.pdf");
}
