import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { isMorlFcr, morlFcrRows, morlFcrCells, morlFcrTable, rateScale, fcrMorlDoc, morlFcrSheet, probeStatus, expectedFigures, MORL_FCR_HEADS, RATE_COL, EXPECT_COL, THEFT_COL, COMMENT_COL, ABOVE_FILL } from './fuelRateMorl';
import { buildWorkbook } from '../utils/xlsxExport';

// As the server sends them (reports/fuel-consumption-rate), figures from Menengai's own sheet
const row = (plate, km, startL, filledL, endL, theftL = 0, target = 6.5) => {
  const consumedL = Math.round((startL + filledL - theftL - endL) * 100) / 100;
  return { vehicleId: plate, plate, target: { kmPerL: target, words: `${target} km/L` }, distanceKm: km, startL, filledL, theftL, endL,
    consumedL, kmPerL: Math.round((km / consumedL) * 100) / 100 };
};
const KBE = row('KBE 726E', 546, 95.44, 37.03, 33.41);
const KDA = row('KDA 258J', 958, 80.85, 364.76, 109.44);
const KCP = row('KCP 145P', 776, 132.3, 315.38, 176.44, 0, 2.5);
const THEFT = row('KCH 467T', 838, 96.25, 144.25, 45.38, 20);

