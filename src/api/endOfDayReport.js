// Gathers one organisation's day and downloads the end-of-day report as a PDF
// (lib/endOfDayReport for the content, utils/pdfReport for the house layout
// every other export in the dash uses).
//
// Read through routes the dashboard already uses — no new server route:
//   vehicles/snapshot                  the units and their drivers
//   analytics/machine-summary?days=1   the day's distance, engine hours, units reporting
//   incidents/speeding/summary         overspeeding, a row per unit
//   notifications?alertType=HARSH_…    harsh braking and acceleration
//   vss/alarms                         dashcam: no seatbelt, phone use
//   fuel/fillings, fuel/thefts         refills and drains
//   incidents/faults/summary           tracker and sensor faults
// A source that fails or is not permitted leaves its section saying so rather
// than stopping the report.

import { apiFetch } from "../services/api";
import { resolveOrgId } from "./org";
import { getNotifications, fleetToday } from "./notifications";
import { getSpeedingSummary, getFaultSummary } from "./incidents";
import { fetchVssIncidents, fetchVssCameraCount } from "./vssAlarms";
import { HARSH_TYPES } from "../lib/harshDriving";
import { mapSnapshotVehicle } from "../lib/vehicleMap";
import { buildEndOfDay, SAFETY_KINDS, EVENT_WORD } from "../lib/endOfDayReport";
import { createReport, addSectionTitle, addSummaryCards, addTable, downloadReport } from "../utils/pdfReport";

export { fleetToday };

const DAY_MS = 86_400_000;
const quiet = (p, fallback) => Promise.resolve(p).catch(() => fallback);

/** A fleet day (Africa/Nairobi, UTC+3) as instants. */
export function fleetDay(day) {
  const from = Date.parse(`${day}T00:00:00+03:00`);
  return { from, to: from + DAY_MS };
}

