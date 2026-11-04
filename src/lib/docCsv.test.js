import { describe, it, expect } from 'vitest';
import { docCsv, docSlug } from './docCsv';

describe('a report document as CSV', () => {
  it('lists the details, sections, figures, tables and notes in order', () => {
    const doc = {
      title: 'MOVEMENTS REPORT', reportNo: 'MV-1', date: '04.11.2026', docName: 'Movements Report Menengai 2026-11-04',
      meta: [{ label: 'Fleet', value: 'Menengai' }],
      blocks: [
        { kind: 'h2', title: '1. Overview' }, { kind: 'figures', items: [{ label: 'Vehicles', value: '7' }] },
        { kind: 'h2', title: 'Van Sales', aside: '2 vehicles' },
        { kind: 'table', cols: [{}, {}], head: ['Grouping', 'Direction'], rows: [[{ text: 'VS - KDE 125E', fill: '#fff' }, { text: 'On delivery' }]] },
        { kind: 'pair', halves: [{ title: 'Left', body: { kind: 'none', text: 'None' } }] },
        { kind: 'note', text: 'Places from the platform.' }, { kind: 'note', text: '  ' },
        { kind: 'handover', lines: ['All well', ''], signatures: [] },
      ],
    };
    const { head, body } = docCsv(doc);
    expect(head).toEqual(['MOVEMENTS REPORT']);
    expect(body).toEqual([
      ['Fleet', 'Menengai'], ['Date', '04.11.2026'], ['Report no.', 'MV-1'],
      [], ['1. Overview'], ['Vehicles', '7'],
      [], ['Van Sales (2 vehicles)'], ['Grouping', 'Direction'], ['VS - KDE 125E', 'On delivery'],
      ['Left'], ['None'], ['Places from the platform.'], [], ['Handover'], ['All well'],
    ]);
    expect(docSlug(doc)).toBe('movements-report-menengai-2026-11-04');
  });
});
