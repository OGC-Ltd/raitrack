// A vehicle's day for the report picker beside the Trip report button: the
// day's trips to choose from, and the report for one of them or for the whole
// day. The server cuts the day into trips, names their ends and makes the PDF
// (fleet-server trips/trip-report.service); nothing is worked out here.

import { apiFetch, apiFetchBlob } from "../services/api";
import { fleetToday } from "./notifications";
import { saveFile } from "./tripReport";

export { fleetToday };

const vehicleBase = (orgId, vehicleId) => `/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(vehicleId)}`;

/** The day's trips, named: `{ n, from, to, distanceM, fromName, toName }`. */
export async function listDayTrips({ orgId, vehicleId, day }) {
  const res = await apiFetch(`${vehicleBase(orgId, vehicleId)}/day-trips?day=${encodeURIComponent(day)}`);
  return Array.isArray(res?.data) ? res.data : [];
}

/** Downloads the report for one of the day's trips, or the whole day when `trip` is null. */
export async function downloadDayReport({ orgId, vehicleId, day, trip = null }) {
  const q = new URLSearchParams({ day, ...(trip ? { trip: String(trip.n) } : {}) });
  const { blob, filename } = await apiFetchBlob(`${vehicleBase(orgId, vehicleId)}/day-report.pdf?${q}`);
  saveFile(blob, filename ?? `${trip ? "Trip" : "Day"} report ${day}.pdf`);
}
