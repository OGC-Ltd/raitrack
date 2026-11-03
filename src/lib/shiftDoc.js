// The end-of-shift report as a document the Reports page paints and the
// operator edits (operator, 2026-11-02). The server answers the document the
// PDF is drawn from (fleet-server end-of-shift.pdf endOfShiftDoc): a title,
// the details under it, and blocks: h2 / h3 headings, figures, tables, notes,
// "none" lines, pairs of sub-tables and the handover. Every text in it may be
// changed, rows and sections left out, notes added; the edited document goes
// back to the server, which draws exactly that (POST reports/end-of-shift.pdf).
//
// Pure: no React, no network. Every change returns a new document.

const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

/** The document with the value at `path` (keys and indexes) set. */
export function setAt(doc, path, value) {
  const out = clone(doc);
  let at = out;
  for (const k of path.slice(0, -1)) at = at[k];
  at[path[path.length - 1]] = value;
  return out;
}

/** The document without one row of a table: `path` leads to the table block (or a pair half's body). */
export function removeRow(doc, tablePath, row) {
  const out = clone(doc);
  let t = out;
  for (const k of tablePath) t = t[k];
  t.rows.splice(row, 1);
  return out;
}

/** Where block `i`'s section ends: the next h2, or the end. */
export function sectionEnd(blocks, i) {
  const next = blocks.findIndex((b, k) => k > i && b.kind === 'h2');
  return next < 0 ? blocks.length : next;
}

/** The document without the section that heading `i` opens (the heading and everything to the next one). */
export function removeSection(doc, i) {
  const out = clone(doc);
  out.blocks.splice(i, sectionEnd(out.blocks, i) - i);
  return out;
}

/** The document without block `i`. */
export function removeBlock(doc, i) {
  const out = clone(doc);
  out.blocks.splice(i, 1);
  return out;
}

/** The document with an empty note at the end of the section heading `i` opens; and where it went. */
export function addNote(doc, i) {
  const out = clone(doc);
  const at = sectionEnd(out.blocks, i);
  out.blocks.splice(at, 0, { kind: 'note', text: '' });
  return { doc: out, at };
}

/** Has anything changed from the document the server answered? */
export function isEdited(original, doc) {
  return Boolean(original && doc) && JSON.stringify(original) !== JSON.stringify(doc);
}

/** What goes back to the server: the document, notes nobody wrote in dropped, every unit's registration given room to print whole. */
export function pdfDoc(doc) {
  return fitUnits({ ...doc, blocks: doc.blocks.filter((b) => !(b.kind === 'note' && !b.text.trim())) });
}

// ── registrations printed whole (operator, 3 Nov 2026) ───────────────────────
//
// The server prints each cell on one line and cuts what does not fit
// ("MUFINDI…"). So before the document goes, each table with a Unit column
// has that column widened to its longest registration, the room taken from
// the column(s) sharing what is left (the driver); when even that is too
// little (the overspeeding half, with three figures beside it), the table's
// type is made smaller, down to 6 pt.

/** Character widths of the PDF's fonts (Helvetica, Helvetica-Bold), thousandths of the type size. */
const W_BOLD = {
  ' ': 278, '-': 333, ':': 333, '.': 278, '/': 278, '(': 333, ')': 333, ',': 278, '&': 722, "'": 238,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
};
const W_REG = {
  ' ': 278, '-': 333, ':': 278, '.': 278, '/': 278, '(': 333, ')': 333, ',': 278, '&': 667, "'": 191,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};
const PT_PER_MM = 72 / 25.4;
/** A text's width in mm at `size` pt. Digits are 556 in both fonts; anything not listed is taken wide. */
export function textMm(text, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let units = 0;
  for (const ch of String(text ?? '')) units += table[ch] ?? (/\d/.test(ch) ? 556 : 750);
  return (units / 1000) * size / PT_PER_MM;
}

/** The printed body's width, mm, and a half of it in a pair (fleet-server lib/pdf/letterhead). */
const BODY_MM = 184;
const HALF_MM = (BODY_MM - 6) / 2;
/** What a cell needs around its text, mm: the server's padding, its hair of margin, and some to spare. */
const CELL_PAD_MM = 1.4 + 1.4 + 1;
const SMALLEST = 6;
/** What the driver keeps when a registration needs the room: past it, the driver is cut, never the registration. */
const SHARED_MIN_MM = 12;

/** One table, its Unit column wide enough for its longest registration. */
export function fitTable(t, basis) {
  if (t?.kind !== 'table') return t;
  const unit = t.head.findIndex((h) => /^\s*unit\s*$/i.test(h));
  if (unit < 0 || !t.cols[unit]?.w) return t;
  const shared = t.cols.map((c, i) => (c.w ? null : i)).filter((i) => i != null);
  const fixedElse = t.cols.reduce((s, c, i) => s + (i === unit ? 0 : c.w || 0), 0);
  const longest = (i, size, bold) => Math.max(0, ...t.rows.map((r) => textMm(r[i]?.text, size, bold ?? Boolean(r[i]?.bold))));
  const unitNeed = (size) => longest(unit, size, true) + CELL_PAD_MM;
  const sharedNeed = (size) => shared.reduce((s, i) => s + Math.min(30, Math.max(SHARED_MIN_MM, longest(i, size) + CELL_PAD_MM)), 0);
  const start = t.size ?? 8.2;
  if (unitNeed(start) <= t.cols[unit].w) return t;
  let size = start;
  let w = null;
  for (let s = start; s >= SMALLEST - 1e-9; s = Math.round((s - 0.2) * 10) / 10) {
    if (unitNeed(s) <= basis - fixedElse - sharedNeed(s)) { size = s; w = unitNeed(s); break; }
  }
  if (w == null) {                                  // too long even small: the driver gives up all but its least
    size = SMALLEST;
    w = Math.min(unitNeed(SMALLEST), basis - fixedElse - shared.length * SHARED_MIN_MM);
  }
  const cols = t.cols.map((c, i) => (i === unit ? { ...c, w: Math.round(Math.max(c.w, w) * 10) / 10 } : c));
  return size === start ? { ...t, cols } : { ...t, cols, size };
}

/** The document with every Unit column fitted, whole-width tables and pair halves alike. */
export function fitUnits(doc) {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (b.kind === 'table') return fitTable(b, BODY_MM);
      if (b.kind === 'pair') return { ...b, halves: b.halves.map((h) => ({ ...h, body: fitTable(h.body, HALF_MM) })) };
      return b;
    }),
  };
}
