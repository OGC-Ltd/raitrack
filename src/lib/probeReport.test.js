import { describe, it, expect } from 'vitest';
import { byUnit, mapUrl, mergeRows, runCells, RUN_HEADS, summary, stamp, UNIT_HEADS, unitCells } from './probeReport';
import { probeDoc } from './reportDocs';
import { docCsv } from './docCsv';
import { textMm } from './shiftDoc';

const at = (s) => Date.parse(`${s}+03:00`);
const run = (vehicleId, name, from, to, alerts, over = {}) => ({ vehicleId, name, plate: name, at: at(from), to: at(to), alerts, speedKmh: 5, place: 'Malava', lat: 0.37, lng: 34.83, ...over });
const A1 = run('a', 'WKS - Nzoia Sugar - KDJ 813Z', '2026-10-30T06:09:00', '2026-10-30T09:08:00', 113);
const A2 = run('a', 'WKS - Nzoia Sugar - KDJ 813Z', '2026-10-30T12:21:00', '2026-10-30T13:45:00', 52);
const B = run('b', 'WKS - Kabras - KDJ 820Z', '2026-10-27T18:53:24', '2026-10-27T18:53:24', 1, { speedKmh: null, place: null });

describe('the rows', () => {
  it('writes a time in Nairobi', () => {
    expect(stamp(at('2026-10-30T06:09:12'))).toBe('30/10/2026 06:09:12');
  });
  it('writes a disconnection, with its map, and coordinates where Wialon names no place', () => {
    expect(runCells(A1)).toEqual(['WKS - Nzoia Sugar - KDJ 813Z', '30/10/2026 06:09:00', '30/10/2026 09:08:00', '113', '5 km/h', 'Malava']);
    expect(runCells(B).slice(4)).toEqual(['-', '0.37, 34.83']);
    expect(mapUrl(A1)).toBe('https://www.google.com/maps?q=0.37,34.83');
    expect(mapUrl({ lat: null, lng: null })).toBe('');
  });
  it('totals each unit, most disconnections first', () => {
    const units = byUnit([B, A1, A2]);
    expect(units.map((u) => [u.name, u.runs, u.alerts])).toEqual([['WKS - Nzoia Sugar - KDJ 813Z', 2, 165], ['WKS - Kabras - KDJ 820Z', 1, 1]]);
    expect(unitCells(units[0]).slice(3)).toEqual(['30/10/2026 06:09:00', '30/10/2026 13:45:00']);
  });
  it('counts units, disconnections and alerts', () => {
    expect(summary([A1, A2, B])).toEqual({ units: 2, runs: 3, alerts: 166 });
  });
  it('merges organisations by unit, then time', () => {
    expect(mergeRows([[A2, A1], [B]])).toEqual([B, A2, A1].sort((x, y) => x.name.localeCompare(y.name) || x.at - y.at));
  });
});

describe('the document', () => {
  const opts = { from: '2026-10-27', to: '2026-10-30', fleet: 'West Kenya', orgCode: 'WESTSUGAR', now: at('2026-11-05T09:00:00') };
  const d = probeDoc([A1, A2, B], opts);
  const tables = d.blocks.filter((b) => b.kind === 'table');
  it('has the overview, each unit, then each disconnection', () => {
    expect(d.title).toBe('PROBE DISCONNECTION REPORT');
    expect(d.blocks.filter((b) => b.kind === 'h2').map((b) => b.title)).toEqual(['1. Overview', '2. By unit', '3. Each disconnection']);
    expect(tables.map((t) => t.head)).toEqual([UNIT_HEADS, RUN_HEADS]);
    expect(d.blocks.find((b) => b.kind === 'figures').items.map((i) => i.value)).toEqual(['2', '3', '166']);
  });
  it('links Location to the map', () => {
    expect(tables[1].rows[0][5].link).toMatch(/^https:\/\/www\.google\.com\/maps/);
  });
  it('never cuts a heading or a time', () => {
    for (const t of tables) {
      t.cols.forEach((c, i) => { if (c.w) expect(textMm(t.head[i], 7.2, true) + 3.8, t.head[i]).toBeLessThanOrEqual(c.w); });
      t.rows.forEach((row) => row.forEach((cell, i) => {
        if (t.cols[i].w && !t.cols[i].wrap) expect(textMm(cell.text, 7.8, false) + 3.8, cell.text).toBeLessThanOrEqual(t.cols[i].w);
      }));
      expect(t.cols.reduce((n, c) => n + c.w, 0)).toBeLessThan(184);
    }
  });
  it('makes a CSV of both tables', () => {
    const csv = docCsv(d);
    expect(JSON.stringify(csv)).toContain('Disconnections');
    expect(JSON.stringify(csv)).toContain('30/10/2026 06:09:00');
  });
  it('names one day alone', () => {
    const one = probeDoc([A1], { ...opts, from: '2026-10-30', to: '2026-10-30' });
    expect(one.filename).toBe('Probe Disconnection Report West Kenya 2026-10-30');
    expect(probeDoc([A1], opts).filename).toBe('Probe Disconnection Report West Kenya 2026-10-27 to 2026-10-30');
  });
});
