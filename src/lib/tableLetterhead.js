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
