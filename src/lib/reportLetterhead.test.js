import { describe, it, expect } from 'vitest';
import { reportHtml, reportNumber } from './reportLetterhead';
import { REPORTS } from './reportTables';
import { sections } from './fleetReports';

const at = (s) => Date.parse(`${s}+03:00`);
const unit = (plate, group) => ({ key: plate, plate, type: 'Hino', group, vehicles: [{}] });
const opts = { companyName: 'Menengai <Oil>', orgCode: 'MENENGAI', groupWords: 'All groups', periodWords: 'p', nightWords: null,
  logos: { rai: 'r.png', ogc: 'o.png' }, now: at('2026-11-01T13:20:00') };

describe('report on the letterhead', () => {
  it('numbers the report by kind, organisation and time', () => {
    expect(reportNumber('HA', 'MENENGAI', at('2026-11-01T13:20:00'))).toBe('HA-MENENGAI-20261101-1320');
  });

  it('puts the Driver Behaviour Report on the letterhead', () => {
    const rows = [{ unit: unit('KCS 082M', 'Van Sales'), accel: 3, brake: 1, seatbelt: 2, phone: 0, total: 6, dashcam: true, suspect: true, driver: 'Osero' },
                  { unit: unit('KDE 140E', 'Van Sales'), accel: 1, brake: 0, seatbelt: 0, phone: 0, total: 1, dashcam: false, suspect: false, driver: null }];
    const done = { rows, secs: sections(rows, ['Van Sales'], (r) => r.total), ctx: { from: at('2026-11-01T00:00:00'), to: at('2026-11-01T13:20:00'), dashcams: true },
                   missing: [{ plate: 'KDE 1', group: 'Van Sales' }], units: 2, failed: 0 };
    const out = reportHtml(REPORTS.behaviour, done, opts);
    expect(out.landscape).toBe(false);
    expect(out.filename).toBe('Driver Behaviour Report Menengai <Oil> 2026-11-01.pdf');
    expect(out.html).toContain('DRIVER BEHAVIOUR REPORT');
    expect(out.html).toContain('DB-MENENGAI-20261101-1320');
    expect(out.html).toContain('2. Van Sales');
    expect(out.html).toContain('Check sensor');
    expect(out.html).toContain('has no dashcam');
    expect(out.html).toContain('Not tracked on the platform');
    expect(out.html).toContain('Menengai &lt;Oil&gt;');
    expect(out.html).not.toContain('Menengai <Oil>');
  });

  it('keeps a short period on a portrait page', () => {
    const rows = [{ unit: unit('KCS 082M', null), km: 12.34, movingMin: 30, engineOnMin: 40, idleMin: 5, readings: 9, trackers: 1 }];
    const done = { rows, secs: sections(rows, null, (r) => r.km), ctx: { from: at('2026-10-31T00:00:00'), to: at('2026-11-01T00:00:00') }, missing: [], units: 1, failed: 0 };
    const out = reportHtml(REPORTS.utilisation, done, opts);
    expect(out.landscape).toBe(false);
    expect(out.html).toContain('2. All vehicles');
    expect(out.html).toContain('12.3');
  });
});

describe('consumption in the utilisation report', () => {
  const row = (over) => ({ unit: unit('KCV 051A', null), km: 389.2, movingMin: 600, usedL: 202.1, fuelSeen: true, fuelSensor: true, readings: 900, trackers: 1, ...over });
  const cellsFor = (r, rate) => REPORTS.utilisation.cells(r, { rate });
  it('is fuel against distance, in the unit picked', () => {
    expect(cellsFor(row(), 'kmpl')[5]).toBe('1.93');
    expect(cellsFor(row(), 'l100')[5]).toBe('51.9');
    expect(cellsFor(row(), 'lpkm')[5]).toBe('0.52');
    expect(REPORTS.utilisation.columns({ rate: 'kmpl' })[5]).toBe('Consumption, km/L');
  });
  it('says Check sensor when the tank hardly moved over real distance', () => {
    const c = cellsFor(row({ usedL: 0, km: 388.8 }), 'kmpl');
    expect(c[4]).toBe('Check sensor');
    expect(c[5]).toBe('-');
    expect(cellsFor(row({ usedL: 0.9, km: 1.7 }), 'kmpl')[5]).toBe('-'); // too short to mean anything
  });
});
