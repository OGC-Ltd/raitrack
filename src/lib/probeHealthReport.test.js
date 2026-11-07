import { describe, it, expect } from 'vitest';
import { HEADS, rowCells, summary } from './probeHealthReport';
import { probeHealthDoc } from './reportDocs';

const unit = (plate, over = {}) => ({
  vehicleId: plate, plate, deviceId: `wialon:${plate.length}`, trackerSilent: false,
  fuelProbe: { state: 'OK', lastAliveAt: '2026-10-31T10:49:00Z', lastValueMl: 11600 },
  fuelSensor: { fitted: true, uncalibrated: false },
  ...over,
});

describe('probe & sensor health report', () => {
  it('has the old export columns without Action', () => {
    expect(HEADS).toEqual(['Plate', 'Unit', 'Fuel probe', 'Probe last worked', 'Last reading (L)', 'Fuel sensor']);
    expect(HEADS).not.toContain('Action');
    expect(rowCells(unit('KCA 918P'))).toEqual(['KCA 918P', 'wialon:8', 'Reading', '2026-10-31 13:49', '11.6', 'Calibrated']);
    expect(rowCells(unit('KBY 679F', { fuelProbe: { state: 'NOT_FITTED' }, fuelSensor: { fitted: true, uncalibrated: true } })))
      .toEqual(['KBY 679F', 'wialon:8', 'No level reported', '', '', 'Uncalibrated']);
    expect(rowCells(unit('X', { fuelSensor: { fitted: false } }))[5]).toBe('Not configured');
  });

  it('counts the rows in the report', () => {
    const rows = [unit('A', { trackerSilent: true }), unit('B', { fuelProbe: { state: 'DIED' } }), unit('C', { fuelProbe: { state: 'SILENT' } }),
      unit('D', { fuelSensor: { fitted: true, uncalibrated: true } })];
    expect(summary(rows).map((x) => `${x.label} ${x.value}`)).toEqual(
      ['Units in report 4', 'Tracker silent 1', 'Stopped reading 1', 'Reads empty 1', 'Uncalibrated 1', 'Working 1']);
  });

  it('is on the template, and says so when nothing matched', () => {
    const now = Date.UTC(2026, 10, 7, 5, 22);
    const d = probeHealthDoc([unit('KCA 918P')], { note: 'All · not working · 1 units', fleet: 'Menengai', orgCode: 'MENENGAI', now });
    expect(d.title).toBe('PROBE & SENSOR HEALTH');
    expect(d.filename).toBe('Probe & Sensor Health Menengai 2026-11-07');
    const table = d.blocks.find((b) => b.kind === 'table');
    expect(table.head).toEqual(HEADS);
    expect(JSON.stringify(d)).not.toMatch(/Action|calibration table|check the device/);
    expect(probeHealthDoc([], { fleet: 'M', trucks: true, now }).title).toBe('TRUCKS PROBE & SENSOR HEALTH');
    expect(probeHealthDoc([], { fleet: 'M', now }).blocks.find((b) => b.kind === 'none').text).toBe('Nothing matched the current filters.');
  });
});
