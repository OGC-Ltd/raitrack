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
  createReport, addSectionTitle, addSummaryCards, addTable, downloadReport,
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
export function buildSensorReport({
  companyName, reportTitle, filenameSlug, filterNote, cards, sections,
}) {
  const doc = createReport({
    companyName,
    reportTitle,
    subtitle: filterNote,
  });

  addSummaryCards(doc, cards);
  for (const s of sections) addSection(doc, s);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  downloadReport(doc, `sensor-${filenameSlug}-${stamp}.pdf`);
}
