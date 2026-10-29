// The trip report for one dispatch, opened in its own window on the letterhead,
// where the browser prints it or saves it as PDF (lib/tripReportHtml's
// toolbar). The window is opened BEFORE the request, inside the click, or a
// pop-up blocker would stop it once the await has broken the user gesture.

import { apiFetch } from "../services/api";
import { buildTripReport } from "../lib/tripReport";
import { renderTripReportHtml } from "../lib/tripReportHtml";
import raiLogo from "../assets/rai-group-logo.jpeg";
import ogcLogo from "../assets/ogc-monitoring-logo.png";

const abs = (src) => new URL(src, window.location.href).href;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const notice = (text) => `<!doctype html><html><head><meta charset="utf-8"><title>Trip report</title></head>
<body style="margin:0;background:#8a8f96;font:14px 'Segoe UI',Arial,sans-serif;color:#1f2328">
<p style="margin:56px auto;max-width:520px;background:#fff;padding:20px 24px;border-radius:6px">${esc(text)}</p></body></html>`;

/** The ingredients from the server; `dispatch` is a dispatch externalId, or the vehicle's latest. */
export async function getTripReportData({ orgId, vehicleId, dispatch }) {
  const q = dispatch ? `?dispatch=${encodeURIComponent(dispatch)}` : "";
  const res = await apiFetch(`/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(vehicleId)}/trip-report${q}`);
  return res.data ?? null;
}

/** Call from a click handler. Resolves once the report is in the window, or the reason is. */
export async function openTripReport({ orgId, vehicleId, dispatch, theme = "light" }) {
  const win = window.open("", "_blank");
  if (!win) throw new Error("The browser blocked the report window. Allow pop-ups for this site and try again.");
  const show = (html) => { win.document.open(); win.document.write(html); win.document.close(); };
  show(notice("Preparing the trip report…"));
  try {
    const data = await getTripReportData({ orgId, vehicleId, dispatch });
    if (!data) throw new Error("No trip data came back.");
    const html = renderTripReportHtml(buildTripReport(data), { theme, logos: { rai: abs(raiLogo), ogc: abs(ogcLogo) } });
    show(html);
  } catch (err) {
    show(notice(`The trip report could not be made: ${err?.message ?? err}`));
  }
}
