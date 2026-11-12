import { describe, it, expect, afterEach } from 'vitest';
import { fgLines, fgCells, fgCsv, finishedGoodsDoc, fgDueNotes, regOf, FG_HEADS, FG_FILL, fgState, fgFill, loadTemplate, saveTemplate } from './finishedGoodsReport';

// 30.10.2026 in Nairobi, as epoch ms
const at = (hhmm) => Date.parse(`2026-10-30T${hhmm}:00+03:00`);
const MORL = { key: 'morl', label: 'MORL', short: 'MORL' };
const sheetRow = {
  key: 'sheet:p1', plate: 'KCP 136P', place: 'Thanju',
  trip: { leftAt: at('04:05'), leftFrom: MORL, arrivedAt: null, arrivedTo: null },
  customers: [
    { name: 's1', label: '100 MAGUNA ANDU MAKUTANO', at: at('13:15'), stayMs: 45 * 60_000, stop: { name: 'MAGUNA ANDU MAKUTANO', location: 'Makutano, Kenya' } },
    { name: 's2', label: '101 RAFIKI KALOKOL', at: null, stop: { name: 'RAFIKI - KALOKOL', location: 'Kalokol' } },
  ],
};
const backRow = {
  key: 'KCT 346W', plate: 'KCT 346W', place: 'STO',
  trip: { leftAt: at('06:44'), arrivedAt: at('18:10'), arrivedTo: { key: 'nairobi', label: 'Nairobi depot', short: 'STO' } },
  customers: [{ name: 'SALAMA TWO WHOLESALERS', label: 'SALAMA TWO WHOLESALERS', at: at('11:14') }],
};
const parked = { key: 'KDE 268P', plate: 'KDE 268P', place: 'MORL', trip: { leftAt: null, inStorage: MORL, why: 'At MORL' }, customers: [] };

describe('Finished Goods template: one line per customer', () => {
  const lines = fgLines([sheetRow, backRow, parked], { at: at('20:00') });
  it('lays out the ten columns of the sheet', () => {
    expect(FG_HEADS).toHaveLength(10);
    expect(fgCells(lines[0])).toEqual(['30.10.2026', 'KCP 136P', 'Maguna Andu Makutano', 'Makutano', 'Thanju',
      '30.10.2026 04:05:00', '30.10.2026 13:15:00', '30.10.2026 14:00:00', '', '']);
  });
  it('yellow when reached, red when not', () => {
    expect(lines.map((l) => l.delivered)).toEqual([true, false, true, false]);
    expect(fgCells(lines[1]).slice(6, 8)).toEqual(['', '']);
  });
  it('green for a completed trip: delivered, then back at the yard', () => {
    expect(lines.map(fgState)).toEqual(['ok', 'miss', 'done', 'miss']);
    expect(fgFill(lines[2])).toBe(FG_FILL.done);
    expect(fgCsv(lines).fills).toEqual([FG_FILL.ok, FG_FILL.miss, FG_FILL.done, FG_FILL.miss]);
    // Back at the yard, but this customer never reached: still red
    const missedBack = fgLines([{ ...backRow, customers: [{ name: 'x', label: 'X', at: null }] }], { at: at('20:00') });
    expect(fgState(missedBack[0])).toBe('miss');
  });
  it('back at the yard: its arrival, and the TAT from departure', () => {
    const c = fgCells(lines[2]);
    expect(c[4]).toBe('Nairobi depot');
    expect(c[8]).toBe('30.10.2026 18:10:00');
    expect(c[9]).toBe('11 h 26 min');
  });
  it('a vehicle with no customers still shows; not left, its Departure is blank, never a place (operator, 12 Nov 2026)', () => {
    expect(fgCells(lines[3]).slice(1, 6)).toEqual(['KDE 268P', 'No customers given', '-', 'MORL', '']);
  });
  it('a truck with no place and no departure says why under Current location', async () => {
    const { fgLines: lines_ } = await import('./finishedGoodsReport');
    const [l] = lines_([{ plate: 'KCS 074M', place: null, trip: { leftAt: null, unread: true }, customers: [] }], { at: at('20:00') });
    expect(fgCells(l)[4]).toBe('Positions could not be read');
    expect(fgCells(l)[5]).toBe('');
  });
  it('every Departure cell is a date and time or blank', () => {
    for (const l of lines) expect(fgCells(l)[5]).toMatch(/^(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}(:\d{2})?)?$/);
  });
  it('CSV adds Delivered', () => {
    const t = fgCsv(lines);
    expect(t.head.at(-1)).toBe('Delivered');
    expect(t.body.map((r) => r.at(-1))).toEqual(['Yes', 'No', 'Yes', 'No']);
  });
  it('the PDF: landscape, every cell filled in its line\'s colour', () => {
    const doc = finishedGoodsDoc([sheetRow, backRow], { from: at('07:00'), at: at('20:00'), fleet: 'Menengai', orgCode: 'MENENGAI', now: at('20:00') });
    expect(doc.landscape).toBe(true);
    const table = doc.blocks.find((b) => b.kind === 'table');
    expect(table.head).toEqual(FG_HEADS);
    expect(table.rows[0].every((c) => c.fill === FG_FILL.ok)).toBe(true);
    expect(table.rows[1].every((c) => c.fill === FG_FILL.miss)).toBe(true);
    expect(table.rows[2].every((c) => c.fill === FG_FILL.done)).toBe(true);
    expect(Math.round(table.cols.reduce((a, c) => a + c.w, 0))).toBe(271);
  });
});

