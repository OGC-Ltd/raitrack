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

/** What goes back to the server: the document, notes nobody wrote in dropped. */
export function pdfDoc(doc) {
  return { ...doc, blocks: doc.blocks.filter((b) => !(b.kind === 'note' && !b.text.trim())) };
}
