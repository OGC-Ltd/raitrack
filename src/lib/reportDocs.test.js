import { describe, it, expect } from 'vitest';
import { dormantDoc, geofenceDoc, roomForHeads, tatDoc, speedDoc } from './reportDocs';
import { offlineReport } from './offlineReport';
import { removeBar } from './shiftDoc';

const at = (s) => Date.parse(`${s}+03:00`);
const NOW = at('2026-11-04T09:00:00');
const kinds = (d) => d.blocks.map((b) => b.kind);
const tables = (d) => d.blocks.filter((b) => b.kind === 'table');

describe('reports as documents', () => {
  const rep = offlineReport([
    { vehicleId: 'a', grouping: 'WSL 01', lastAt: at('2026-11-03T10:00:00'), location: 'Kakamega' },
    { vehicleId: 'b', grouping: 'WSL 02', lastAt: at('2026-10-20T10:00:00'), location: null },
    { vehicleId: 'c', grouping: 'WSL 03', lastAt: null },
  ], NOW);

  it('Dormant Assets keeps its three bars, and says who never reported', () => {
    const d = dormantDoc(rep, { fleet: 'West Kenya', now: NOW, orgCode: 'WK' });
    expect(d.title).toBe('DORMANT ASSETS REPORT');
    expect(d.filename).toBe('Dormant Assets Report West Kenya 2026-11-04');
    expect(d.blocks.filter((b) => b.kind === 'bar').map((b) => b.title)).toEqual(['OFFLINE YESTERDAY', 'OFFLINE FOR 48 HRS', 'OFFLINE FOR OVER 48 HRS']);
    expect(tables(d).map((t) => t.rows[0][0].text)).toEqual(['WSL 01', 'WSL 02']);
    expect(d.blocks.some((b) => b.kind === 'note' && b.text.startsWith('1 vehicle has never reported'))).toBe(true);
  });

  it('a bar leaves with what stands under it, and no more', () => {
    const d = dormantDoc(rep, { fleet: 'West Kenya', now: NOW, orgCode: 'WK' });
    const first = d.blocks.findIndex((b) => b.kind === 'bar');
    const out = removeBar(d, first);
    expect(out.blocks.filter((b) => b.kind === 'bar').map((b) => b.title)).toEqual(['OFFLINE FOR 48 HRS', 'OFFLINE FOR OVER 48 HRS']);
    expect(tables(out)).toHaveLength(1);
    expect(d.blocks.filter((b) => b.kind === 'bar')).toHaveLength(3);
  });

  it('Geofences says the period and each visit', () => {
    const rows = [{ vehicle: 'WSL 01', vehicleId: 'a', place: 'Kabras', in: at('2026-11-03T08:00:00'), out: at('2026-11-03T09:30:00'), open: false }];
    const d = geofenceDoc(rows, { from: at('2026-11-03T00:00:00'), to: at('2026-11-04T00:00:00'), fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    expect(d.filename).toBe('Geofence Report West Kenya 2026-11-03');
    expect(tables(d)[0].rows[0].map((c) => c.text)).toEqual(['WSL 01', 'Kabras', '2026-11-03 08:00:00', '2026-11-03 09:30:00', '1:30:00']);
  });

  const tatRow = {
    vehicleId: 'a', plate: 'WSL 01', group: 'CANE', dispatchedAt: at('2026-11-03T06:00:00'), leftAt: at('2026-11-03T06:10:00'), returnedAt: at('2026-11-03T18:10:00'),
    station: 'Kabras', fuel: { initial: 100, topUps: 0, total: 100, consumption: 20, theft: 0, final: 80 }, km: 60, rate: 3, tankL: 300, comment: 'PROBE OK', base: 'Kabras',
  };
  it('TAT and Fuel is made on its side, with all fourteen columns', () => {
    const d = tatDoc([tatRow], { day: '2026-11-03', fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    expect(d.landscape).toBe(true);
    const [t] = tables(d);
    expect(t.head).toHaveLength(14);
    expect(t.cols).toHaveLength(14);
    expect(t.rows[0]).toHaveLength(14);
    expect(t.cols.reduce((n, c) => n + c.w, 0)).toBeLessThanOrEqual(271.5);
    expect(d.blocks.find((b) => b.kind === 'h2' && b.title.endsWith('CANE'))).toBeTruthy();
  });

  it('TAT and Fuel over several days says so, and names its file for them', () => {
    const d = tatDoc([tatRow], { day: '2026-11-01', to: '2026-11-03', fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    expect(d.filename).toBe('TAT and Fuel Report West Kenya 2026-11-01 to 2026-11-03');
    expect(d.blocks[0].aside).toBe('1 to 3 November 2026');
    expect(d.footer).toContain('1 to 3 November 2026');
  });

  it('Speed keeps the link to where the peak happened', () => {
    const row = { vehicleId: 'a', name: 'WSL 01', group: 'CANE', km: 90, maxKmh: 102.4, limitKmh: 80, overByKmh: 22.4, overKm: 3.2, occurrences: 4, peak: { lat: 0.5, lng: 34.5 } };
    const d = speedDoc([row], { day: '2026-11-03', fleet: 'West Kenya', orgCode: 'WK', now: NOW });
    const [t] = tables(d);
    expect(t.rows[0][3]).toMatchObject({ text: '102 km/h', link: 'https://www.google.com/maps?q=0.5,34.5' });
    expect(t.cols[0].w).toBe(0);
    expect(kinds(d)[0]).toBe('h2');
  });
});

describe('room for the headings', () => {
  const head = ['Reg No', 'Location', 'Distance covered KM (4hrs)'];
  it('widens a column for its heading, out of the one that wraps', () => {
    const out = roomForHeads([{ w: 20 }, { w: 54, wrap: true }, { w: 34 }], head);
    expect(out[2].w).toBeGreaterThan(34);
    expect(out[1].w).toBeLessThan(54);
    expect(out[0].w + out[1].w + out[2].w).toBeCloseTo(108, 1);
  });
  it('leaves columns that fit alone, and has nothing to take where nothing wraps', () => {
    expect(roomForHeads([{ w: 20 }, { w: 60 }], ['A', 'B'])).toEqual([{ w: 20 }, { w: 60 }]);
    expect(roomForHeads([{ w: 20 }, { w: 34 }], ['A', head[2]])).toEqual([{ w: 20 }, { w: 34 }]);
  });
});
