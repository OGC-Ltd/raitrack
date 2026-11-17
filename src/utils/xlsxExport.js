// The Excel export (operator, 11 Nov 2026: "when generating the reports in csv
// they look too basic. can we apply some designs and even have the letterhead?";
// then "can I have this letterhead and the page cover the whole page (screen)").
// Beside the CSV, not instead of it: on the letterhead (RAI Group and OGC
// Monitoring logos on the dark band, as the PDFs have it), the band and the
// table as wide as a screen, dark header rows with filters, numbers as numbers,
// and a report's own row colours where it has them.
//
// Two shapes come in:
//   - a plain table ({ head, body }): one header row, the rows under it;
//   - a report document (`doc`, the sheet a PDF is drawn from, as lib/docCsv
//     passes it): its details, then each section's bar, figures and tables,
//     each table with its own header row, laid out as the PDF has them.
//
// exceljs is loaded only when a file is made, so the app does not carry it.

import raiLogo from '../assets/rai-group-logo.jpeg';
import ogcLogo from '../assets/ogc-monitoring-logo.png';

const BAND = 'FF222222';
const HEAD = 'FF1F3A5F';
const ZEBRA = 'FFF4F7FB';
const LINE = 'FFD9DEE7';
const MUTED = 'FF5C5C5C';
const WHITE = 'FFFFFFFF';
/** The page's width in Excel's character units: about a laptop screen at 100 %. */
export const PAGE_WIDTH = 200;
const MIN_COL = 9;
const MAX_COL = 60;

