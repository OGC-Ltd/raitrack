// Gathers one organisation's shift and downloads the end-of-shift report as a
// PDF (lib/endOfShiftReport for the content, lib/endOfShiftHtml for the page).
//
// Read through routes the dashboard already uses — nothing new on the server:
//   vehicles/snapshot                    units, drivers, zones they are in now, open dispatch
//   fuel/fillings, fuel/thefts           refills and drains
//   incidents/speeding/summary           overspeeding, a row per unit
//   notifications (HARSH_*, ZONE_EXIT / ZONE_ENTRY, SALE_DISPATCH)
//   vss/alarms                           dashcam: phone, seatbelt, camera covered
//   weighments?day= / weighments/bridges weighbridge tickets
// A source that fails leaves its section empty rather than stopping the report.

import { apiFetch } from "../services/api";
import { resolveOrgId } from "./org";
import { getNotifications } from "./notifications";
import { getSpeedingSummary } from "./incidents";
import { fetchVssIncidents, fetchVssCameraCount } from "./vssAlarms";
import { getWeighmentDay, getWeighbridges } from "./weighments";
import { HARSH_TYPES } from "../lib/harshDriving";
import { mapSnapshotVehicle } from "../lib/vehicleMap";
import { buildEndOfShift, shiftStart } from "../lib/endOfShiftReport";
import { renderEndOfShiftHtml } from "../lib/endOfShiftHtml";
import raiLogo from "../assets/rai-group-logo.jpeg";
import ogcLogo from "../assets/ogc-monitoring-logo.png";

const H = 3_600_000;
const quiet = (p, fallback) => Promise.resolve(p).catch(() => fallback);
const fleetDay = (t) => new Date(t + 3 * H).toISOString().slice(0, 10);
const abs = (src) => new URL(src, window.location.href).href;

/** The fleet days a span touches, oldest first. */
function daysOf(from, to) {
  const out = [];
  for (let d = fleetDay(from); ; ) {
    out.push(d);
    if (d >= fleetDay(to)) break;
    d = new Date(Date.parse(`${d}T12:00:00Z`) + 24 * H).toISOString().slice(0, 10);
  }
  return out;
}

