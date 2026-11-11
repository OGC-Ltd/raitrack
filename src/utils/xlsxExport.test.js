import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { buildWorkbook, titleFromSlug, fleetFromTitle, cellValue } from './xlsxExport';
import { exportExcelVia, downloadTableCsv } from './tableExport';

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
});
