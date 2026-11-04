// A report document (the sheet the server draws from, reports/document.pdf:
// title, details, blocks) laid out on the letterhead in the browser
// (lib/letterhead), for a JPEG that is one continuous list rather than A4
// pages one under another (operator, 4 Nov 2026: "in jpeg, instead of having
// break pages, I want the list to be continuous"). The PDF is still the
// server's.
//
// Pure: returns an HTML string.

import { renderLetterheadHtml, table, cells, esc } from './letterhead';

const FLAG = '#c62828';
const BODY_MM = { portrait: 184, landscape: 271 };

/** One table's columns: widths in mm, 0 sharing what is left. */
function colsOf(t, bodyMm) {
  const fixed = t.cols.reduce((s, c) => s + (c.w || 0), 0);
  const flex = t.cols.filter((c) => !c.w).length;
  const rest = flex ? Math.max(10, (bodyMm - fixed) / flex) : 0;
  return t.cols.map((c, i) => ({ h: esc(t.head[i] ?? ''), w: `${c.w || rest}mm`, r: c.align === 'right' }));
}

const cellHtml = (c, col) => ({
  html: esc(c?.text ?? ''),
  cls: [c?.bold ? 'b' : '', col?.wrap ? 'wrap' : ''].filter(Boolean).join(' ') || undefined,
  style: [c?.fill ? `background:${c.fill}` : null, c?.tone === 'flag' ? `color:${FLAG}` : c?.tone === 'mut' ? 'color:#5c5c5c' : null].filter(Boolean).join(';') || undefined,
});

/** The blocks as the letterhead's flow. */
export function docFlow(blocks, { landscape = false } = {}) {
  const bodyMm = BODY_MM[landscape ? 'landscape' : 'portrait'];
  const out = ['<style>.dbar{background:#e9eef5;border-left:2.4pt solid #1f3a5f;font-weight:700;text-align:center;padding:1.2mm 2mm;margin:4mm 0 1mm;font-size:8.6pt;letter-spacing:.04em}.dbar small{float:right;font-weight:400;letter-spacing:0;color:#5c5c5c;font-size:7.4pt}</style>'];
  for (const b of blocks ?? []) {
    switch (b.kind) {
      case 'h2': out.push(`<h2>${esc(b.title)}${b.aside ? ` <small>${esc(b.aside)}</small>` : ''}</h2>`); break;
      case 'h3': out.push(`<h2 style="font-size:8pt;border:0">${esc(b.title)}${b.aside ? ` <small>${esc(b.aside)}</small>` : ''}</h2>`); break;
      case 'bar': out.push(`<div class="dbar">${esc(b.title)}${b.aside ? `<small>${esc(b.aside)}</small>` : ''}</div>`); break;
      case 'figures': out.push(cells(b.items.map((i) => [i.label, i.flag ? `<b style="color:${FLAG}">${esc(i.value)}</b>` : esc(i.value)]))); break;
      case 'table': out.push(table(colsOf(b, bodyMm), b.rows.map((row) => row.map((c, i) => cellHtml(c, b.cols[i]))))); break;
      case 'none': out.push(`<div class="none">${esc(b.text)}</div>`); break;
      case 'note': if (b.text?.trim()) out.push(`<div class="note">${esc(b.text)}</div>`); break;
      default: break;
    }
  }
  return out;
}

/**
 * The document as one long letterhead page, for the continuous JPEG.
 * @param {object} doc  title, reportNo, date, meta [{label, value}], blocks, footer
 */
export function docHtml(doc, { logos, landscape = false, continuous = true }) {
  const fleet = doc.meta?.find((m) => /^fleet$/i.test(m.label))?.value ?? '';
  return renderLetterheadHtml({
    title: doc.title,
    reportNo: doc.reportNo,
    date: doc.date,
    companyName: fleet,
    info: (doc.meta ?? []).map((m) => [m.label, esc(m.value)]),
    flow: docFlow(doc.blocks, { landscape }),
    footNote: doc.footer,
    logos,
    landscape,
    continuous,
  });
}
