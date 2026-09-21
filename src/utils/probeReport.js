// Probe & Sensor Health export — CSV (opens in Excel) and PDF.
//
// The two formats are for two different jobs and neither replaces the other.
// The CSV is the working document: a maintenance planner sorts it, filters it,
// and ticks units off as they are dealt with. The PDF is the record — what was
// broken on the morning somebody signed off the week's workshop list.
//
// ## Why CSV rather than a real .xlsx
//
// A true xlsx needs a writer library; the smallest credible one is around a
// megabyte and this bundle already trips Vite's 500 kB chunk warning. A CSV
// carrying a UTF-8 BOM opens directly in Excel with the encoding intact,
// sorts and filters identically, and costs nothing. If a genuine workbook is
// ever wanted — multiple sheets, frozen headers — that is the point to take
// the dependency, not before.

import {
  createReport, addSectionTitle, addSummaryCards, addTable, downloadReport,
} from "./pdfReport";
import { PROBE_STATE_LABEL, CHANNEL_STATE_LABEL, faultAction } from "../api/probeHealth";

const stamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const litres = (ml) => (ml == null ? "" : (ml / 1000).toFixed(1));
const num    = (v)  => (v == null ? "" : String(Math.round(v)));

/**
 * One CSV field.
 *
 * The leading-character guard is not decoration. Excel and Sheets treat a cell
 * beginning `=`, `+`, `-` or `@` as a FORMULA, so a value arriving from the
 * provider — a sensor name, a plate — could execute on open. Prefixing a
 * single quote makes it text. The value is still readable; it just cannot run.
 */