/** Every page of a paged incidents list. */
async function allPages(fetchPage, max = 20) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < max; i++) {
    const res = await fetchPage(cursor);
    out.push(...res.rows);
    if (!res.hasNextPage || !res.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

/** The day's harsh-driving alerts, newest first, every page. */
async function harshOf(orgId, day) {
  const out = [];
  let before;
  for (let i = 0; i < 20; i++) {
    const res = await getNotifications({ orgId, day, limit: 500, before, alertTypes: HARSH_TYPES });
    out.push(...res.items);
    if (!res.nextBefore) break;
    before = res.nextBefore;
  }
  return out;
}

async function alarmsOf(orgId, from, to) {
  const cams = await quiet(fetchVssCameraCount(orgId), 0);
  if (!cams) return null;
  const rows = await fetchVssIncidents({ orgId, sinceIso: new Date(from).toISOString() });
  return rows.filter((a) => a.occurredMs >= from && a.occurredMs < to);
}

/** Everything the report is made from, for one organisation and day. */
export async function loadEndOfDay({ companyId, day, onProgress }) {
  const orgId = await resolveOrgId(companyId);
  if (!orgId) throw new Error("No organisation found for this company");
  const { from, to: dayEnd } = fleetDay(day);
  const to = Math.min(dayEnd, Date.now());
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(dayEnd).toISOString();
  const failed = [];
  const note = (name, fallback) => (err) => { failed.push(name); console.warn(`[end of day] ${name}:`, err?.message ?? err); return fallback; };

  onProgress?.("Reading the day");
  const [snap, summary, speeding, harsh, alarms, fillings, thefts, faults] = await Promise.all([
    apiFetch(`/api/v1/organisations/${orgId}/vehicles/snapshot`).then((r) => (Array.isArray(r?.data) ? r.data : [])).catch(note("vehicles", [])),
    apiFetch(`/api/v1/organisations/${orgId}/analytics/machine-summary?days=1&to=${day}`).then((r) => r?.data ?? null).catch(note("distance and hours", null)),
    allPages((cursor) => getSpeedingSummary({ orgId, from: fromIso, to: toIso, cursor, limit: 200 })).catch(note("overspeeding", [])),
    harshOf(orgId, day).catch(note("harsh driving", [])),
    alarmsOf(orgId, from, dayEnd).catch(note("dashcam alarms", null)),
    apiFetch(`/api/v1/organisations/${orgId}/fuel/fillings?from=${fromIso}&to=${toIso}&limit=200`).then((r) => r?.data ?? []).catch(note("refills", [])),
    apiFetch(`/api/v1/organisations/${orgId}/fuel/thefts?from=${fromIso}&to=${toIso}&limit=200`).then((r) => r?.data ?? []).catch(note("fuel drains", [])),
    allPages((cursor) => getFaultSummary({ orgId, from: fromIso, to: toIso, cursor, limit: 200 })).catch(note("device faults", [])),
  ]);

  const vehicles = snap.map((raw) => {
    const v = mapSnapshotVehicle(raw);
    return { vehicleId: v.vehicleId, plate: v.regPlate ?? v.id, driver: v.driver };
  });
  const totals = summary
    ? { km: summary.totalDistanceKm ?? null, hours: summary.totalHours ?? null, vehicles: summary.unitsReporting ?? null }
    : null;
  return {
    report: buildEndOfDay({ dayFrom: from, dayTo: to, vehicles, totals, speeding, harsh, alarms, fillings, thefts, faults }),
    failed,
    live: to < dayEnd,
  };
}

// ── the PDF ────────────────────────────────────────────────────────────────

const HM = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
const LONG_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const n0 = (v) => (v == null ? "-" : Number(v).toLocaleString("en-KE", { maximumFractionDigits: 0 }));
const n1 = (v) => (v == null ? "-" : Number(v).toLocaleString("en-KE", { maximumFractionDigits: 1 }));
const dur = (sec) => {
  if (!sec) return "-";
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};
const dash = (v) => (v ? String(v) : "-");

/** At most `max` rows, and a closing line naming the rest. */
function capped(rows, max, cols) {
  if (rows.length <= max) return rows;
  return [...rows.slice(0, max), [`and ${rows.length - max} more`, ...Array(cols - 1).fill("")]];
}

function note(doc, text) {
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor("#7d766b");
  doc.text(text, 34, doc._cursorY, { maxWidth: doc.internal.pageSize.getWidth() - 68 });
  doc._cursorY += 20;
}

/** Room for `h` points, or a fresh page. */
function room(doc, h) {
  const pageH = doc.internal.pageSize.getHeight();
  if (doc._cursorY + h <= pageH - 60) return;
  doc.addPage();
  doc.setFillColor("#f7f4ee");
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), pageH, "F");
  doc._cursorY = 48;
}

