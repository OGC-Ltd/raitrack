import { describe, it, expect } from 'vitest';
import { setAt, removeRow, removeSection, removeBlock, addNote, sectionEnd, isEdited, pdfDoc, fitTable, textMm } from './shiftDoc';

const doc = {
  title: 'END OF SHIFT REPORT', reportNo: 'ES-1', date: '02/11/2026',
  meta: [{ label: 'Fleet', value: 'Menengai' }],
  blocks: [
    { kind: 'h2', title: '1. Overview' },
    { kind: 'figures', items: [{ label: 'Fuel refills', value: '3 · 400 L' }] },
    { kind: 'h2', title: '2. Thefts' },
    { kind: 'table', cols: [{ w: 0 }], head: ['Unit'], rows: [[{ text: 'KDL 715E' }], [{ text: 'KDL 240X' }]] },
    { kind: 'pair', halves: [{ title: 'Overspeeding', body: { kind: 'table', cols: [{ w: 0 }], head: ['Unit'], rows: [[{ text: 'A' }], [{ text: 'B' }]] } }] },
    { kind: 'h2', title: '3. Handover' },
    { kind: 'handover', lines: ['', ''], signatures: ['Prepared by', 'Received by'] },
  ],
  footer: 'Menengai · End of shift report',
};

describe('editing the end-of-shift document', () => {
  it('sets any text without touching the original', () => {
    const out = setAt(doc, ['blocks', 3, 'rows', 0, 0, 'text'], 'KDL 999Z');
    expect(out.blocks[3].rows[0][0].text).toBe('KDL 999Z');
    expect(doc.blocks[3].rows[0][0].text).toBe('KDL 715E');
    expect(setAt(doc, ['meta', 0, 'value'], 'Sukari').meta[0].value).toBe('Sukari');
  });

  it('leaves a row out of a table, or of a pair half', () => {
    expect(removeRow(doc, ['blocks', 3], 0).blocks[3].rows.map((r) => r[0].text)).toEqual(['KDL 240X']);
    expect(removeRow(doc, ['blocks', 4, 'halves', 0, 'body'], 1).blocks[4].halves[0].body.rows).toHaveLength(1);
  });

  it('leaves a whole section out: its heading up to the next', () => {
    expect(sectionEnd(doc.blocks, 2)).toBe(5);
    expect(removeSection(doc, 2).blocks.map((b) => b.kind)).toEqual(['h2', 'figures', 'h2', 'handover']);
    expect(removeBlock(doc, 1).blocks).toHaveLength(6);
  });

  it('adds a note at the end of a section; an empty one is not sent', () => {
    const { doc: out, at } = addNote(doc, 0);
    expect(at).toBe(2);
    expect(out.blocks[2]).toEqual({ kind: 'note', text: '' });
    expect(pdfDoc(out).blocks).toHaveLength(doc.blocks.length);
    expect(pdfDoc(setAt(out, ['blocks', 2, 'text'], 'Checked by hand')).blocks).toHaveLength(doc.blocks.length + 1);
  });

  it('knows when the document was edited', () => {
    expect(isEdited(doc, JSON.parse(JSON.stringify(doc)))).toBe(false);
    expect(isEdited(doc, setAt(doc, ['blocks', 6, 'lines', 0], 'All units in'))).toBe(true);
  });
});

describe('registrations printed whole', () => {
  const plates = ['MUFINDI - KDA 123B', 'MUFINDI: KCX 456Y', 'MUFINDI - KCB 220M'];
  const t = (head, cols) => ({ kind: 'table', size: 7.4, cols, head,
    rows: plates.map((p) => [{ text: p, bold: true }, { text: 'Not recorded' }, ...head.slice(2).map(() => ({ text: '6', bold: true }))]) });
  const longest = (size) => Math.max(...plates.map((p) => textMm(p, size, true)));

  it('widens the Unit column to the longest registration, and makes the type smaller only when it must', () => {
    const doc = { blocks: [{ kind: 'pair', halves: [
      { title: 'Overspeeding', body: t(['Unit', 'Driver', 'Time over', 'Avg over', 'Top / limit'], [{ w: 16 }, { w: 0 }, { w: 17 }, { w: 15 }, { w: 16 }]) },
      { title: 'No seatbelt', body: t(['Unit', 'Driver', 'Times'], [{ w: 18 }, { w: 0 }, { w: 13 }]) },
    ] }] };
    const [speed, belt] = pdfDoc(doc).blocks[0].halves.map((h) => h.body);
    expect(belt.size).toBe(7.4);
    expect(belt.cols[0].w).toBeGreaterThan(longest(7.4) + 2.8);
    expect(speed.size).toBeLessThan(7.4);
    expect(speed.size).toBeGreaterThanOrEqual(6);
    expect(speed.cols[0].w).toBeGreaterThan(longest(speed.size) + 2.8);
  });

  it('leaves a table alone when its registrations already fit', () => {
    const b = { kind: 'table', cols: [{ w: 40 }, { w: 0 }], head: ['Unit', 'Driver'], rows: [[{ text: 'KDA 123B', bold: true }, { text: 'A' }]] };
    expect(fitTable(b, 184)).toBe(b);
  });
});
