// The end-of-shift report: today from midnight (Nairobi) up to now, for one
// organisation. The server gathers the shift, builds the report and draws the
// PDF (fleet-server reports/end-of-shift); this only asks for it and saves it.

import { apiFetchBlob } from "../services/api";
import { saveFile } from "./tripReport";

export async function downloadEndOfShiftReport({ orgId }) {
  if (!orgId) throw new Error("No organisation selected");
  const { blob, filename } = await apiFetchBlob(`/api/v1/organisations/${orgId}/reports/end-of-shift.pdf`);
  saveFile(blob, filename ?? "End of shift report.pdf");
}