function signOff(doc) {
  room(doc, 70);
  const w = doc.internal.pageSize.getWidth();
  const y = doc._cursorY + 30;
  doc.setDrawColor("#a9a294");
  doc.setLineWidth(0.6);
  doc.line(34, y, w / 2 - 20, y);
  doc.line(w / 2 + 20, y, w - 34, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#7d766b");
  doc.text("Prepared by", 34, y + 12);
  doc.text("Reviewed by, signature and date", w / 2 + 20, y + 12);
  doc._cursorY = y + 30;
}

export function renderEndOfDayPdf({ report: r, companyName, live, failed = [] }) {
  const period = `${LONG_DAY.format(r.dayFrom)}, 00:00 to ${live ? `${HM.format(r.dayTo)} (day in progress)` : "24:00"}`;
  const doc = createReport({ companyName, reportTitle: "End of Day Report", subtitle: period });

  // 1. Fleet summary
  addSectionTitle(doc, "1. Fleet summary");
  addSummaryCards(doc, [
    { label: "Units in fleet", value: n0(r.fleet.units) },
    { label: "Units reporting", value: n0(r.fleet.withData) },
    { label: "Distance", value: r.fleet.km != null ? `${n0(r.fleet.km)} km` : "-" },
    { label: "Engine hours", value: r.fleet.hours != null ? `${n1(r.fleet.hours)} h` : "-" },
    { label: "Safety events", value: n0(r.safety.total) },
  ]);

  // 2. Safety
  room(doc, 120);
  addSectionTitle(doc, "2. Safety");
  addSummaryCards(doc, SAFETY_KINDS.map((k) => ({ label: k.label, value: n0(r.safety.counts[k.key]) })));
  if (!r.safety.dashcam) note(doc, "No dashcams in this organisation, or their alarms could not be read: seatbelt and phone use are not counted.");
  if (r.safety.units.length) {
    room(doc, 80);
    addTable(doc, {
      head: ["Vehicle", "Driver", "Overspeeding", "Peak / limit", "Time over", "Harsh braking", "Harsh accel.", "No seatbelt", "Phone use", "Total"],
      body: capped(r.safety.units.map((u) => [
        u.plate, dash(u.driver), n0(u.speed),
        u.peakKmh ? `${n0(u.peakKmh)} / ${n0(u.limitKmh)} km/h` : "-", dur(u.overSec),
        n0(u.brake), n0(u.accel), n0(u.seatbelt), n0(u.phone), n0(u.total),
      ]), 40, 10),
      fontSize: 7.8,
      columnStyles: { 0: { cellWidth: 60, fontStyle: "bold" }, 1: { cellWidth: 84 }, 3: { cellWidth: 62 } },
    });
  } else {
    note(doc, "No safety events recorded on this day.");
  }
  if (r.safety.events.length) {
    room(doc, 80);
    addSectionTitle(doc, "Harsh driving and dashcam alarms");
    addTable(doc, {
      head: ["Time", "Vehicle", "Event", "Detail"],
      body: capped(r.safety.events.map((e) => [HM.format(e.t), e.plate, EVENT_WORD[e.kind], dash(e.detail)]), 60, 4),
    });
  }

  // 3. Fuel
  room(doc, 120);
  addSectionTitle(doc, "3. Fuel");
  addSummaryCards(doc, [
    { label: "Refills", value: n0(r.fuel.refills.length) },
    { label: "Litres refilled", value: `${n1(r.fuel.refillL)} L` },
    { label: "Drains", value: n0(r.fuel.drains.length) },
    { label: "Confirmed drains", value: n0(r.fuel.confirmedDrains) },
    { label: "Litres drained", value: `${n1(r.fuel.drainL)} L` },
  ]);
  if (r.fuel.drains.length) {
    room(doc, 80);
    addTable(doc, {
      head: ["Time", "Vehicle", "Litres", "Location", "Status"],
      body: capped(r.fuel.drains.map((d) => [HM.format(d.t), d.plate, n1(d.litres), dash(d.place), d.status]), 40, 5),
    });
  }
  if (r.fuel.refills.length) {
    room(doc, 80);
    addSectionTitle(doc, "Refills");
    addTable(doc, {
      head: ["Time", "Vehicle", "Litres", "Location"],
      body: capped(r.fuel.refills.map((f) => [HM.format(f.t), f.plate, n1(f.litres), dash(f.place)]), 40, 4),
    });
  }
  if (!r.fuel.drains.length && !r.fuel.refills.length) note(doc, "No refills or drains recorded on this day.");

  // 4. Device health
  room(doc, 80);
  addSectionTitle(doc, `4. Device health${r.devices.rows.length ? ` (${r.devices.rows.length} units, ${r.devices.stillDown} still down)` : ""}`);
  if (r.devices.rows.length) {
    addTable(doc, {
      head: ["Vehicle", "Fault", "Times", "Down for", "Still down"],
      body: capped(r.devices.rows.map((d) => [d.plate, dash(d.faults), n0(d.episodes), dur(d.downSec), d.stillDown ? "Yes" : "No"]), 40, 5),
    });
  } else {
    note(doc, "No tracker or sensor faults recorded on this day.");
  }

  if (failed.length) note(doc, `Could not be read for this report: ${failed.join(", ")}.`);
  signOff(doc);
  return doc;
}

/** Gathers the day and saves the PDF. */
export async function downloadEndOfDayReport({ company, day, onProgress }) {
  const { report, failed, live } = await loadEndOfDay({ companyId: company.id, day, onProgress });
  onProgress?.("Building the PDF");
  const doc = renderEndOfDayPdf({ report, companyName: company.name, live, failed });
  downloadReport(doc, `End of day report ${company.name} ${day}.pdf`);
}
