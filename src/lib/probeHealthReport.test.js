import { describe, it, expect } from 'vitest';
import { HEADS, byGroup, rowCells, summary } from './probeHealthReport';
import { probeHealthDoc } from './reportDocs';

const ch = { gps: { state: 'REPORTING' }, ignition: { state: 'REPORTING' }, odometer: { state: 'REPORTING' } };
const unit = (plate, over = {}) => ({
  vehicleId: plate, plate, deviceId: `wialon:${plate.length}`, trackerSilent: false,
  fuelProbe: { state: 'OK', lastAliveAt: '2026-10-31T10:49:00Z', lastValueMl: 11600 },
  fuelSensor: { fitted: true, uncalibrated: false }, channels: ch,
  ...over,
});

describe('probe & sensor health report', () => {
  it('has one column a part, Working or Not working, and no Action', () => {
    expect(HEADS).toEqual(['Plate', 'Unit', 'GPS tracker', 'Ignition', 'Odometer', 'Fuel probe']);
    expect(rowCells(unit('KCA 918P'))).toEqual(['KCA 918P', 'wialon:8', 'Working', 'Working', 'Working', 'Working']);
    expect(rowCells(unit('A', { trackerSilent: true })).slice(2)).toEqual(['Not working', 'No data', 'No data', 'No data']);
    expect(rowCells(unit('A', { channels: { ...ch, ignition: { state: 'NOT_REPORTING' } }, fuelProbe: { state: 'DIED' } })).slice(2))
      .toEqual(['Working', 'Not working', 'Working', 'Not working']);
    expect(rowCells(unit('A', { channels: { ...ch, gps: { state: 'NOT_REPORTING' }, odometer: { state: 'NOT_FITTED' } }, fuelProbe: { state: 'SILENT' } })).slice(2))
      .toEqual(['Not working', 'Working', 'Not fitted', 'Not working']);
    expect(rowCells(unit('A', { fuelProbe: { state: 'NOT_FITTED' }, fuelSensor: { fitted: true, uncalibrated: true } }))[5]).toBe('Not set up');
    expect(rowCells(unit('A', { fuelProbe: { state: 'NOT_FITTED' }, fuelSensor: { fitted: false } }))[5]).toBe('Not fitted');
  });

  it('counts what is not working in the report', () => {
    const rows = [unit('A', { trackerSilent: true }), unit('B', { fuelProbe: { state: 'DIED' } }), unit('C', { channels: { ...ch, ignition: { state: 'NOT_REPORTING' } } }), unit('D')];
    expect(summary(rows).map((x) => `${x.label} ${x.value}`)).toEqual(
      ['Units in report 4', 'GPS tracker not working 1', 'Ignition not working 1', 'Odometer not working 0', 'Fuel probe not working 1', 'All working 1']);
  });

  it('highlights Not working, on the template', () => {
    const now = Date.UTC(2026, 10, 7, 5, 22);
    const d = probeHealthDoc([unit('KCA 918P', { fuelProbe: { state: 'DIED' } })], { note: 'All · not working · 1 units', fleet: 'Menengai', groups: null, now });
    expect(d.title).toBe('PROBE & SENSOR HEALTH');
    const table = d.blocks.find((b) => b.kind === 'table');
    expect(table.head).toEqual(HEADS);
    expect(table.rows[0][5]).toMatchObject({ text: 'Not working', bold: true, tone: 'flag' });
    expect(table.rows[0][2]).toEqual({ text: 'Working' });
    expect(JSON.stringify(d)).not.toMatch(/Action|check the device/);
    expect(probeHealthDoc([], { fleet: 'M', trucks: true, now }).title).toBe('TRUCKS PROBE & SENSOR HEALTH');
    expect(probeHealthDoc([], { fleet: 'M', now }).blocks.find((b) => b.kind === 'none').text).toBe('Nothing matched the current filters.');
  });
});

describe('probe & sensor health report: by fleet group', () => {
  const groups = [{ name: 'Tankers', units: [['KCA 918P', 'Tanker', 1]] }, { name: 'Finished Goods', units: [['KBT 119R', 'FG', 0], ['KBT 113R', 'FG', 0]] }];
  it("follows the list's order, plate order within, unlisted last", () => {
    const g = byGroup([unit('ZZZ 1'), unit('KBT 119R'), unit('KCA 918P'), unit('KBT 113R')], groups);
    expect(g.map((x) => [x.name, x.rows.map((r) => r.plate)])).toEqual([
      ['Tankers', ['KCA 918P']], ['Finished Goods', ['KBT 113R', 'KBT 119R']], ['Not on the list', ['ZZZ 1']]]);
    expect(byGroup([unit('A')], null)).toBe(null);
  });

  it('puts a bar and a table per group in the document', () => {
    const d = probeHealthDoc([unit('KBT 119R'), unit('KCA 918P')], { fleet: 'Menengai', groups, now: 0 });
    expect(d.blocks.filter((b) => b.kind === 'bar').map((b) => `${b.title} ${b.aside}`)).toEqual(['Tankers 1 unit', 'Finished Goods 1 unit']);
    expect(d.blocks.filter((b) => b.kind === 'table')).toHaveLength(2);
    expect(probeHealthDoc([unit('A')], { fleet: 'X', groups: null, now: 0 }).blocks.filter((b) => b.kind === 'table')).toHaveLength(1);
  });
});
