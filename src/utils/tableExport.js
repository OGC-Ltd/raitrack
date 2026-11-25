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
import { nextTurn } from "../lib/slices";

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
  // A styled cell ({ text, fill }, as the Excel file takes them) is its text here
  const v = value != null && typeof value === "object" && "text" in value ? value.text : value;
  const s = v == null ? "" : String(v);
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

// The toolbar's Excel button (body/TableToolbar) runs the report's own CSV
// handler with this set, so every report that exports a CSV gets the styled
// .xlsx from the same rows without a change of its own (operator, 11 Nov 2026).
//
// Set only while the handler runs synchronously: a CSV handler builds its rows
// from what is on screen and saves at once. Holding it across an await would
// turn an unrelated CSV click made meanwhile into Excel, and a handler that
// saved later would escape it and give a CSV anyway.
let asExcel = null;

/**
 * A table a CSV export is about to save, taken for the Excel file instead when
 * the Excel button asked for it. True when taken: the caller saves nothing.
 * For exports that write their own CSV (utils/probeReport) rather than
 * through downloadTableCsv.
 */
export function takenForExcel(o) {
  if (!asExcel) return false;
  asExcel.push(o);
  return true;
}

/**
 * For a CSV handler that must wait before it saves (Weighbridges › Coverage waits for the
 * distances still being read): call it at once, inside the handler, and run the save
 * later through the function it returns. That save is Excel when the Excel button asked
 * and a CSV when the CSV button did; nothing clicked in between is caught up in it.
 * The handler returns the promise of its save, which the Excel button waits for.
 */
export function exportLater() {
  const into = asExcel;
  return (save) => {
    const was = asExcel;
    asExcel = into;
    try { return save(); } finally { asExcel = was; }
  };
}

/** Run `exportCsv` (a report's CSV handler), making the Excel file instead. */
export async function exportExcelVia(exportCsv) {
  const asked = [];
  asExcel = asked;
  let ran;
  try {
    ran = exportCsv();
  } finally {
    asExcel = null;
  }
  // A handler that waits saves through exportLater, into this same file
  const later = ran && typeof ran.then === "function";
  if (later && !asked.length) await ran;
  if (!asked.length) {
    // Never quietly: a handler that saved nothing, or one that saved outside exportLater
    if (later) throw new Error("This table saves its rows later, so it has no Excel file yet");
    throw new Error("There were no rows to put in an Excel file");
  }
  const { downloadTableXlsx } = await import("./xlsxExport");
  for (const o of asked) await downloadTableXlsx(o);
}

/**
 * Download a head/body table as a CSV.
 *
 * @param {object} o
 * @param {string[]} o.head
 * @param {(string|number)[][]} o.body   already filtered — the file IS the filtered set
 * @param {string} o.filenameSlug        names the filter, so two exports differ
 * @param {string} [o.sheetName]         Excel only: the first sheet's tab
 * @param {object[]} [o.sheets]          Excel only: more sheets after the first (utils/xlsxExport); the CSV is `body` alone
 */
export function downloadTableCsv({ head, body, filenameSlug = "report", title, meta, fills, doc, headFills, sheetName, sheets, inputs }) {
  // `inputs`: columns the reader fills in, in the Excel file only (xlsxExport addSheet)
  if (takenForExcel({ head, body, filenameSlug, title, meta, fills, doc, headFills, sheetName, sheets, inputs })) return;
  const filename = `${filenameSlug}-${today()}.csv`;
  // A very long table is written a slice at a time, so the page keeps answering
  if (body.length > CSV_SLICE_ROWS) return csvSliced(head, body).then((parts) => saveCsv(parts, filename));
  saveCsv([buildCsv(head, body)], filename);
}

/** Rows written between hand-backs to the page: about 50 ms of work. */
const CSV_SLICE_ROWS = 20_000;

/** buildCsv in pieces, the page handed back between them (lib/slices). */
export async function csvSliced(head, body) {
  const parts = [head.map(csvField).join(",")];
  for (let i = 0; i < body.length; i += CSV_SLICE_ROWS) {
    await nextTurn();
    const end = Math.min(body.length, i + CSV_SLICE_ROWS);
    let chunk = "";
    for (let j = i; j < end; j++) chunk += `\r\n${body[j].map(csvField).join(",")}`;
    parts.push(chunk);
  }
  return parts;
}

function saveCsv(parts, filename) {
  // The BOM is what makes Excel read this as UTF-8 rather than the local
  // codepage, which mangles the plates.
  const blob = new Blob(["﻿", ...parts], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
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