function field(value) {
  const s = value == null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The columns, in the order somebody triaging faults reads them. */
const COLUMNS = [
  ["Plate",              (r) => r.plate],
  ["Unit",               (r) => r.deviceId ?? ""],
  ["Fleet",              (r) => r.orgCode],
  ["Action",             (r) => faultAction(r)],
  ["Fuel probe",         (r) => PROBE_STATE_LABEL[r.fuelProbe?.state] ?? r.fuelProbe?.state ?? ""],
  ["Probe last worked",  (r) => stamp(r.fuelProbe?.lastAliveAt)],
  ["Last reading (L)",   (r) => litres(r.fuelProbe?.lastValueMl)],
  ["Last seen",          (r) => stamp(r.fuelProbe?.lastSeenAt)],
  ["Fuel sensor",        (r) => (!r.fuelSensor?.fitted ? "Not configured"
                                : r.fuelSensor.uncalibrated ? "Uncalibrated" : "Calibrated")],
  ["Sensor name",        (r) => r.fuelSensor?.name ?? ""],
  ["Parameter",          (r) => r.fuelSensor?.parameter ?? ""],
  ["Calibration points", (r) => (r.fuelSensor?.calibrationPoints ?? "")],
  ["GPS",                (r) => CHANNEL_STATE_LABEL[r.channels?.gps?.state] ?? ""],
  ["Ignition",           (r) => CHANNEL_STATE_LABEL[r.channels?.ignition?.state] ?? ""],
  ["Odometer",           (r) => CHANNEL_STATE_LABEL[r.channels?.odometer?.state] ?? ""],
  ["Odometer (km)",      (r) => num(r.channels?.odometer?.lastValue)],
  ["Engine hours",       (r) => CHANNEL_STATE_LABEL[r.channels?.engineHours?.state] ?? ""],
  ["Engine hours (h)",   (r) => num(r.channels?.engineHours?.lastValue)],
  ["Readings (30 d)",    (r) => r.fuelProbe?.pings ?? ""],
];

export function buildProbeCsv(rows) {
  const head = COLUMNS.map(([label]) => field(label)).join(",");
  const body = rows.map((r) => COLUMNS.map(([, read]) => field(read(r))).join(","));
  // CRLF because that is what Excel expects from a .csv on every platform.
  return [head, ...body].join("\r\n");
}

/** Download the rows as a CSV. The BOM is what makes Excel read it as UTF-8
 *  rather than the local codepage, which mangles the plates. */
export function downloadProbeCsv(rows, { filenameSlug = "probes" } = {}) {
  const blob = new Blob(["﻿", buildProbeCsv(rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // LOCAL date, not UTC. The fleet runs on EAT and the server's own day starts
  // at Kenyan midnight (see provider-time), so a file saved at 01:00 on the 20th
  // was being stamped the 19th — an operator sorting a downloads folder by name
  // would file it against the wrong day's work.
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  a.download = `${filenameSlug}-${day}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: Safari has not finished reading the blob when
  // click() returns, and revoking synchronously gives an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Columns the PDF can fit.
 *
 * The shared builder is portrait A4 and every other export in the app uses it,
 * so this does not get its own page geometry for the sake of two more columns.
 * Seven read comfortably; the nineteen the CSV carries would not. The CSV is
 * the working document — this is the record.
 */
const PDF_COLUMNS = [
  "Plate", "Unit", "Action", "Fuel probe", "Probe last worked",
  "Last reading (L)", "Fuel sensor",
];

function pdfRow(r) {
  const pick = new Set(PDF_COLUMNS);
  return COLUMNS.filter(([label]) => pick.has(label)).map(([, read]) => String(read(r) ?? ""));
}

/**
 * Tallies for a SET OF ROWS, not for the fleet.
 *
 * The export used the endpoint's fleet-wide summary, so a PDF filtered to the
 * sixteen uncalibrated sensors still printed "Units 284 · Needs attention 111"
 * above a sixteen-row table. The header contradicted the body, and the number a
 * reader quotes from a report is the one in the big type at the top.
 *
 * On screen the fleet-wide tallies are right — they are what you filter BY, so
 * they must not move as you filter. In an export there is no filter control and
 * no way back to the whole fleet: the document is the filtered set, so its
 * header has to describe the filtered set. Same numbers, different job.
 */
export function summarise(rows) {
  const count = (f) => rows.filter(f).length;
  return {
    total:              rows.length,
    trackerSilent:      count(r => r.trackerSilent),
    probeDied:          count(r => r.fuelProbe?.state === "DIED"),
    probeSilent:        count(r => r.fuelProbe?.state === "SILENT"),
    sensorUncalibrated: count(r => r.fuelSensor?.uncalibrated),
    probeOk:            count(r => r.fuelProbe?.state === "OK" && !r.trackerSilent),
  };
}

/**
 * @param {object}   o
 * @param {string}   o.companyName
 * @param {object[]} o.rows        already filtered — the report IS the filtered set
 * @param {string}   o.filterNote  what the reader is looking at
 * @param {string}   o.filenameSlug names the filter, so two exports differ
 */
export function downloadProbePdf({ companyName, rows, filterNote, filenameSlug = "probes" }) {
  // Derived from `rows`, deliberately ignoring any fleet-wide summary — see
  // summarise. A report whose header and body disagree is worse than one with
  // no header.
  const summary = summarise(rows);
  const doc = createReport({
    companyName,
    reportTitle: "Probe & Sensor Health",
    subtitle: "What is fitted, whether it works, and when it stopped",
  });

  // Labels match the table's own wording — "Reads empty", not the old "Never
  // reported", which described a silence that is not there.
  addSummaryCards(doc, [
    { label: "Units in report", value: String(summary.total) },
    { label: "Tracker silent",  value: String(summary.trackerSilent) },
    { label: "Stopped reading", value: String(summary.probeDied) },
    { label: "Reads empty",     value: String(summary.probeSilent) },
    { label: "Uncalibrated",    value: String(summary.sensorUncalibrated) },
    { label: "Working",         value: String(summary.probeOk) },
  ]);

  addSectionTitle(doc, "Probes and sensors");
  if (filterNote) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor("#7d766b");
    doc.text(filterNote, 34, doc._cursorY);
    doc._cursorY += 14;
  }

  if (!rows.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor("#a9a294");
    doc.text("Nothing matched the current filters.", 34, doc._cursorY);
    doc._cursorY += 26;
  } else {
    addTable(doc, { head: PDF_COLUMNS, body: rows.map(pdfRow) });
  }

  // The filter belongs in the filename too: three exports of different filters
  // landing in one downloads folder as "probe-health.pdf" are indistinguishable.
  downloadReport(doc, filenameSlug);
}
