// Sensor Monitor PDF export.
//
// Layout only. The caller hands over finished head/body arrays because the
// domain knowledge that produces them — PROBES, ANOMALY_META, vehicleReadings —
// lives in SensorPanel, and duplicating it here would let the report drift away
// from the screen it claims to reproduce.
//
// Uses the shared builder in utils/pdfReport.js, so this comes out in the same
// "Fleet Analytics Report" template as the Drivers, Maintenance and Warehouse
// exports rather than inventing a second house style.

import {
  createReport, addSectionTitle, addSummaryCards, addTable, finishReport,
} from "./pdfReport";

/** A table that would be empty still gets its heading, and says so. */
function addSection(doc, { title, note, head, body }) {
  addSectionTitle(doc, title);

  if (note) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor("#7d766b");
    doc.text(note, 34, doc._cursorY);
    doc._cursorY += 14;
  }

  if (!body.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor("#a9a294");
    doc.text("Nothing matched the current filters.", 34, doc._cursorY);
    doc._cursorY += 26;
    return;
  }

  addTable(doc, { head, body });
}

/**
 * @param {object}   o
 * @param {string}   o.companyName
 * @param {string}   o.reportTitle  "Sensor Monitor — Speed", or the full report
 * @param {string}   o.filenameSlug distinguishes a per-tab file from the full one
 * @param {string}   o.filterNote   what the reader is looking at (filters applied)
 * @param {object[]} o.cards        [{label, value}] — last one renders highlighted
 * @param {object[]} o.sections     [{title, note, head, body}]
 */
export function drawSensorReport({
  companyName, reportTitle, filterNote, cards, sections,
}) {
  const doc = createReport({
    companyName,
    reportTitle,
    subtitle: filterNote,
  });

  addSummaryCards(doc, cards);
  for (const s of sections) addSection(doc, s);
  finishReport(doc);
  return doc;
}

/** A report with this many rows or more is drawn in a worker, with a bar and a Cancel; a smaller one at once. */
export const WORKER_ROWS = 600;

/** Draws the report and downloads it. Big ones off the page's thread (workers/sensorReport.worker). */
export async function buildSensorReport(o) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const filename = `sensor-${o.filenameSlug}-${stamp}.pdf`;
  const rows = (o.sections ?? []).reduce((n, s) => n + (s.body?.length ?? 0), 0);
  if (rows < WORKER_ROWS || typeof Worker === "undefined") {
    drawSensorReport(o).save(filename);
    return;
  }
  const { showPdfProgress } = await import("../lib/pdfProgress");
  let worker = null;
  let stopped = false;
  const progress = showPdfProgress(o.reportTitle, { onCancel: () => { stopped = true; worker?.terminate(); } });
  progress.update(0.05, `Drawing ${rows.toLocaleString("en-GB")} rows…`);
  try {
    worker = new Worker(new URL("../workers/sensorReport.worker.js", import.meta.url), { type: "module" });
    const buffer = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data: m }) => (m.type === "done" ? resolve(m.buffer) : reject(new Error(m.message)));
      worker.onerror = (e) => reject(new Error(e.message || "The PDF could not be made"));
      worker.postMessage(o);
    });
    if (stopped) return;
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    progress.done("Ready: the file has downloaded");
  } catch (err) {
    if (stopped) return;
    console.error("Sensor report PDF failed", err);
    progress.fail("The PDF could not be made. Please try again.");
  } finally {
    worker?.terminate();
  }
}
