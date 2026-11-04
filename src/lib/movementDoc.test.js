import { describe, it, expect } from 'vitest';
import { movementDoc, locationFill, FILL } from './movementDoc';
import { findDepots } from './movementDepots';

const D = 0.00016; const LAT = -1.3; const LNG = 36.85;
const zones = { features: [{ type: 'Feature', properties: { name: 'MENENGAI_FG: NAIROBI DEPOT' },
  geometry: { type: 'Polygon', coordinates: [[[LNG - D, LAT - D], [LNG + D, LAT - D], [LNG + D, LAT + D], [LNG - D, LAT + D], [LNG - D, LAT - D]]] } }] };
const depots = findDepots('MENENGAI', zones).found;
const now = Date.parse('2026-11-04T12:00:00+03:00');
const row = (i, state, lat, lng, speedKmh, location) => ({ vehicleId: `v${i}`, plate: `P${i}`, grouping: `CPO - Menengai - P${i}`, lastAt: now - 600_000, lat, lng, location, speedKmh, state, kmToMorl: null, closerKm: null, stale: false });
const req = (groups, from = now - 3600_000, to = now) => ({ hours: 1, from, to, morl: 'MORL', site: 'MORL', edits: { changed: 0, removed: 0 }, groups });

describe('Movements PDF laid out on the page', () => {
  it('fills the Location cell as the screen does, blue for Van Sales at the Nairobi depot', () => {
    expect(locationFill(row(1, 'from', -4.046, 39.652, 0), 'Tankers', depots)).toBe(FILL.loading);
    expect(locationFill(row(2, 'at', -0.33, 36.07, 0), 'Tankers', depots)).toBe(FILL.morl);
    expect(locationFill(row(3, 'stopped', LAT, LNG, 0), 'Van Sales', depots)).toBe('#9cc7f5');
    expect(locationFill(row(4, 'moving', LAT, LNG, 20), 'Tankers', depots)).toBe(FILL.moving);
    expect(locationFill(row(5, 'stopped', 0, 35, 0), 'Van Sales', depots)).toBeUndefined();
  });

  it('builds the sheet the server draws: details, overview, a section per group', () => {
    const doc = movementDoc([req([
      { name: 'Tankers', rows: [row(1, 'to', -0.9, 36.4, 62, 'Naivasha')] },
      { name: 'Van Sales', rows: [row(2, 'stopped', LAT, LNG, 0, 'Industrial Area, Nairobi')] },
    ])], { organisation: 'Menengai Oil Refineries Ltd', orgCode: 'MENENGAI', depots });
    expect(doc.title).toBe('MOVEMENT REPORT');
    expect(doc.reportNo).toBe('MV-MENENGAI-20261104-1200');
    expect(doc.blocks.map((b) => b.kind)).toEqual(['h2', 'figures', 'h2', 'table', 'h2', 'table', 'note']);
    expect(doc.blocks[4].title).toBe('3. Van Sales');
    expect(doc.blocks[5].rows[0][2]).toMatchObject({ text: 'Industrial Area, Nairobi', fill: '#9cc7f5' });
    expect(doc.blocks[3].rows[0][4]).toMatchObject({ text: 'To MORL', bold: true, fill: '#e3f1dc' });
    expect(doc.filename).toBe('Movement Report Menengai Oil Refineries Ltd 20261104-1200 1 hour');
  });

  it('puts several days in one PDF, a bar over each', () => {
    const day = 86_400_000;
    const doc = movementDoc([req([{ name: 'Tankers', rows: [row(1, 'to', -0.9, 36.4, 62, 'X')] }], now - day - 3600_000, now - day),
      req([{ name: 'Tankers', rows: [row(1, 'to', -0.9, 36.4, 62, 'X')] }])], { organisation: 'M', orgCode: 'MENENGAI' });
    expect(doc.blocks.filter((b) => b.kind === 'bar')).toHaveLength(2);
    expect(doc.filename).toBe('Movement Report M 20261103 to 20261104 1100-1200');
  });
});