describe('the Date of a line (operator, 12 Nov 2026)', () => {
  it('a hand-listed unit is on the day it was listed, however early it set out', () => {
    const early = { ...backRow, listDay: '2026-10-31' };
    expect(fgCells(fgLines([early], { at: at('20:00') })[0]).slice(0, 2)).toEqual(['31.10.2026', 'KCT 346W']);
  });
  it('a sheet, with no list day, keeps the day it left', () => {
    expect(fgLines([sheetRow], { at: at('20:00') })[0].day).toBe('30.10.2026');
  });
});

describe('the template picked', () => {
  afterEach(() => { delete globalThis.localStorage; });
  it('is Van Sales until Finished Goods is picked, per organisation', () => {
    const m = new Map();
    globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
    expect(loadTemplate('MENENGAI')).toBe('vanSales');
    saveTemplate('MENENGAI', 'finishedGoods');
    expect(loadTemplate('menengai')).toBe('finishedGoods');
    expect(loadTemplate('SUKARI')).toBe('vanSales');
  });
  it('falls back to Van Sales with no storage', () => expect(loadTemplate('MENENGAI')).toBe('vanSales'));
});

describe('Reg No and marks', () => {
  it('the plate alone, whatever the unit is called', () => {
    expect(regOf('Menengai - KDE 268P')).toBe('KDE 268P');
    expect(regOf('FG - Menengai - KAX536U')).toBe('KAX 536U');
    expect(regOf('KCB 100Y')).toBe('KCB 100Y');
    expect(regOf('Menengai - Van 3')).toBe('Menengai - Van 3');
    expect(fgLines([{ plate: 'Menengai - KDE 268P', trip: {}, customers: [] }], { at: 0 })[0].plate).toBe('KDE 268P');
  });
  it('says which sheets were counted by their marks', () => {
    const r = { plate: 'Menengai - KAX 536U', sheet: { due: { by: 'marked', count: 5, of: 14, days: ['2026-11-11'] } } };
    expect(fgDueNotes([r, { plate: 'X', sheet: {} }])).toEqual(['KAX 536U: 5 of 14 stops marked for 11.11']);
  });
});

describe('the PDF bar and dropped lines (operator, 11 Nov 2026)', () => {
  const at = (h) => Date.parse(`2026-11-11T${h}:00+03:00`);
  const r = { key: 'K', plate: 'KCW 475E', place: 'Ugunja', trip: { leftAt: at('06:55') },
    customers: [{ name: 'a', label: 'AHERO DRIVE', at: null }, { name: 'b', label: 'KISUMU BYPASS', at: at('12:20') }] };
  it('the day bar is black', () => {
    const doc = finishedGoodsDoc([r], { from: at('07:00'), at: at('14:00'), fleet: 'M', orgCode: 'MENENGAI', now: at('14:00') });
    expect(doc.blocks[0]).toMatchObject({ kind: 'bar', dark: true, aside: '1/2 customers reached · 1 vehicle' });
  });
  it('a dropped line is left out of the PDF and its count', () => {
    const doc = finishedGoodsDoc([r], { from: at('07:00'), at: at('14:00'), fleet: 'M', orgCode: 'MENENGAI', now: at('14:00'), dropped: new Set(['K|a']) });
    const table = doc.blocks.find((b) => b.kind === 'table');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][2].text).toBe('Kisumu Bypass');
    expect(doc.blocks[0].aside).toBe('1/1 customers reached · 1 vehicle');
  });
});
