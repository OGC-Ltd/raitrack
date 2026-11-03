import { describe, it, expect } from 'vitest';
import { rowCells, leftWords, periodWords, tankersHtml, counts, csvTable } from './tankersReport';

// The rows come from the server (fleet-server reports/tankers-report.service,
// whose tests read the trips); these are its rows as the page draws them.
const at = (s) => Date.parse(`${s}+03:00`);

describe('Tankers Report: the sheet', () => {
  const to = at('2026-11-03T12:30:00');
  const ctx = { from: to - 4 * 3600_000, to };
  const rows = [
    { unit: { key: 'KCH 123B', plate: 'KCH 123B' }, leftAt: at('2026-11-02T16:00:00'), arrivedAt: null, windowKm: 98.4, tripKm: 412.6, status: 'transit', location: 'Konza Rest Stop' },
    { unit: { key: 'KCV 053A', plate: 'KCV 053A' }, leftAt: at('2026-11-02T14:45:00'), arrivedAt: at('2026-11-03T11:00:00'), windowKm: 40, tripKm: 590, status: 'completed', location: 'MORL' },
  ];

  it('writes each row as the operator’s sheet does', () => {
    expect(rowCells(rows[1], ctx.from, ctx.to)).toEqual(['KCV 053A', '02.11.2026 14:45:00', '08:30-12:30', 'MORL', 'COMPLETED TRIP', '']);
    const first = rowCells(rows[0], ctx.from, ctx.to);
    expect(first.slice(0, 4)).toEqual(['KCH 123B', '02.11.2026 16:00:00', '08:30-12:30', 'Konza Rest Stop']);
    expect(Number(first[5].replace(/,/g, ''))).toBeGreaterThanOrEqual(Number(first[4].replace(/,/g, '')));
    expect(counts(rows)).toMatchObject({ all: 2, completed: 1, transit: 1 });
    expect(csvTable(rows, ctx.from, ctx.to).body[1].at(-1)).toBe('Trip completed');
  });

  it('draws the PDF, coloured as the sheet is', () => {
    const { html, filename } = tankersHtml(rows, { ...ctx, companyName: 'Menengai Oil Refineries Ltd', orgCode: 'MENENGAI', logos: { rai: '', ogc: '' }, now: to });
    expect(html).toContain('TANKERS REPORT');
    expect(html).toContain('Mombasa depot');
    expect(html).toContain('2 in transit to HQ');
    expect(html).not.toContain('system-generated');
    expect(html).toContain('background:#c6efce');
    expect(filename).toBe('Tankers Report Menengai Oil Refineries Ltd 2026-11-03 0830-1230.pdf');
  });

  it('speaks the sheet’s words', () => {
    expect(leftWords(at('2026-11-02T15:54:53'))).toBe('02.11.2026 15:54:53');
    expect(periodWords(at('2026-09-17T08:30:00'), at('2026-09-17T12:30:00'))).toBe('08:30-12:30');
  });
});