describe("Menengai's fuel consumption sheet (operator, 13 Nov 2026)", () => {
  it('for Menengai only', () => {
    expect(isMorlFcr('MENENGAI')).toBe(true);
    expect(isMorlFcr('menengai')).toBe(true);
    expect(isMorlFcr('SUKARI')).toBe(false);
  });
  it('their columns, in their order, with Expected before the Comment (25 Nov 2026)', () => {
    expect(MORL_FCR_HEADS).toEqual(['Reg', 'Target Consumption', 'Missed Fillings', 'Missing (Recorded by MORL, Missing on Track3)',
      'Actual Theft', 'Return Pipe Theft', 'Total Distance Covered', 'Initial Level', 'Amount Filled', 'Final Level',
      'Amnt Consumed (With Thefts)', 'Consumption Rate (With Thefts)', 'Amnt Consumed (Minus Thefts)', 'Consumption Rate (Minus Thefts)', 'Expected Consumption (L)', 'Expected', 'Possible Theft (L)', 'Comment']);
  });
  it('a row as their sheet has it: KBE 726E', () => {
    const [r] = morlFcrRows([KBE]);
    // 546 km at 6.5 km/L is 84 L expected; 99.06 L used is 15.06 L over (more than 10% and 5 L)
    expect(morlFcrCells(r)).toEqual(['KBE 726E', '6.5', '', '', '0', '', '546', '95.44', '37.03', '33.41', '99.06', '5.51', '99.06', '5.51', '84', 'Above expected', '15.06', 'PROBE OK']);
  });
  it('with thefts counts the theft in, minus thefts leaves it out', () => {
    const [r] = morlFcrRows([THEFT]);
    expect(r.withL).toBeCloseTo(195.12, 2);
    expect(r.minusL).toBeCloseTo(175.12, 2);
    expect(r.withRate).toBeLessThan(r.minusRate);
  });
  it('best rate first; the last rate green at the best, yellow at the lowest', () => {
    const { list, body } = morlFcrTable([KCP, KDA, KBE]);
    expect(list.map((r) => r.plate)).toEqual(['KBE 726E', 'KCP 145P', 'KDA 258J']);
    expect(body[0][RATE_COL].fill).toBe('#63be7b');
    expect(body[2][RATE_COL].fill).toBe('#ffeb84');
    expect(body[1][RATE_COL].fill).not.toBe(body[0][RATE_COL].fill);
    expect(body[0][0].bold).toBeUndefined();          // plain, as theirs
  });
  it('a unit without a measured rate: last, no shade, its reason as the comment', () => {
    const odd = { vehicleId: 'x', plate: 'KAA 001A', target: null, distanceKm: 0, startL: null, endL: null, filledL: 0, theftL: 0, consumedL: null, kmPerL: null, note: 'No fuel readings' };
    const { list, body } = morlFcrTable([odd, KBE]);
    expect(list[1].plate).toBe('KAA 001A');
    expect(body[1][RATE_COL].fill).toBeUndefined();
    expect(body[1][COMMENT_COL].text).toBe('No fuel readings');
    expect(body[1][EXPECT_COL].text).toBe('');
  });
  it('the Comment is the probe\u2019s status: a rate that cannot be real is PROBE ISSUE, last of the measured, unshaded (25 Nov 2026)', () => {
    // KDE 125E on 17-24 Nov: 48 km on 0.1 L = 480 km/L against a 6.5 target
    const stuck = row('KDE 125E', 48, 36.8, 0, 36.7);
    const { list, body } = morlFcrTable([stuck, KBE, KDA]);
    expect(list.map((r) => r.plate)).toEqual(['KBE 726E', 'KDA 258J', 'KDE 125E']);
    expect(list[2].words).toBe('PROBE ISSUE');
    expect(body[2][RATE_COL].fill).toBeUndefined();
    expect(body[2][EXPECT_COL].text).toBe('');
    // the scale runs over believed rates only: the best of them is green, not the stuck one
    expect(body[0][RATE_COL].fill).toBe('#63be7b');
  });
  it('probe status: the server\u2019s reason first; twice the target, 15 km/L without one, or moved and used none', () => {
    expect(probeStatus({ note: 'No fuel probe', minusRate: 5 })).toBe('No fuel probe');
    expect(probeStatus({ minusRate: 13, targetKmPerL: 6.5 })).toBe('PROBE OK');
    expect(probeStatus({ minusRate: 13.1, targetKmPerL: 6.5 })).toBe('PROBE ISSUE');
    expect(probeStatus({ minusRate: 63.27, targetKmPerL: 2.5 })).toBe('PROBE ISSUE');
    expect(probeStatus({ minusRate: 14, targetKmPerL: null })).toBe('PROBE OK');
    expect(probeStatus({ minusRate: 16, targetKmPerL: null })).toBe('PROBE ISSUE');
    expect(probeStatus({ minusRate: null, minusL: 0, distanceKm: 120 })).toBe('PROBE ISSUE');
    expect(probeStatus({ minusRate: null, minusL: null, distanceKm: 0 })).toBe('');
  });
  it('Expected: below the target\u2019s km/L is Above expected, in red; at or over it, Within; nothing without a believed rate or a target', () => {
    // KDE 126E, 17-24 Nov: 551.9 km at 6.5 is 84.9 L expected; 103.6 L used is 18.7 L over: above, and that is the possible theft
    expect(expectedFigures({ words: 'PROBE OK', minusL: 103.6, distanceKm: 551.9, targetKmPerL: 6.5 })).toMatchObject({ expected: 'Above expected' });
    expect(expectedFigures({ words: 'PROBE OK', minusL: 103.6, distanceKm: 551.9, targetKmPerL: 6.5 }).possibleTheftL).toBeCloseTo(18.69, 2);
    // KCB 234J: 100.3 km at 7.5 is 13.4 L expected; 14.3 L used is 0.9 L over: within (under 5 L and 10%)
    expect(expectedFigures({ words: 'PROBE OK', minusL: 14.3, distanceKm: 100.3, targetKmPerL: 7.5 })).toMatchObject({ expected: 'Within expected', possibleTheftL: null });
    // 6 L over 100 L expected: over 5 L but under 10%, within
    expect(expectedFigures({ words: 'PROBE OK', minusL: 106, distanceKm: 650, targetKmPerL: 6.5 }).expected).toBe('Within expected');
    // KDE 133E used less than expected
    expect(expectedFigures({ words: 'PROBE OK', minusL: 197.6, distanceKm: 1401, targetKmPerL: 6.5 }).expected).toBe('Within expected');
    expect(expectedFigures({ words: 'PROBE ISSUE', minusL: 0.1, distanceKm: 48, targetKmPerL: 6.5 })).toMatchObject({ expected: '', possibleTheftL: null });
    expect(expectedFigures({ words: 'PROBE OK', minusL: 50, distanceKm: 300, targetKmPerL: null })).toEqual({ expectedL: null, expected: '', possibleTheftL: null });
    const { body } = morlFcrTable([KBE, KDA]);
    const kbe = body.find((c) => c[0].text === 'KBE 726E');
    expect(kbe[EXPECT_COL]).toEqual({ text: 'Above expected', fill: ABOVE_FILL });
    expect(kbe[THEFT_COL]).toEqual({ text: '15.06', fill: ABOVE_FILL });
  });
  it('the server’s tracker fault comes through with its reason, sorted with the probe issues, no Expected', () => {
    const lost = { ...row('KCX 001A', 300, 80, 0, 40), note: 'PROBE ISSUE: Lost Contact with Tubes Error - Needs Replacement' };
    const none = { vehicleId: 'x', plate: 'KAA 001A', target: null, distanceKm: 0, startL: null, endL: null, filledL: 0, theftL: 0, consumedL: null, kmPerL: null, note: 'No fuel probe' };
    const { list, body } = morlFcrTable([none, lost, KBE]);
    expect(list.map((r) => r.plate)).toEqual(['KBE 726E', 'KCX 001A', 'KAA 001A']);
    expect(body[1][COMMENT_COL].text).toBe('PROBE ISSUE: Lost Contact with Tubes Error - Needs Replacement');
    expect(body[1][EXPECT_COL].text).toBe('');
    expect(body[1][RATE_COL].fill).toBeUndefined();
  });
  it('one rate alone is green', () => {
    expect(rateScale([4.2])(4.2)).toBe('#63be7b');
  });
  it('the PDF: their head row first, each cell its colour', () => {
    const d = fcrMorlDoc([KBE, KDA], { from: '2026-11-12', to: '2026-11-13', fleet: 'Menengai Oil Refineries Ltd', orgCode: 'MENENGAI', now: Date.UTC(2026, 10, 13, 15) });
    const t = d.blocks.find((b) => b.kind === 'table');
    expect(d.blocks[0]).toMatchObject({ kind: 'bar', title: '12.11.2026 TO 13.11.2026' });
    expect(t.rows[0].map((c) => c.text)).toEqual(MORL_FCR_HEADS);
    expect(t.rows[0][0].fill).toBe('#9dc3e6');
    expect(t.rows[0][10].fill).toBe('#ffc000');
    expect(t.rows[0][12].fill).toBe('#00b050');
    expect(t.rows[0][14].fill).toBe('#9dc3e6');
    expect(t.rows[0][16].fill).toBe('#9dc3e6');
    expect(t.rows[0][COMMENT_COL].fill).toBeUndefined();
    expect(Math.round(t.cols.reduce((n, c) => n + c.w, 0))).toBe(271);
    expect(d.landscape).toBe(true);
  });
  it('the Excel file: their heads coloured, the scale on the rate', () => {
    const s = morlFcrSheet([KBE, KDA]);
    const wb = buildWorkbook(ExcelJS, { head: s.head, body: s.body, headFills: s.headFills, title: 'Fuel Consumption Rate' });
    const ws = wb.worksheets[0];
    let headRow = null;
    ws.eachRow((r, n) => { if (r.getCell(1).value === 'Reg') headRow = n; });
    expect(ws.getCell(headRow, 1).fill.fgColor.argb).toBe('FF9DC3E6');
    expect(ws.getCell(headRow, 11).fill.fgColor.argb).toBe('FFFFC000');
    expect(ws.getCell(headRow, 13).fill.fgColor.argb).toBe('FF00B050');
    expect(ws.getCell(headRow + 1, 14).fill.fgColor.argb).toBe('FF63BE7B');
  });
});

describe("Menengai's sheet as a CSV (review, 13 Nov 2026)", async () => {
  const { morlFcrSheet } = await import('./fuelRateMorl');
  const { buildCsv } = await import('../utils/tableExport');
  it('writes the cells, not [object Object]', () => {
    const s = morlFcrSheet([{ plate: 'KCK 456G', distanceKm: 100, consumedL: 50, theftL: 0, startL: 200, filledL: 0, endL: 150, kmPerL: 2 }]);
    const csv = buildCsv(s.head, s.body);
    expect(csv).not.toContain('[object Object]');
    expect(csv.split('\r\n')[1].startsWith('KCK 456G,')).toBe(true);
  });
});
