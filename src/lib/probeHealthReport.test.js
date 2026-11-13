import { describe, it, expect } from 'vitest';
import { HEADS, byGroup, rowCells, summary, headsFor, cellsFor, fleetListEntry } from './probeHealthReport';
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
    // KCA 918P is on the tanker list: Driver and Status come after the unit (13 Nov 2026)
    expect(table.head).toEqual(['Plate', 'Unit', 'Driver', 'Status', ...HEADS.slice(2)]);
    expect(table.rows[0][7]).toMatchObject({ text: 'Not working', bold: true, tone: 'flag' });
    expect(table.rows[0][4]).toEqual({ text: 'Working' });
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

describe('driver and status from the tanker fleet list (operator, 13 Nov 2026)', () => {
  it('adds them for a tanker on the list, blank for one not on it', () => {
    expect(fleetListEntry({ plate: 'KCK456G' })).toMatchObject({ driver: 'Stephen Maina Mwangi', status: 'Operational' });
    expect(fleetListEntry({ plate: '', name: 'TANKER - Menengai - KCF 183A' })).toMatchObject({ driver: 'David Ndiritu Kanyuaigwa', status: 'Accident' });
    const rows = [unit('KCK 456G'), unit('KAA 001A')];   // KAA 001A: on no list
    expect(headsFor(rows)).toEqual(['Plate', 'Unit', 'Driver', 'Status', 'GPS tracker', 'Ignition', 'Odometer', 'Fuel probe']);
    expect(cellsFor(rows[0], true).slice(0, 4)).toEqual(['KCK 456G', 'wialon:8', 'Stephen Maina Mwangi', 'Operational']);
    expect(cellsFor(rows[1], true).slice(2, 4)).toEqual(['', '']);
  });
  it('leaves them out where no unit is on the list', () => {
    expect(headsFor([unit('KAA 001A')])).toEqual(HEADS);
  });
  it('the PDF carries them, an accident flagged', () => {
    const d = probeHealthDoc([unit('KCF 183A'), unit('KCK 456G')], { fleet: 'Menengai', groups: null, now: Date.UTC(2026, 10, 13, 9) });
    const table = d.blocks.find((b) => b.kind === 'table');
    expect(table.head.slice(2, 4)).toEqual(['Driver', 'Status']);
    expect(table.cols).toHaveLength(8);
    expect(table.rows[0][3]).toMatchObject({ text: 'Accident', tone: 'flag' });
    expect(table.rows[1][2]).toMatchObject({ text: 'Stephen Maina Mwangi' });
  });
});

describe('a tanker with no driver (GARAGE on the list)', () => {
  it('has the driver blank, the status kept', () => {
    expect(fleetListEntry({ plate: 'KCV 033A' })).toMatchObject({ driver: '', status: 'Workshop' });
  });
});

describe('the table fills the page', () => {
  it('portrait 184 mm, landscape 271 mm', () => {
    const width = (landscape) => probeHealthDoc([unit('KCK 456G')], { fleet: 'M', groups: null, now: 0, landscape })
      .blocks.find((b) => b.kind === 'table').cols.reduce((n, c) => n + c.w, 0);
    expect(Math.round(width(false))).toBe(184);
    expect(Math.round(width(true))).toBe(271);
  });
});

describe('the Van Sales list too (operator, 13 Nov 2026)', () => {
  it('a Van Sales truck has its driver and status; a status the file leaves empty is blank', () => {
    expect(fleetListEntry({ plate: 'KDE 268P' })).toEqual({ driver: 'Kipkoech Ngeno', status: 'Operational', type: 'HINO', list: 'MORL VS FLEET' });
    expect(fleetListEntry({ plate: 'KDE 120E' })).toMatchObject({ status: 'Accident' });
    expect(fleetListEntry({ plate: 'KDM 128L' })).toMatchObject({ driver: 'Kennedy Cheruiyott Langat', status: '' });
    expect(fleetListEntry({ plate: 'KDM 119L' })).toMatchObject({ driver: '', status: 'Operational' });
    expect(fleetListEntry({ plate: 'KCK 456G' })).toMatchObject({ list: 'MORL TANKER FLEET' });
    // Finished Goods from the full workbook
    expect(fleetListEntry({ plate: 'KBT 112R' })).toMatchObject({ driver: 'James Kariuki Gitau', list: 'MORL FG FLEET' });
  });
});
