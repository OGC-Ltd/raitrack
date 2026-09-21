// Generic table export — CSV (opens in Excel) and PDF, for any tab whose rows
// are already a head/body pair.
//
// ## Why this exists
//
// Probe & Sensor Health shipped with Refresh · CSV · PDF sitting on its own
// bar, and the other three tabs of the same panel shipped with nothing — the
// only way out of Fuel FSL, Speed or Malfunction was one "Download PDF" menu
// in the panel header that exported the WHOLE fleet, ignoring every filter the
// reader had just set. So the tab with a working export was the one nobody
// needed an export from, and the three that produce workshop lists had none.
//
// The fix is not four bespoke exporters. Every one of those tables is already
// a header row and a body of strings by the time it renders; this module takes
// that pair and produces both formats, so a tab wires up an export by naming
// its columns once. The domain knowledge stays in the tab, where it can't
// drift away from the table it claims to reproduce.
//
// CSV rather than a real .xlsx for the reason probeReport.js gives: a writer
// library is ~1 MB and this bundle already trips Vite's chunk warning, while a
// BOM'd CSV opens in Excel with the plates intact and sorts identically.

import { buildSensorReport } from "./sensorReport";

/**
 * One CSV field.
 *
 * The leading-character guard is not decoration. Excel and Sheets treat a cell
 * beginning `=`, `+`, `-` or `@` as a FORMULA, so a value arriving from the
 * provider — a sensor name, a plate, a fault description — could execute on
 * open. Prefixing a single quote makes it text. It is still readable; it just
 * cannot run.
 */
export function csvField(value) {
  const s = value == null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** @param {string[]} head @param {(string|number)[][]} body */
export function buildCsv(head, body) {
  // CRLF because that is what Excel expects from a .csv on every platform.
  return [
    head.map(csvField).join(","),
    ...body.map(r => r.map(csvField).join(",")),
  ].join("\r\n");
}

/**
 * LOCAL date, not UTC.
 *
 * The fleet runs on EAT and the server's own day starts at Kenyan midnight, so
 * a file saved at 01:00 on the 20th was being stamped the 19th — an operator
 * sorting a downloads folder by name would file it against the wrong day's work.
 */
function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Download a head/body table as a CSV.
 *
 * @param {object} o
 * @param {string[]} o.head
 * @param {(string|number)[][]} o.body   already filtered — the file IS the filtered set
 * @param {string} o.filenameSlug        names the filter, so two exports differ
 */
export function downloadTableCsv({ head, body, filenameSlug = "report" }) {
  // The BOM is what makes Excel read this as UTF-8 rather than the local
  // codepage, which mangles the plates.
  const blob = new Blob(["﻿", buildCsv(head, body)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameSlug}-${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: Safari has not finished reading the blob when
  // click() returns, and revoking synchronously gives an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Download the same head/body table as the house-style PDF.
 *
 * Goes through the shared builder, so this comes out in the same "Fleet
 * Analytics Report" template as Drivers, Maintenance and Warehouse rather than
 * inventing a second house style for the sake of three more tabs.
 *
 * @param {object} o
 * @param {string} o.reportTitle
 * @param {string} o.sectionTitle
 * @param {string} o.filterNote   what the reader is looking at
 * @param {{label: string, value: string}[]} [o.cards]
 * @param {string[]} o.head
 * @param {(string|number)[][]} o.body
 * @param {string} o.filenameSlug
 */
export function downloadTablePdf({
  reportTitle, sectionTitle, filterNote, cards = [], head, body, filenameSlug = "report",
}) {
  buildSensorReport({
    companyName: "Fleet Tracking",
    reportTitle,
    filenameSlug,
    filterNote,
    cards,
    sections: [{ title: sectionTitle, head, body: body.map(r => r.map(c => String(c ?? ""))) }],
  });
}
