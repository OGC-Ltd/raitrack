// A table export on the report letterhead (operator, 17 Nov 2026: the Sensor
// Monitor's PDFs "still use the old templates in all organisations", to move
// onto "the modern one with letterhead and dark and white theme").
//
// The same page every report under Reports prints on (lib/letterhead): the
// dark band with the RAI Group and OGC Monitoring logos, title and report
// number under a rule, a facts table, then the figures and the table. Black,
// white and greys only. The old template (utils/sensorReport) also named
// every fleet "Fleet Tracking"; this names the organisation on screen.
//
// Takes what downloadTablePdf took — finished head/body arrays — so a caller
// moves over without its columns changing. Pure: returns the HTML; the PDF is
// drawn by api/tableLetterheadPdf.

import { renderLetterheadHtml, table, cells, esc } from './letterhead';
import { reportNumber, fitColumns } from './reportLetterhead';
import { textMm } from './shiftDoc';

const fmtDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtGenerated = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** More columns than this go on a page turned on its side. */
const UPRIGHT_MAX_COLS = 7;
/** The page's inner width in mm: A4 less 13 mm a side, upright or on its side (as reportLetterhead). */
const INNER_MM = { upright: 184, landscape: 271 };

/** An empty cell, as the old template wrote it. */
const blank = (s) => s === '' || s === '-' || s === '–';
/** A number, with or without a unit: "12", "1,320", "45%", "320 L", "12 km/h". */
const NUMBER = /^[-+]?\d[\d,]*(\.\d+)?\s*(%|L|km|km\/h)?$/i;
/** A duration: "3h 39m", "33m", "12h". */
const DURATION = /^(\d+h)(\s*\d+m)?$|^\d+m$/;
/** A column every one of whose filled cells is a figure: right-aligned, never wrapped. */
const isFigureCol = (body, i) => {
  const vals = body.map((r) => r[i]).filter((v) => !blank(v));
  return vals.length > 0 && vals.every((v) => NUMBER.test(v) || DURATION.test(v));
};

/**
 * @param {object} o
 * @param {string} o.reportTitle   "Sensor Monitor: Malfunction"
 * @param {string} o.sectionTitle  "50 units"
 * @param {string} o.filterNote    what the reader is looking at
 * @param {{label: string, value: string}[]} [o.cards]
 * @param {string[]} o.head
 * @param {(string|number|null)[][]} o.body
 * @param {string} o.companyName
 * @param {string} [o.orgCode]
 * @param {{rai: string, ogc: string}} o.logos
 * @param {string} [o.prefix]      report-number prefix, "SM" (Sensor Monitor)
 * @param {number} [o.now]
 * @returns {{ html: string, landscape: boolean, filename: string }}
 */
