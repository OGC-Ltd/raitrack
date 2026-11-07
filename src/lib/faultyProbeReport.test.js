import { describe, it, expect } from 'vitest';
import { faultKey, faultyRows, commentCounts } from './faultyProbeReport';
import { faultyProbeDoc } from './reportDocs';

const ok = { state: 'REPORTING' };
const unit = (plate, over = {}) => ({
  vehicleId: plate, plate, name: plate, trackerSilent: false,
  fuelProbe: { state: 'OK' }, fuelSensor: { fitted: true, uncalibrated: false },
  channels: { gps: ok, ignition: ok, odometer: ok, engineHours: ok },
  ...over,
});
const quiet = (ch) => ({ channels: { gps: ok, ignition: ok, odometer: ok, engineHours: ok, [ch]: { state: 'NOT_REPORTING' } } });

describe('faulty probe report: the comment', () => {
  it("uses the sheet's words, the cause before the symptom", () => {
    expect(faultKey(unit('A'))).toBe(null);
    expect(faultKey(unit('A', { trackerSilent: true, fuelProbe: { state: 'DIED' } }))).toBe('notUpdating');
    expect(faultKey(unit('A', { fuelProbe: { state: 'UNKNOWN' } }))).toBe('notUpdating');
    expect(faultKey(unit('A', { fuelProbe: { state: 'NOT_FITTED' }, fuelSensor: { fitted: true, uncalibrated: true } }))).toBe('probeIssue');
    expect(faultKey(unit('A', { fuelProbe: { state: 'DIED' } }))).toBe('probeFailure');
    expect(faultKey(unit('A', { fuelProbe: { state: 'SILENT' } }))).toBe('probeFailure');
    expect(faultKey(unit('A', quiet('gps')))).toBe('gpsMileage');
    expect(faultKey(unit('A', quiet('odometer')))).toBe('gpsMileage');
    expect(faultKey(unit('A', quiet('ignition')))).toBe('ignition');
    expect(faultKey(unit('A', { fuelProbe: { state: 'NOT_FITTED' }, fuelSensor: { fitted: false } }))).toBe('noFls');
  });

  it('lists only the faulty, by comment then registration, and counts them', () => {
    const rows = [
      unit('KCY 522U', { fuelProbe: { state: 'DIED' } }),
      unit('KCS 640G', { trackerSilent: true }),
      unit('KBT 059B', { fuelProbe: { state: 'NOT_FITTED' }, fuelSensor: { fitted: false } }),
      unit('KCY 517U', { fuelProbe: { state: 'SILENT' } }),
      unit('KDE 586S'),
    ];
    const f = faultyRows(rows);
    expect(f.map((x) => [x.plate, x.comment])).toEqual([
      ['KCS 640G', 'NOT UPDATING'], ['KCY 517U', 'PROBE FAILURE'], ['KCY 522U', 'PROBE FAILURE'], ['KBT 059B', 'NO FLS'],
    ]);
    expect(commentCounts(f).map((c) => [c.label, c.count])).toEqual([['Not updating', 1], ['Probe failure', 2], ['No FLS', 1]]);
  });
});

describe('faulty probe report: the document', () => {
  const now = Date.UTC(2026, 10, 7, 6, 0);
  it('is the sheet: Registration No and Comment, under the overview', () => {
    const f = faultyRows([unit('KCS 640G', { trackerSilent: true }), unit('KCY 522U', { fuelProbe: { state: 'DIED' } })]);
    const d = faultyProbeDoc(f, { checked: 9, fleet: 'West Kenya Sugar', trucks: true, orgCode: 'WESTSUGAR', now });
    expect(d.title).toBe('TRUCKS FAULTY PROBE REPORT');
    expect(d.filename).toBe('Trucks Faulty Probe Report West Kenya Sugar 2026-11-07');
    expect(d.reportNo).toBe('FP-WESTSUGA-20261107-0900');
    const table = d.blocks.find((b) => b.kind === 'table');
    expect(table.head).toEqual(['Registration No', 'Comment']);
    expect(table.rows.map((r) => r.map((c) => c.text))).toEqual([['KCS 640G', 'NOT UPDATING'], ['KCY 522U', 'PROBE FAILURE']]);
    const figures = d.blocks.filter((b) => b.kind === 'figures').flatMap((b) => b.items);
    expect(figures.map((x) => `${x.label} ${x.value}`)).toEqual(['Trucks checked 9', 'Faulty 2', 'Not updating 1', 'Probe failure 1']);
  });

  it('says so when nothing is faulty', () => {
    const d = faultyProbeDoc([], { checked: 4, fleet: 'Sukari', orgCode: 'SUKARI', now });
    expect(d.title).toBe('FAULTY PROBE REPORT');
    expect(d.blocks.find((b) => b.kind === 'none').text).toBe('No faulty probes on the units in the report.');
  });
});
