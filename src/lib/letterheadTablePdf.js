// A table report on the letterhead, drawn straight into a PDF with jsPDF
// (operator, 17 Nov 2026: 7,049 weighbridge tickets froze the page, "can we
// have actual progress in percentage ... and the report continue while
// someone is working on something else").
//
// The letterhead page (lib/letterhead) is HTML laid out by the browser and
// then pictured page by page, and a long table laid out that way blocks the
// page for minutes. This draws the same page as text and lines: the dark band
// with the two logos, the title and report number under a rule, the facts,
// the figures, then the table, its header on every page, a running head on
// the pages after the first, and "Page n of N" at the foot. Text, not
// pictures, so it is sharp and can be searched.
//
// No DOM: it runs in a worker (workers/letterheadTablePdf.worker) and in the
// tests alike. Measurements are lib/letterhead's own, in mm and pt.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const INK = [28, 28, 28];
const MUT = [92, 92, 92];
const RULE = [191, 191, 191];
const SOFT = [230, 230, 230];
const BAND = [33, 33, 33];
const PT = 0.3528; // mm in a point
const SIDE = 13;
const BAND_H = 21;
const FOOT_H = 11;

/**
 * The standard PDF fonts carry Windows-1252 only: what falls outside it
 * prints as a wrong glyph. The few the reports use are put plainly.
 */
const plain = (s) => String(s ?? '')
  .replace(/\u2212/g, '-').replace(/[\u2013\u2014]/g, '-')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  .replace(/\u2026/g, '...').replace(/\u00a0/g, ' ')
  .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');

/**
 * @param {ReturnType<import('./tableLetterhead').tableLetterheadSpec>} spec
 * @param {{ rai?: { data: string, format: string, ratio: number }, ogc?: { data: string, format: string, ratio: number } }} [logos]
 *   each a data URL, its format ('JPEG' | 'PNG') and width over height
 * @param {(p: { phase: string, done: number, total: number }) => void} [onProgress]
 * @returns {ArrayBuffer} the PDF
 */
