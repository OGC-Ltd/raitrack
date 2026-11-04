import { describe, it, expect } from 'vitest';
import { docHtml, docFlow } from './docHtml';

const doc = {
  title: 'MOVEMENT REPORT', reportNo: 'MV-MENENGAI-20261104-1307', date: '04/11/2026',
  meta: [{ label: 'Fleet', value: 'Menengai Oil Refineries Ltd' }, { label: 'Window', value: '1 hour' }],
  blocks: [
    { kind: 'h2', title: '1. Overview', aside: '1 hour' },
    { kind: 'figures', items: [{ label: 'Vehicles', value: '72' }, { label: 'Not reporting', value: '8', flag: true }] },
    { kind: 'table', size: 7.6, cols: [{ w: 54 }, { w: 30 }, { w: 0, wrap: true }], head: ['Grouping', 'Last coordinates', 'Location'],
      rows: [[{ text: 'VS - Menengai - KDE 125E', bold: true }, { text: '04.11.2026 13:06:20' }, { text: 'Nanyuki Road', fill: '#9cc7f5' }]] },
    { kind: 'note', text: 'Blue: Van Sales at the Nairobi depot.' },
  ],
  footer: 'Menengai Oil Refineries Ltd · Movement Report',
};

describe('A report document as one long letterhead page', () => {
  it('is one page, not dealt onto A4 pages', () => {
    const html = docHtml(doc, { logos: { rai: '', ogc: '' } });
    expect(html).toContain('class="page long"');
    expect(html).not.toContain('tpl-next');
    expect(html).toContain('MOVEMENT REPORT');
    expect(html).toContain('background:#9cc7f5');
    expect(html.indexOf('Blue: Van Sales')).toBeGreaterThan(html.indexOf('KDE 125E'));
  });

  it('shares what is left of the width with the column given none', () => {
    const flow = docFlow(doc.blocks).join('');
    expect(flow).toContain('width:100mm');
    expect(flow).toContain('color:#c62828');
  });
});
