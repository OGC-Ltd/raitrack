// The trip report for one dispatch, as a PDF. The server gathers the trip,
// builds the report and draws it (fleet-server trips/trip-report.pdf); this
// only asks for the file and hands it to the browser to save.

import { apiFetchBlob } from "../services/api";

/** Hands a downloaded file to the browser to save. */
export function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The report for `dispatch` (an externalId), or the vehicle's latest dispatch when it is null. */
export async function downloadTripReport({ orgId, vehicleId, dispatch }) {
  const q = dispatch ? `?dispatch=${encodeURIComponent(dispatch)}` : "";
  const { blob, filename } = await apiFetchBlob(`/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(vehicleId)}/trip-report.pdf${q}`);
  saveFile(blob, filename ?? "Trip report.pdf");
}
