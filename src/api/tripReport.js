// The trip report for one dispatch on the letterhead: downloaded as a PDF
// (downloadTripReport, the button's action), or opened in its own window to
// print (openTripReport). That window is opened BEFORE the request, inside the
// click, or a pop-up blocker would stop it once the await has broken the user
// gesture.

import { apiFetch } from "../services/api";
import { buildTripReport } from "../lib/tripReport";
import { loadDay } from "../lib/vehicleDay";
import { renderTripReportHtml } from "../lib/tripReportHtml";
import raiLogo from "../assets/rai-group-logo.jpeg";
import ogcLogo from "../assets/ogc-monitoring-logo.png";

const abs = (src) => new URL(src, window.location.href).href;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const notice = (text) => `<!doctype html><html><head><meta charset="utf-8"><title>Trip report</title></head>
<body style="margin:0;background:#8a8f96;font:14px 'Segoe UI',Arial,sans-serif;color:#1f2328">
<p style="margin:56px auto;max-width:520px;background:#fff;padding:20px 24px;border-radius:6px">${esc(text)}</p></body></html>`;

const FLEET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" });

/**
 * Altitude over the window, [t, metres] — the trip-report route does not carry
 * it, the vehicle's day series (telemetry/day, the Fuel Report's altitude line)
 * does. At most a week of days; a day that fails is simply missing.
 */
async function altitudeFor(orgId, vehicleId, w) {
  const days = [];
  for (let t = w.from; days.length < 8; t += 86_400_000) {
    const d = FLEET_DAY.format(t);
    if (!days.includes(d)) days.push(d);
    if (d >= FLEET_DAY.format(w.to)) break;
  }
  const out = [];
  for (const day of days) {
    const r = await loadDay(orgId, vehicleId, day).catch(() => null);
    for (const p of r?.pings ?? []) {
      if (Number.isFinite(p.altitudeM) && p.t >= w.from && p.t <= w.to) out.push([p.t, p.altitudeM]);
    }
  }
  return out;
}

/** The ingredients from the server; `dispatch` is a dispatch externalId, or the vehicle's latest. */
export async function getTripReportData({ orgId, vehicleId, dispatch }) {
  const q = dispatch ? `?dispatch=${encodeURIComponent(dispatch)}` : "";
  const res = await apiFetch(`/api/v1/organisations/${orgId}/vehicles/${encodeURIComponent(vehicleId)}/trip-report${q}`);
  const data = res.data ?? null;
  if (data?.window && !data.altitude) data.altitude = await altitudeFor(orgId, vehicleId, data.window).catch(() => []);
  return data;
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

/**
 * The same report, straight to a PDF download: no window. The page is laid out
 * in an off-screen frame (so its one-page fit runs), drawn with html2canvas and
 * put on an A4 sheet with jsPDF. Resolves once the file has been handed to the
 * browser.
 */
export async function downloadTripReport({ orgId, vehicleId, dispatch }) {
  const data = await getTripReportData({ orgId, vehicleId, dispatch });
  if (!data) throw new Error("No trip data came back.");
  await downloadReportPdf(data);
}

/**
 * Report data (the trip-report endpoint's shape, or one built from a day by
 * api/dayReport) laid out on the letterhead and saved as a one-page PDF.
 */
export async function downloadReportPdf(data) {
  const r = buildTripReport(data);
  const html = renderTripReportHtml(r, { theme: "light", toolbar: false, logos: { rai: abs(raiLogo), ogc: abs(ogcLogo) } });

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Off screen but rendered: html2canvas skips anything visibility:hidden.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:1300px;border:0;";
  try {
    await new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error("The report page could not be laid out."));
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
    const doc = frame.contentDocument;
    await Promise.all([...doc.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await doc.fonts?.ready;
    const page = doc.querySelector(".page");
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const canvas = await html2canvas(page, { scale: 2.5, backgroundColor: "#ffffff", useCORS: true, logging: false });
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    const day = new Date(r.window.from).toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
    const hm = r.mode === "day" ? "" : ` ${new Date(r.window.from).toLocaleTimeString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).replace(":", "")}`;
    pdf.save(`${r.mode === "day" ? "Day" : "Trip"} report ${r.vehicle.plate} ${day}${hm}.pdf`);
  } finally {
    frame.remove();
  }
}