/** Every feed item of these types over the days, newest first. */
async function feedOf(orgId, days, alertTypes) {
  const out = [];
  for (const day of days) {
    let before;
    for (let i = 0; i < 20; i++) {
      const res = await getNotifications({ orgId, day, limit: 500, before, alertTypes });
      out.push(...res.items);
      if (!res.nextBefore) break;
      before = res.nextBefore;
    }
  }
  return out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

async function allSpeeding(orgId, from, to) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const res = await getSpeedingSummary({ orgId, from: new Date(from).toISOString(), to: new Date(to).toISOString(), cursor, limit: 200 });
    out.push(...res.rows);
    if (!res.hasNextPage || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

async function ticketsOf(orgId, days) {
  const bridges = await quiet(getWeighbridges({ orgId }), []);
  const rows = [];
  let centres = 0;
  for (const day of days) {
    const res = await getWeighmentDay({ orgId, day });
    centres = Math.max(centres, res?.centres?.length ?? 0);
    rows.push(...(res?.rows ?? []));
  }
  // A fleet with no bridge of its own gets no weighbridge section.
  return bridges.length || centres || rows.length ? rows : null;
}

async function alarmsOf(orgId, from) {
  const cams = await quiet(fetchVssCameraCount(orgId), 0);
  if (!cams) return null;
  return fetchVssIncidents({ orgId, sinceIso: new Date(from).toISOString() });
}

/**
 * Where each listed unit is now, by name: the place the vehicle card shows
 * (the server's reverse-geocode, "Pemugi, Turbo"), else Google's nearest
 * named place, else nothing and the coordinates stand in.
 */
async function placesFor(units, onProgress) {
  const out = new Map();
  const list = units.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  const { placeNameAt } = await import("../hooks/usePlaceName");
  let google = null;
  let next = 0, done = 0;
  const worker = async () => {
    while (next < list.length) {
      const v = list[next++];
      let name = await quiet(placeNameAt(v.lat, v.lng), null);
      if (!name) {
        google ??= await import("../lib/googlePlaceNames");
        name = google.googleLabel(await quiet(google.googlePlaceName({ lat: v.lat, lng: v.lng }), null));
      }
      if (name) out.set(v.vehicleId, String(name).replace(/,\s*Kenya$/i, ""));
      onProgress?.(`Naming places ${++done} of ${list.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

/** Everything the report is made from, for one organisation, 06:00 to now. */
export async function loadEndOfShift({ companyId, now = Date.now(), onProgress }) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) throw new Error("No organisation found for this company");
  const from = shiftStart(now);
  const to = now;
  const days = daysOf(from, to);
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const failed = [];
  const note = (name, fallback) => (err) => { failed.push(name); console.warn(`[end of shift] ${name}:`, err?.message ?? err); return fallback; };

  onProgress?.("Reading the fleet");
  const snap = await apiFetch(`/api/v1/organisations/${orgId}/vehicles/snapshot`).then((r) => (Array.isArray(r?.data) ? r.data : [])).catch(note("vehicles", []));
  const vehicles = snap.map(mapSnapshotVehicle);

  onProgress?.("Reading the shift");
  const [fillings, thefts, speeding, harsh, alarms, zones, tickets, sales] = await Promise.all([
    apiFetch(`/api/v1/organisations/${orgId}/fuel/fillings?from=${fromIso}&to=${toIso}&limit=200`).then((r) => r?.data ?? []).catch(note("refills", [])),
    apiFetch(`/api/v1/organisations/${orgId}/fuel/thefts?from=${fromIso}&to=${toIso}&limit=200`).then((r) => r?.data ?? []).catch(note("fuel drains", [])),
    allSpeeding(orgId, from, to).catch(note("overspeeding", [])),
    feedOf(orgId, days, HARSH_TYPES).catch(note("harsh driving", [])),
    alarmsOf(orgId, from).catch(note("dashcam alarms", null)),
    feedOf(orgId, days, ["ZONE_EXIT", "ZONE_ENTRY"]).catch(note("geofence crossings", [])),
    ticketsOf(orgId, days).catch(() => null),
    feedOf(orgId, days, ["SALE_DISPATCH"]).catch(note("sales dispatches", [])),
  ]);

  // Place names only for the units the report lists as still out.
  const first = buildEndOfShift({ from, to, vehicles, zones });
  const ids = new Set(first.outside.map((o) => o.plate));
  const places = await placesFor(vehicles.filter((v) => ids.has(v.regPlate ?? v.id)), onProgress).catch(() => new Map());

  return {
    report: buildEndOfShift({ from, to, vehicles, fillings, thefts, speeding, harsh, alarms, zones, tickets, sales, places }),
    failed,
  };
}

/** Lays the report out in an off-screen frame and saves every page into one PDF. */
export async function downloadEndOfShiftReport({ company, onProgress }) {
  const now = Date.now();
  const { report, failed } = await loadEndOfShift({ companyId: company.id, now, onProgress });
  onProgress?.("Building the PDF");
  const stamp = new Date(now + 3 * H).toISOString();
  const reportNo = `ES-${String(company.short ?? company.name ?? "ORG").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase()}-${stamp.slice(0, 10).replace(/-/g, "")}-${stamp.slice(11, 16).replace(":", "")}`;
  const html = renderEndOfShiftHtml(report, { companyName: company.name, reportNo, logos: { rai: abs(raiLogo), ogc: abs(ogcLogo) }, generatedAt: now });
  if (failed.length) console.warn("[end of shift] not read:", failed.join(", "));

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
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
    const pages = [...doc.querySelectorAll(".page")];
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`Drawing page ${i + 1} of ${pages.length}`);
      const canvas = await html2canvas(pages[i], { scale: 2.2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297);
    }
    pdf.save(`End of shift report ${company.name} ${stamp.slice(0, 10)} ${stamp.slice(11, 16).replace(":", "")}.pdf`);
  } finally {
    frame.remove();
  }
}