const OFFSET = 3 * 3_600_000; // Nairobi
const stamp = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`; };

/** "Deliveries Finished Goods" from "deliveries-finished-goods-2026-11-11"; codes and stamps at the end go. */
export function titleFromSlug(slug) {
  const words = String(slug ?? 'report').replace(/-?\d{4}-\d{2}-\d{2}.*$/, '').split(/[-_\s]+/).filter(Boolean);
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1])) words.pop();
  return words.map((w) => (w.length <= 3 && /^[a-z]+$/.test(w) && !['the', 'and', 'of', 'by', 'per'].includes(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ') || 'Report';
}

/** The organisation's name, as the tab's title has it ("Rai Operations | Menengai Oil Refineries Ltd"). */
export function fleetFromTitle(title) {
  const m = String(title ?? '').split('|');
  return m.length > 1 ? m.slice(1).join('|').trim() : '';
}

/** A plain number stays a number in the sheet, so it adds and sorts; anything else stays as written. */
export function cellValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  const s = String(v ?? '');
  return /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s.trim()) ? Number(s.trim()) : s;
}

const text = (c) => String(c?.text ?? c ?? '');

/**
 * Is column i a column of numbers: every cell that holds something a number, and
 * at least one does? Blanks and dashes ("-", "–") do not count against it, so a
 * count column with a missing value still lines up with its heading.
 */
export function numericColumn(rows, i) {
  let seen = false;
  for (const row of rows ?? []) {
    const raw = text(row?.[i]).trim();
    if (raw === '' || raw === '-' || raw === '–') continue;
    if (typeof cellValue(raw) !== 'number') return false;
    seen = true;
  }
  return seen;
}
/** "#FFFF00" → "FFFFFF00", "#fff" → "FFFFFFFF"; null for anything else, which Excel would call a broken file. */
export function argb(hex) {
  let h = String(hex ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(h) ? `FF${h.toUpperCase()}` : null;
}
const solid = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });

/** Each column's width: from what it holds, then all of them stretched to fill PAGE_WIDTH. */
export function widthsFor(lines, n) {
  const want = Array.from({ length: n }, (_, i) => {
    const longest = lines.reduce((m, row) => Math.max(m, ...String(row[i] ?? '').split('\n').map((s) => s.length)), 0);
    return Math.min(MAX_COL, Math.max(MIN_COL, Math.round(longest * 1.1) + 2));
  });
  const sum = want.reduce((a, w) => a + w, 0);
  const k = sum < PAGE_WIDTH ? PAGE_WIDTH / sum : 1;
  // Still capped after the stretch: two columns are not 100 characters wide each
  return want.map((w) => Math.round(Math.min(MAX_COL, w * k) * 10) / 10);
}

/** The document's parts as plain lines, for the column widths. */
function docLines(doc) {
  const out = [];
  const table = (t) => { out.push(t.head.map(String)); for (const r of t.rows ?? []) out.push(r.map(text)); };
  for (const b of doc?.blocks ?? []) {
    if (b.kind === 'table') table(b);
    if (b.kind === 'pair') for (const h of b.halves ?? []) if (h.body?.kind === 'table') table(h.body);
  }
  return out;
}

/** How many columns the document's widest table has. */
const docCols = (doc) => Math.max(1, ...docLines(doc).map((r) => r.length));

/**
 * The workbook. `ExcelJS`: the library; `logos`: { rai, ogc } as { buffer, extension }, either may be missing.
 * @param {object} o  { head, body, doc, title, fleet, meta: [label, value][], fills: (hex|null)[], headFills: (hex|null)[], now,
 *   sheetName, sheets: { name, title?, body, meta?, fills? }[] }
 *
 * `sheets` (a plain table only): more sheets after the first, each on the same
 * letterhead with the same columns (operator, 17 Nov 2026: all weighbridges in
 * one file, sheet 1 with all of them and a sheet for each weighbridge).
 * `sheetName` names the first sheet's tab; it is the title otherwise.
 */
export function buildWorkbook(ExcelJS, o, logos = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RAI Operations';
  wb.created = new Date(o.now ?? Date.now());
  const tab = tabNamer();
  addSheet(wb, o, logos, tab(o.sheetName ?? titleCase(String(o.doc?.title ?? o.title ?? 'Report'))));
  if (!o.doc) {
    for (const s of o.sheets ?? []) {
      addSheet(wb, { ...o, title: s.title ?? o.title, body: s.body ?? [], meta: s.meta ?? o.meta ?? [], fills: s.fills ?? null }, logos, tab(s.name));
    }
  }
  return wb;
}

/** Tab names Excel accepts: 31 characters at most, none of \ / ? * [ ] :, and no two alike (Excel ignores case). */
export function tabNamer() {
  const used = new Set();
  return (want) => {
    const base = String(want ?? '').replace(/[\\/?*[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const tail = ` (${i})`;
      name = base.slice(0, 31 - tail.length).trimEnd() + tail;
    }
    used.add(name.toLowerCase());
    return name;
  };
}

/** One sheet of the workbook: the letterhead, the details, the table or document, the footer. */
function addSheet(wb, { head = [], body = [], doc = null, title, fleet = '', meta = [], fills = null, headFills = null, now = Date.now() }, logos, tabName) {
  const name = String(doc?.title ?? title ?? 'Report');
  const ws = wb.addWorksheet(tabName, {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    // "&" starts a code in Excel's footers, so a name's own is doubled
    headerFooter: { oddFooter: `&L${`${fleet ? `${fleet} · ` : ''}${titleCase(name)}`.replace(/&/g, '&&')}&RPage &P of &N` },
    views: [{ showGridLines: false }],
  });
  const n = doc ? docCols(doc) : Math.max(head.length, ...body.map((r) => r.length), 1);
  const lines = doc ? docLines(doc) : [head, ...body];
  // At least two columns, so the details have a label and a value
  const cols = Math.max(n, 2);
  const widths = widthsFor(lines, cols);
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const across = (r) => { if (cols > 1) ws.mergeCells(r, 1, r, cols); };

  // The letterhead band over the page's whole width, the logos at its ends
  for (let r = 1; r <= 4; r++) {
    ws.getRow(r).height = 18;
    for (let c = 1; c <= cols; c++) ws.getCell(r, c).fill = solid(BAND);
  }
  const pageWidthPx = widths.reduce((a, w) => a + w * 7.2, 0);
  if (logos.rai) ws.addImage(wb.addImage(logos.rai), { tl: { col: 0.12, row: 0.15 }, ext: { width: 58, height: 70 } });
  if (logos.ogc) ws.addImage(wb.addImage(logos.ogc), { tl: { col: colAt(ws, cols, pageWidthPx - 130), row: 0.9 }, ext: { width: 112, height: 42 } });

  // Title, date, then the details: two to a line, as the PDF has them
  let r = 6;
  ws.getRow(r).height = 26;
  ws.getCell(r, 1).value = name.toUpperCase();
  ws.getCell(r, 1).font = { bold: true, size: 16, color: { argb: 'FF111111' } };
  const dated = doc?.reportNo ? `Report no. ${doc.reportNo} · Date ${doc.date ?? stamp(now).slice(0, 10)}` : `Date ${doc?.date ?? stamp(now).slice(0, 10)}`;
  ws.getCell(r, cols).value = dated;
  ws.getCell(r, cols).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell(r, cols).font = { size: 9, color: { argb: MUTED } };
  for (let c = 1; c <= cols; c++) ws.getCell(r, c).border = { bottom: { style: 'medium', color: { argb: 'FF111111' } } };
  r += 1;
  const details = doc
    ? (doc.meta ?? []).map((m) => [m.label, m.value])
    : [...(fleet ? [['Fleet', fleet]] : []), ...meta, ['Generated', stamp(now)], ['Rows', body.length]];
  for (const [label, value] of details) {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { size: 9, color: { argb: MUTED } };
    ws.getCell(r, 2).value = cellValue(value);
    ws.getCell(r, 2).font = { size: 9, bold: true };
    ws.getCell(r, 2).alignment = { horizontal: 'left' };
    r += 1;
  }
  r += 1;

  // One table: a dark header row, then its rows
  const tableAt = (t, { filter = false, rowFills = null } = {}) => {
    const headRow = r;
    const rows = t.rows ?? [];
    // A column of figures is centred, its heading and its cells alike (operator,
    // 16 Nov 2026: AI Alarm Distribution's headings were left over right-aligned
    // numbers, so each number sat under the next column's heading; then "can we
    // make this centred"). Centred, the heading also clears the filter button.
    const figure = t.head.map((_, i) => t.cols?.[i]?.align === 'right' || numericColumn(rows, i));
    t.head.forEach((h, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = String(h);
      // A head of the sheet's own colour (Menengai's fuel sheet, 13 Nov 2026): dark text on it, thin rules round it
      const own = t.headFills ? (t.headFills[i] ? argb(t.headFills[i]) : 'FFFFFFFF') : null;
      cell.font = { bold: true, color: { argb: own ? 'FF000000' : WHITE }, size: 10 };
      cell.fill = solid(own ?? HEAD);
      if (own) cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: figure[i] ? 'center' : 'left' };
    });
    for (let c = t.head.length + 1; c <= cols; c++) ws.getCell(r, c).fill = solid(HEAD);
    ws.getRow(r).height = 28;
    r += 1;
    rows.forEach((row, i) => {
      const rowFill = rowFills?.[i] ? argb(rowFills[i]) : null;
      row.forEach((v, j) => {
        const cell = ws.getCell(r, j + 1);
        cell.value = cellValue(text(v));
        cell.font = { size: 10, bold: Boolean(v?.bold) };
        // A number in a column of words keeps to the right, as before; a figure column is centred
        cell.alignment = { vertical: 'top', wrapText: true, horizontal: figure[j] ? 'center' : typeof cell.value === 'number' ? 'right' : 'left' };
        cell.border = t.headFills ? { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } } : { bottom: { style: 'thin', color: { argb: LINE } } };
        const fill = (v?.fill && argb(v.fill)) || rowFill || (!t.headFills && i % 2 ? ZEBRA : null);
        if (fill) cell.fill = solid(fill);
      });
      r += 1;
    });
    if (filter && rows.length) ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: t.head.length } };
    return headRow;
  };

  if (!doc) {
    const headRow = tableAt({ head, rows: body, headFills }, { filter: true, rowFills: fills });
    ws.views = [{ state: 'frozen', ySplit: headRow, showGridLines: false }];
  } else {
    // Each section as the PDF has it
    const tables = (doc.blocks ?? []).filter((b) => b.kind === 'table').length;
    for (const b of doc.blocks ?? []) {
      switch (b.kind) {
        case 'h2': case 'bar': {
          r += b.kind === 'h2' ? 1 : 0;
          const dark = b.kind === 'bar';
          for (let c = 1; c <= cols; c++) ws.getCell(r, c).fill = solid(dark ? BAND : 'FFE9EEF5');
          ws.getCell(r, 1).value = b.title;
          ws.getCell(r, 1).font = { bold: true, size: 11, color: { argb: dark ? WHITE : 'FF1F3A5F' } };
          if (b.aside && cols > 1) {
            ws.getCell(r, cols).value = b.aside;
            ws.getCell(r, cols).font = { size: 9, color: { argb: dark ? WHITE : MUTED } };
            ws.getCell(r, cols).alignment = { horizontal: 'right', vertical: 'middle' };
          }
          ws.getRow(r).height = 22;
          r += 1;
          break;
        }
        case 'h3':
          ws.getCell(r, 1).value = b.aside ? `${b.title} (${b.aside})` : b.title;
          ws.getCell(r, 1).font = { bold: true, size: 10 };
          r += 1;
          break;
        case 'figures': {
          // Labels across, their values under them
          const items = b.items ?? [];
          for (let i = 0; i < items.length; i += cols) {
            items.slice(i, i + cols).forEach((it, j) => {
              ws.getCell(r, j + 1).value = it.label;
              ws.getCell(r, j + 1).font = { size: 9, color: { argb: MUTED } };
              ws.getCell(r + 1, j + 1).value = cellValue(it.value);
              ws.getCell(r + 1, j + 1).font = { size: 14, bold: true };
              ws.getCell(r + 1, j + 1).alignment = { horizontal: 'left' };
            });
            r += 2;
          }
          r += 1;
          break;
        }
        case 'table':
          tableAt(b, { filter: tables === 1 });
          r += 1;
          break;
        case 'pair':
          for (const h of b.halves ?? []) {
            ws.getCell(r, 1).value = h.aside ? `${h.title} (${h.aside})` : h.title;
            ws.getCell(r, 1).font = { bold: true, size: 10 };
            r += 1;
            if (h.body?.kind === 'table') { tableAt(h.body); r += 1; } else if (h.body?.text) { ws.getCell(r, 1).value = h.body.text; r += 2; }
          }
          break;
        case 'none': case 'note':
          if (b.text?.trim()) {
            across(r);
            ws.getCell(r, 1).value = b.text;
            ws.getCell(r, 1).font = { size: 9, italic: true, color: { argb: MUTED } };
            ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' };
            ws.getRow(r).height = Math.min(90, 15 * Math.ceil(b.text.length / 180));
            r += 2;
          }
          break;
        default: break;
      }
    }
  }

  r += 1;
  ws.getCell(r, 1).value = doc?.footer ?? `${fleet ? `${fleet} · ` : ''}${titleCase(name)} · ${stamp(now)}`;
  ws.getCell(r, 1).font = { size: 8, italic: true, color: { argb: MUTED } };
  ws.getCell(r + 1, 1).value = 'RAI Operations · OGC Monitoring';
  ws.getCell(r + 1, 1).font = { size: 8, color: { argb: MUTED } };
  ws.pageSetup.printArea = `A1:${colName(cols)}${r + 1}`;
  return ws;
}

const titleCase = (s) => String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
function colName(n) { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; }
/** The column (fractional) at `px` from the page's left, for placing the OGC logo at the band's right end. */
function colAt(ws, cols, px) {
  let left = 0;
  for (let c = 1; c <= cols; c++) {
    const w = (ws.getColumn(c).width ?? 9) * 7.2;
    if (left + w >= px) return c - 1 + Math.max(0, (px - left) / w);
    left += w;
  }
  return Math.max(0, cols - 1);
}

async function logoBuffer(url, extension) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return { buffer: await res.arrayBuffer(), extension };
  } catch { return null; }
}

/** Make the .xlsx and download it. Same arguments as downloadTableCsv, plus optional doc, title, meta, fills, sheetName and sheets. */
export async function downloadTableXlsx({ head, body, doc = null, filenameSlug = 'report', title = null, meta = [], fills = null, headFills = null, sheetName, sheets }) {
  const { default: ExcelJS } = await import('exceljs');
  const [rai, ogc] = await Promise.all([logoBuffer(raiLogo, 'jpeg'), logoBuffer(ogcLogo, 'png')]);
  const wb = buildWorkbook(ExcelJS, {
    head, body, doc, fills, headFills, meta, sheetName, sheets,
    title: title ?? titleFromSlug(filenameSlug),
    fleet: fleetFromTitle(typeof document !== 'undefined' ? document.title : ''),
  }, { rai, ogc });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameSlug}-${new Date(Date.now() + OFFSET).toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
