import { describe, it, expect } from 'vitest';
import { utilisationRows, sections, RATED_SECTIONS, burnAgainstRegister } from './fleetReports';
import { REPORTS, againstWords, overStandard, fuelSuspect } from './reportTables';
import { reportHtml } from './reportLetterhead';

const unit = (plate, ratedBurn) => ({ key: plate, plate, type: '', group: null, vehicles: [{ vehicleId: plate, ratedBurn }] });
const units = [
  unit('EX 01', { value: 18, basis: 'HOURS' }),      // excavator, 18 L/h
  unit('TR 07', { value: 2.5, basis: 'DISTANCE' }),  // truck, 2.5 km/L = 0.4 L/km
  unit('LV 02', null),                                // not on the register
];
const per = new Map([
  ['EX 01', { km: 3, engineOnMin: 600, usedL: 207, fuelSeen: true, readings: 50 }],   // 10 h, 20.7 L/h
  ['TR 07', { km: 200, engineOnMin: 300, usedL: 76, fuelSeen: true, readings: 50 }],  // 0.38 L/km
  ['LV 02', { km: 40, engineOnMin: 90, usedL: 5, fuelSeen: true, readings: 20 }],
]);

describe('Mufindi: burn against the register', () => {
  const rows = utilisationRows(units, per, { rated: true });
  const by = (p) => rows.find((r) => r.unit.plate === p);

  it('reads each unit in its own basis', () => {
    expect(by('EX 01')).toMatchObject({ basis: 'HOURS', std: 18, section: 'Machines (L/h)' });
    expect(by('EX 01').actual).toBeCloseTo(20.7);
    expect(againstWords(by('EX 01').over)).toBe('15% over');
    expect(by('TR 07')).toMatchObject({ basis: 'DISTANCE', section: 'Vehicles (L/km)' });
    expect(by('TR 07').std).toBeCloseTo(0.4);
    expect(againstWords(by('TR 07').over)).toBe('5% under');
    expect(by('LV 02')).toMatchObject({ basis: null, section: 'No standard on the register' });
  });

  it('flags only more than 15% over, and splits into the three tables', () => {
    expect(overStandard({ over: 0.15 })).toBe(false);
    expect(overStandard({ over: 0.2 })).toBe(true);
    expect(sections(rows, RATED_SECTIONS).map((s) => s.name)).toEqual(RATED_SECTIONS);
  });

  it('gives no rate below an hour or 10 km, and suspects a still tank', () => {
    expect(burnAgainstRegister({ km: 0, engineOnMin: 40, usedL: 9, fuelSeen: true }, { value: 18, basis: 'HOURS' }).actual).toBeNull();
    const still = burnAgainstRegister({ km: 0, engineOnMin: 300, usedL: 1, fuelSeen: true }, { value: 18, basis: 'HOURS' });
    expect(still.actual).toBeNull();
    expect(fuelSuspect({ basis: 'HOURS', ...still })).toBe(true);
  });

  it('shows rated columns and leaves the others alone', () => {
    const rated = REPORTS.utilisation.columns({ rated: true });
    expect(rated).toContain('Engine hours');
    expect(REPORTS.utilisation.cells(by('EX 01'), { rated: true }).slice(5)).toEqual(['18.0 L/h', '20.7 L/h', '15% over']);
    expect(REPORTS.utilisation.columns({ rate: 'kmpl' })).toContain('Consumption, km/L');
    expect(utilisationRows(units, per)[0].basis).toBeUndefined();
  });

  it('the PDF says the rates come from the register', () => {
    const ctx = { from: 0, to: 86_400_000, rated: true };
    const secs = sections(rows, RATED_SECTIONS, (r) => r.km);
    const { html } = reportHtml(REPORTS.utilisation, { rows, secs, ctx, missing: [], units: 3, failed: 0 },
      { companyName: 'Mufindi Paper Mills Ltd', orgCode: 'KASULU', groupWords: 'All vehicles', periodWords: 'p', logos: { rai: '', ogc: '' }, now: 86_400_000 });
    expect(html).toContain('As rated on the register');
    expect(html).toContain('Machines (L/h)');
    expect(html).toContain('20.7 L/h');
  });
});

describe('the closing line', () => {
  it('ends every report with who to contact', () => {
    const ctx = { from: 0, to: 86_400_000 };
    const { html } = reportHtml(REPORTS.night, { rows: [], secs: [], ctx, missing: [], units: 0, failed: 0 },
      { companyName: 'Nzoia', orgCode: 'NZOIA', groupWords: 'All vehicles', periodWords: 'p', nightWords: 'Night hours 19:00hrs – 05:00hrs', logos: { rai: '', ogc: '' }, now: 86_400_000 });
    expect(html).toContain('This is a system-generated report.');
    expect(html).toContain('operations@offgridconsultingltd.com');
  });
});