export function tableLetterheadHtml({
  reportTitle, sectionTitle, filterNote, cards = [], head, body,
  companyName, orgCode, logos, prefix = 'SM', now = Date.now(),
}) {
  const rows = (body ?? []).map((r) => r.map((c) => String(c ?? '').trim()));
  const landscape = head.length > UPRIGHT_MAX_COLS;
  const inner = landscape ? INNER_MM.landscape : INNER_MM.upright;
  const keep = head.map((_, i) => i);

  // Widths from what the columns hold, as Overspeeding's (reportLetterhead
  // fitColumns): the wordiest text column gives way first, then the other
  // word columns wrap rather than cut their words short.
  const figure = head.map((_, i) => i > 0 && isFigureCol(rows, i));
  const words = head.filter((_, i) => i > 0 && !figure[i]);
  const longest = (i) => rows.reduce((m, r) => Math.max(m, r[i].length), 0);
  const flex = words.length
    ? words.reduce((a, b) => (longest(head.indexOf(b)) > longest(head.indexOf(a)) ? b : a))
    : null;
  const { widths, wraps } = fitColumns(head, rows, keep, inner, { flex, wrap: words });
  const cols = head.map((h, i) => ({ h: esc(h), w: `${widths[i]}mm`, ...(figure[i] ? { r: true } : {}) }));

  const cell = (v, i) => {
    if (blank(v)) return { html: '-', cls: 'm' };
    if (i === 0) return { html: esc(v), cls: 'b' };
    if (wraps.has(head[i])) return { html: esc(v), cls: 'wrap' };
    return esc(v);
  };

  const flow = [];
  let n = 1;
  if (cards.length) {
    flow.push(`<h2>${n++}. Overview</h2>`);
    flow.push(cells(cards.map((c) => [c.label, esc(c.value)])));
  }
  flow.push(`<h2>${n++}. ${esc(sectionTitle)} <small>${rows.length} row${rows.length === 1 ? '' : 's'}</small></h2>`);
  flow.push(rows.length
    ? table(cols, rows.map((r) => r.map(cell)))
    : '<div class="none">Nothing matched the current filters.</div>');

  const info = [
    ['Fleet', esc(companyName)],
    ['Generated', esc(fmtGenerated.format(now))],
    ['Covers', esc(filterNote)],
  ];

  const title = String(reportTitle).toUpperCase();
  const reportNo = reportNumber(prefix, orgCode, now);
  const html = renderLetterheadHtml({
    title, reportNo, date: fmtDate.format(now), companyName, info, flow,
    footNote: `${companyName} · ${reportTitle}`, logos, landscape,
  });
  const stamp = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  // No ":" in a file name: Windows refuses it ("Sensor Monitor: Malfunction").
  const name = `${reportTitle} ${companyName} ${stamp}`.replace(/\s*[:/\\]\s*/g, ' - ').replace(/[<>"|?*]/g, '');
  return { html, landscape, filename: `${name}.pdf` };
}

/**
 * The same report as plain data, for drawing straight into a PDF
 * (lib/letterheadTablePdf, in a worker): no HTML, no page laid out in the
 * browser. A long table laid out as a page and pictured froze the page
 * (operator, 17 Nov 2026: 7,049 weighbridge tickets).
 *
 * Takes what tableLetterheadHtml takes, less `logos`.
 * @returns {{ title, reportNo, date, info: [string, string][], cards, sectionTitle, rowsWord,
 *   head: string[], body: string[][], cols: { w: number, right: boolean, wrap: boolean, bold: boolean }[],
 *   landscape: boolean, footNote: string, companyName: string, filename: string }}
 */
export function tableLetterheadSpec({
  reportTitle, sectionTitle, filterNote, cards = [], head, body,
  companyName, orgCode, prefix = 'SM', now = Date.now(),
  // Sections drawn before the main table: [{ title, small, head, body }] (the Wialon unit report's
  // "Tracker status now", 2026-11-27). None by default, so every other report is as it was.
  before = [],
}) {
  const rows = (body ?? []).map((r) => r.map((c) => String(c ?? '').trim()));
  const landscape = head.length > UPRIGHT_MAX_COLS;
  const inner = landscape ? INNER_MM.landscape : INNER_MM.upright;
  const figure = head.map((_, i) => i > 0 && isFigureCol(rows, i));
  const { widths, wraps } = pdfWidths(head, rows, figure, inner);
  const stamp = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  const name = `${reportTitle} ${companyName} ${stamp}`.replace(/\s*[:/\\]\s*/g, ' - ').replace(/[<>"|?*]/g, '');
  return {
    title: String(reportTitle).toUpperCase(),
    reportNo: reportNumber(prefix, orgCode, now),
    date: fmtDate.format(now),
    companyName,
    info: [['Fleet', companyName], ['Generated', fmtGenerated.format(now)], ['Covers', filterNote ?? '']],
    cards: cards.map((c) => ({ label: c.label, value: String(c.value) })),
    sectionTitle,
    rowsWord: `${rows.length.toLocaleString('en-GB')} row${rows.length === 1 ? '' : 's'}`,
    head,
    body: rows.map((r) => r.map((v) => (blank(v) ? '-' : v))),
    cols: head.map((h, i) => ({ w: widths[i], right: Boolean(figure[i]), wrap: wraps.has(i), bold: i === 0 })),
    landscape,
    footNote: `${companyName} · ${reportTitle}`,
    filename: `${name}.pdf`,
    before: (before ?? []).filter((b) => b?.head?.length).map((b) => ({
      title: String(b.title ?? ''),
      small: b.small ? String(b.small) : '',
      columns: b.columns === 2 ? 2 : 1,
      head: b.head.map(String),
      body: (b.body ?? []).map((r) => r.map((v) => (blank(String(v ?? '').trim()) ? '-' : String(v).trim()))),
    })),
  };
}

/** Points the PDF table is set in (lib/letterheadTablePdf): cells and headings. */
const PDF_CELL_PT = 7.8;
const PDF_HEAD_PT = 7.2;
const PDF_PAD_MM = 3.2;
/** A word column is not squeezed below this before every column gives way. */
const PDF_WORDS_MIN_MM = 18;

/**
 * Widths for the drawn PDF's table, in mm (operator, 17 Nov 2026: the
 * weighbridge tickets came out 12 rows a page). A heading wraps onto two
 * lines, so only its longest word counts; a column is as wide as its widest
 * cell. Room to spare is shared out evenly. Too little: the word columns give
 * way, widest first, down to PDF_WORDS_MIN_MM, and wrap; then every column in
 * proportion.
 * @returns {{ widths: number[], wraps: Set<number> }} wraps: the column indexes now wrapping
 */
function pdfWidths(head, rows, figure, inner) {
  const word = (h) => String(h).split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
  const need = head.map((h, i) => {
    let cell = 0;
    for (const r of rows) cell = Math.max(cell, textMm(r[i], PDF_CELL_PT, i === 0));
    return Math.max(textMm(word(h), PDF_HEAD_PT, true), cell) + PDF_PAD_MM;
  });
  const widths = [...need];
  const wraps = new Set();
  const total = need.reduce((t, w) => t + w, 0);
  if (total <= inner) {
    const each = (inner - total) / widths.length;
    return { widths: widths.map((w) => Math.round((w + each) * 10) / 10), wraps };
  }
  let over = total - inner;
  const givers = head.map((_, i) => i).filter((i) => i > 0 && !figure[i]).sort((a, b) => widths[b] - widths[a]);
  for (const i of givers) {
    if (over <= 0) break;
    const give = Math.min(over, Math.max(0, widths[i] - PDF_WORDS_MIN_MM));
    if (give > 0) { widths[i] -= give; over -= give; wraps.add(i); }
  }
  const sum = widths.reduce((t, w) => t + w, 0);
  const k = sum > inner ? inner / sum : 1;
  return { widths: widths.map((w) => Math.round(w * k * 10) / 10), wraps };
}
