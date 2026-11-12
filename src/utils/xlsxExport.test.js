import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { buildWorkbook, titleFromSlug, fleetFromTitle, cellValue, argb, widthsFor, PAGE_WIDTH } from './xlsxExport';
import { exportExcelVia, downloadTableCsv } from './tableExport';
import { downloadProbeCsv } from './probeReport';

describe('the Excel export (operator, 11 Nov 2026)', () => {
  it('names the report from its file name, and the fleet from the tab title', () => {
    expect(titleFromSlug('deliveries-finished-goods-2026-11-11')).toBe('Deliveries Finished Goods');
    expect(titleFromSlug('unit-trips-2026-11-11')).toBe('Unit Trips');
    expect(titleFromSlug('fuel-fsl')).toBe('Fuel FSL');
    expect(fleetFromTitle('Rai Operations | Menengai Oil Refineries Ltd')).toBe('Menengai Oil Refineries Ltd');
    expect(fleetFromTitle('Rai Operations')).toBe('');
  });
  it('keeps numbers as numbers, plates and times as written', () => {
    expect(cellValue('12.5')).toBe(12.5);
    expect(cellValue(7)).toBe(7);
    expect(cellValue('KDE 268P')).toBe('KDE 268P');
    expect(cellValue('0712345678')).toBe('0712345678');
    expect(cellValue('11.11.2026 06:10:00')).toBe('11.11.2026 06:10:00');
  });
  it('lays out the letterhead, a held header with filters, and the rows\' colours', async () => {
    const rai = { buffer: readFileSync('src/assets/rai-group-logo.jpeg'), extension: 'jpeg' };
    const ogc = { buffer: readFileSync('src/assets/ogc-monitoring-logo.png'), extension: 'png' };
    const head = ['Date', 'Reg No', 'Customer name', 'Destination', 'Current location', 'Departure', 'Arrived at customer', 'Left customer', 'Arrived at yard', 'TAT', 'Delivered'];
    const body = [
      ['11.11.2026', 'KCW 475E', 'KISUMU BYPASS', 'Kisumu', 'D249, Sidindi, Ugunja', '11.11.2026 06:55:46', '11.11.2026 12:20:58', '11.11.2026 12:31:02', '', '', 'Yes'],
      ['11.11.2026', 'KCW 475E', 'AHERO DRIVE', 'Ahero', 'D249, Sidindi, Ugunja', '11.11.2026 06:55:46', '', '', '', '', 'No'],
      ['11.11.2026', 'KDM 138L', 'MOONLIGHT EXPRESS LIMITED, NAKURU', 'Nakuru', 'MORL', '11.11.2026 08:38:36', '11.11.2026 08:49:24', '11.11.2026 08:55:10', '11.11.2026 14:27:15', '5 h 49 min', 'Yes'],
    ];
    const wb = buildWorkbook(ExcelJS, { head, body, title: 'Deliveries Finished Goods', fleet: 'Menengai Oil Refineries Ltd',
      fills: ['#ffff00', '#ff0000', '#ffff00'], now: Date.parse('2026-11-11T18:50:00+03:00') }, { rai, ogc });
    const ws = wb.worksheets[0];
    expect(ws.getCell(6, 1).value).toBe('DELIVERIES FINISHED GOODS');
    const headRow = ws.views[0].ySplit;
    expect(ws.getCell(headRow, 3).value).toBe('Customer name');
    expect(ws.getCell(headRow, 1).fill.fgColor.argb).toBe('FF1F3A5F');
    expect(ws.getCell(headRow + 2, 3).fill.fgColor.argb).toBe('FFFF0000');
    expect(ws.autoFilter.from.row).toBe(headRow);
    expect(ws.getImages()).toHaveLength(2);
    const buf = await wb.xlsx.writeBuffer();
    const out = globalThis.process?.env?.OUT;
    if (out) writeFileSync(out, new Uint8Array(buf));
    expect(buf.byteLength).toBeGreaterThan(5000);
  });
  it('the Excel button takes the rows the report\'s CSV handler gives, and no CSV is saved', async () => {
    const saved = [];
    globalThis.document = { createElement: () => ({ click() { saved.push(this.download); }, set download(v) { saved.push(v); } }), body: { appendChild() {}, removeChild() {} }, title: 'Rai Operations | Menengai' };
    await exportExcelVia(() => downloadTableCsv({ head: ['Plate', 'Km'], body: [['KDE 268P', '12.5']], filenameSlug: 'unit-trips' }));
    delete globalThis.document;
    expect(saved.filter(Boolean)).toHaveLength(1);
    expect(saved.filter(Boolean)[0]).toMatch(/^unit-trips-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
  it('reads short and long colours, and drops what Excel would call broken', () => {
    expect(argb('#fff')).toBe('FFFFFFFF');
    expect(argb('#ff0000')).toBe('FFFF0000');
    expect(argb('red')).toBeNull();
    expect(argb('rgba(0,0,0,.1)')).toBeNull();
  });
  it('keeps columns to their cap after stretching to the page', () => {
    const w = widthsFor([['a', 'b']], 2);
    expect(Math.max(...w)).toBeLessThanOrEqual(60);
    expect(widthsFor([Array.from({ length: 40 }, () => 'x')], 40).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(PAGE_WIDTH);
  });
  it('says so when a CSV handler gave no rows, and never saves a CSV in its place', async () => {
    await expect(exportExcelVia(() => undefined)).rejects.toThrow(/no rows/);
    await expect(exportExcelVia(() => Promise.resolve().then(() => {}))).rejects.toThrow(/later/);
  });
  it('a CSV saved after the Excel click is a CSV, not taken into the Excel file', async () => {
    const saved = [];
    globalThis.document = { createElement: () => ({ click() {}, set download(v) { saved.push(v); } }), body: { appendChild() {}, removeChild() {} }, title: '' };
    globalThis.URL.createObjectURL ??= () => 'blob:x';
    const pending = exportExcelVia(() => downloadTableCsv({ head: ['Plate'], body: [['KDE 268P']], filenameSlug: 'one' }));
    downloadTableCsv({ head: ['Plate'], body: [['KCS 078M']], filenameSlug: 'two' });
    await pending;
    delete globalThis.document;
    expect(saved.find((n) => n.startsWith('two'))).toMatch(/\.csv$/);
    expect(saved.find((n) => n.startsWith('one'))).toMatch(/\.xlsx$/);
  });
  it('the probe export, which writes its own CSV, gives Excel its columns', async () => {
    const saved = [];
    globalThis.document = { createElement: () => ({ click() {}, set download(v) { saved.push(v); } }), body: { appendChild() {}, removeChild() {} }, title: '' };
    await exportExcelVia(() => downloadProbeCsv([{ plate: 'KDE 268P' }], { filenameSlug: 'probes' }));
    delete globalThis.document;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^probes-.*\.xlsx$/);
  });
  it('a document table with colours like #fff and no rows still makes a file', async () => {
    const doc = { title: 'Probe Report', meta: [{ label: 'Fleet', value: 'Sukari & Co' }], blocks: [
      { kind: 'table', head: ['Grouping', 'Direction'], rows: [[{ text: 'VS - KDE 125E', fill: '#fff' }, { text: 'On delivery' }]] },
      { kind: 'table', head: ['Empty'] },
    ] };
    const wb = buildWorkbook(ExcelJS, { doc, fleet: 'Sukari & Co' });
    const ws = wb.worksheets[0];
    expect(ws.headerFooter.oddFooter).toContain('Sukari && Co');
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(3000);
  });
});