export function drawLetterheadTablePdf(spec, logos = {}, onProgress = () => {}) {
  const landscape = spec.landscape;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true });
  const W = landscape ? 297 : 210;
  const H = landscape ? 210 : 297;
  const inner = W - 2 * SIDE;
  const total = spec.body.length;
  onProgress({ phase: 'Starting', done: 0, total });

  // ── the band, with RAI Group on the left and OGC Monitoring on the right
  doc.setFillColor(...BAND);
  doc.rect(0, 0, W, BAND_H, 'F');
  if (logos.rai) doc.addImage(logos.rai.data, logos.rai.format, 12, (BAND_H - 15.5) / 2, 15.5 * logos.rai.ratio, 15.5);
  if (logos.ogc) {
    const w = 9.5 * logos.ogc.ratio;
    doc.addImage(logos.ogc.data, logos.ogc.format, W - 12 - w, (BAND_H - 9.5) / 2, w, 9.5);
  }

  // ── the title and its reference, over a rule
  let y = BAND_H + 5 + 15 * PT;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(plain(spec.title), SIDE, y);
  doc.setFontSize(8);
  const ref = `Report no. ${spec.reportNo}  ·  Date ${spec.date}`;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUT);
  doc.text(plain(ref), W - SIDE, y, { align: 'right' });
  y += 1.2;
  doc.setDrawColor(...INK);
  doc.setLineWidth(1.2 * PT);
  doc.line(SIDE, y, W - SIDE, y);

  // ── the facts, two to a row
  const facts = [];
  for (let i = 0; i < spec.info.length; i += 2) {
    const [a, b] = [spec.info[i], spec.info[i + 1]];
    facts.push([a[0], a[1], b ? b[0] : '', b ? b[1] : '']);
  }
  autoTable(doc, {
    startY: y + 2.2,
    margin: { left: SIDE, right: SIDE },
    theme: 'plain',
    body: facts.map((r) => r.map(plain)),
    styles: { fontSize: 8.6, cellPadding: { top: 0.55, bottom: 0.55, left: 0, right: 3 }, textColor: INK, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 23, textColor: MUT },
      1: { cellWidth: inner / 2 - 23, fontStyle: 'bold' },
      2: { cellWidth: 23, textColor: MUT },
      3: { cellWidth: inner / 2 - 23, fontStyle: 'bold' },
    },
  });
  y = doc.lastAutoTable.finalY;

  // ── a section head: upper case, a count on the right, a rule under
  let section = 1;
  const heading = (text, small) => {
    y += 3.2 + 8.6 * PT;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.6);
    doc.setTextColor(...INK);
    doc.text(plain(`${section++}. ${text}`.toUpperCase()), SIDE, y, { charSpace: 0.15 });
    if (small) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.6);
      doc.setTextColor(...MUT);
      doc.text(plain(small), W - SIDE, y, { align: 'right' });
    }
    y += 0.6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6 * PT);
    doc.line(SIDE, y, W - SIDE, y);
    y += 1.4;
  };

  // ── the figures: a box each, the value over its label
  if (spec.cards?.length) {
    heading('Overview');
    const n = spec.cards.length;
    const bw = inner / n;
    const bh = 10;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6 * PT);
    spec.cards.forEach((c, i) => {
      const x = SIDE + i * bw;
      doc.rect(x, y, bw, bh);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.4);
      doc.setTextColor(...INK);
      doc.text(plain(c.value), x + 1.6, y + 1 + 9.4 * PT);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUT);
      doc.text(plain(c.label), x + 1.6, y + bh - 1.4);
    });
    y += bh;
  }

  const runningHead = (page) => {
    if (page === 1) return;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(plain(spec.title), SIDE, 6 + 10 * PT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(...MUT);
    doc.text(plain(`${spec.companyName} · ${spec.reportNo}`), W - SIDE, 6 + 10 * PT, { align: 'right' });
    doc.setDrawColor(...INK);
    doc.setLineWidth(1.2 * PT);
    doc.line(SIDE, 6 + 10 * PT + 1.2, W - SIDE, 6 + 10 * PT + 1.2);
  };

  // ── sections before the main table (the Wialon unit report's "Tracker status now"): a plain
  // table under its own heading, a Fault drawn in red. `columns: 2` sets the rows side by side,
  // the first half on the left and the rest on the right (operator, 2026-11-27: "two columns on the
  // first page ... instead of it extending to two pages"). None on every other report.
  const GAP = 6;
  const sideTable = (b, rows, left, width) => autoTable(doc, {
    startY: y,
    margin: { left, right: W - left - width, top: 6 + 10 * PT + 4, bottom: FOOT_H + 2 },
    theme: 'plain',
    head: [b.head.map(plain)],
    body: rows.map((r) => r.map(plain)),
    rowPageBreak: 'avoid',
    tableWidth: width,
    styles: { fontSize: b.columns === 2 ? 7.2 : 7.8, cellPadding: { top: 0.5, bottom: 0.5, left: 1.2, right: 1.2 }, textColor: INK, valign: 'top', lineWidth: 0, overflow: 'linebreak' },
    headStyles: { fontSize: 6.8, fontStyle: 'bold', textColor: MUT, valign: 'bottom' },
    columnStyles: b.columns === 2
      ? { 0: { fontStyle: 'bold', cellWidth: width * 0.36 }, 1: { cellWidth: width * 0.19 }, 2: { cellWidth: width * 0.31 }, 3: { cellWidth: width * 0.14 } }
      : { 0: { fontStyle: 'bold' } },
    didParseCell: (d) => {
      if (d.column.index === 0) d.cell.styles.cellPadding = { ...d.cell.styles.cellPadding, left: 0 };
      if (d.section === 'body' && d.cell.raw === '-') d.cell.styles.textColor = MUT;
      if (d.section === 'body' && d.cell.raw === 'Fault') { d.cell.styles.textColor = [185, 28, 28]; d.cell.styles.fontStyle = 'bold'; }
    },
    didDrawCell: (d) => {
      const { x, y: cy, width: cw, height } = d.cell;
      doc.setDrawColor(...(d.section === 'head' ? RULE : SOFT));
      doc.setLineWidth((d.section === 'head' ? 0.6 : 0.4) * PT);
      doc.line(x, cy + height, x + cw, cy + height);
    },
    didDrawPage: (d) => runningHead(d.pageNumber),
  });
  for (const b of spec.before ?? []) {
    heading(b.title, b.small);
    if (b.columns === 2 && b.body.length > 1) {
      const half = Math.ceil(b.body.length / 2);
      const width = (inner - GAP) / 2;
      const startPage = doc.getCurrentPageInfo().pageNumber;
      sideTable(b, b.body.slice(0, half), SIDE, width);
      const leftEnd = { page: doc.getCurrentPageInfo().pageNumber, y: doc.lastAutoTable.finalY };
      doc.setPage(startPage);
      sideTable(b, b.body.slice(half), SIDE + width + GAP, width);
      const rightEnd = { page: doc.getCurrentPageInfo().pageNumber, y: doc.lastAutoTable.finalY };
      // Carry on below whichever half ends lower.
      const last = rightEnd.page > leftEnd.page || (rightEnd.page === leftEnd.page && rightEnd.y >= leftEnd.y) ? rightEnd : leftEnd;
      doc.setPage(last.page);
      y = last.y;
    } else {
      sideTable(b, b.body, SIDE, inner);
      y = doc.lastAutoTable.finalY;
    }
  }

  // ── the table, its header on every page
  heading(spec.sectionTitle, spec.rowsWord);

  if (!total) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.6);
    doc.setTextColor(...MUT);
    doc.text('Nothing matched the current filters.', SIDE, y + 4);
  } else {
    const columnStyles = {};
    spec.cols.forEach((c, i) => {
      columnStyles[i] = {
        cellWidth: c.w,
        halign: c.right ? 'right' : 'left',
        fontStyle: c.bold ? 'bold' : 'normal',
        overflow: c.wrap ? 'linebreak' : 'ellipsize',
      };
    });
    let drawn = 0;
    const step = Math.max(25, Math.round(total / 200));
    autoTable(doc, {
      startY: y,
      margin: { left: SIDE, right: SIDE, top: 6 + 10 * PT + 4, bottom: FOOT_H + 2 },
      theme: 'plain',
      head: [spec.head.map(plain)],
      body: spec.body.map((r) => r.map(plain)),
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      tableWidth: inner,
      styles: { fontSize: 7.8, cellPadding: { top: 0.6, bottom: 0.6, left: 1.4, right: 1.4 }, textColor: INK, valign: 'top', lineWidth: 0 },
      // A heading wraps onto two lines: the column is as wide as its data, not its words
      headStyles: { fontSize: 7.2, fontStyle: 'bold', textColor: MUT, overflow: 'linebreak', valign: 'bottom' },
      columnStyles,
      didParseCell: (d) => {
        if (d.column.index === 0) d.cell.styles.cellPadding = { ...d.cell.styles.cellPadding, left: 0 };
        if (d.section === 'body' && d.cell.raw === '-') d.cell.styles.textColor = MUT;
      },
      didDrawCell: (d) => {
        // A rule under each row, as the letterhead's list table draws it
        const { x, y: cy, width, height } = d.cell;
        doc.setDrawColor(...(d.section === 'head' ? RULE : SOFT));
        doc.setLineWidth((d.section === 'head' ? 0.6 : 0.4) * PT);
        doc.line(x, cy + height, x + width, cy + height);
        if (d.section === 'body' && d.column.index === 0) {
          drawn += 1;
          if (drawn % step === 0 || drawn === total) onProgress({ phase: 'Drawing rows', done: drawn, total });
        }
      },
      didDrawPage: (d) => runningHead(d.pageNumber),
    });
  }

  // ── the foot of every page: the report, and "Page n of N"
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6 * PT);
    doc.line(SIDE, H - FOOT_H, W - SIDE, H - FOOT_H);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUT);
    doc.text(plain(spec.footNote), SIDE, H - FOOT_H + 2 + 7 * PT);
    doc.text(`Page ${p} of ${pages}`, W - SIDE, H - FOOT_H + 2 + 7 * PT, { align: 'right' });
  }
  onProgress({ phase: 'Saving', done: total, total });
  return doc.output('arraybuffer');
}
