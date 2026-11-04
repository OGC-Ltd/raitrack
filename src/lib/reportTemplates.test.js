import { describe, it, expect } from 'vitest';
import { familyMembers, familyOf, familyRuns, templateFor } from './reportTemplates';

const REPORTS = ['geofences', 'offline', 'speedReport'];
const family = familyOf('geofences', 'WESTSUGAR');
const canSee = () => true;

describe('TAT and Fuel lists the sites too', () => {
  const tat = familyOf('tatFuel', 'WESTSUGAR');
  it('after the organisations', () => {
    expect(familyMembers(tat, canSee).map((m) => m.label)).toEqual(['Sukari', 'Kabras', 'Nzoia', 'Olepito', 'Naitiri', 'Amuka', 'Khalaba', 'Lake Agro', 'Magut', 'Misikhu', 'Nairobi', 'Selia']);
  });
  it('a site is read from West Sugar, its units alone', () => {
    const [run, ...rest] = familyRuns(tat, ['SELIA'], canSee);
    expect(rest).toEqual([]);
    expect(run.code).toBe('WESTSUGAR');
    expect(run.unit.test('Selia')).toBe(true);
    expect(run.unit.test('Misikhu')).toBe(false);
  });
  it('all of them still reads West Sugar whole', () => {
    expect(familyRuns(tat, null, canSee)[0]).toEqual({ code: 'WESTSUGAR', unit: null });
  });
});

describe('who picks what', () => {
  it('lists the five under West Kenya, in every report', () => {
    for (const r of REPORTS) {
      expect(familyMembers(familyOf(r, 'WESTSUGAR'), canSee).map((m) => m.label)).toEqual(['Sukari', 'Kabras', 'Nzoia', 'Olepito', 'Naitiri']);
    }
  });
  it('lists nothing from Sukari, Kabras or Nzoia, each of which has the report', () => {
    for (const r of REPORTS) {
      for (const org of ['SUKARI', 'KABRAS', 'NZOIA']) {
        expect(familyOf(r, org)).toBeNull();
        expect(templateFor(r, org)).not.toBeNull();
      }
    }
  });
  it('leaves out an organisation this user cannot see, but not a site', () => {
    expect(familyMembers(family, (c) => c !== 'SUKARI').map((m) => m.key)).toEqual(['KABRAS', 'NZOIA', 'OLEPITO', 'NAITIRI']);
  });
});

describe('what is read', () => {
  it('reads every organisation whole for West Kenya', () => {
    expect(familyRuns(family, null, canSee)).toEqual([
      { code: 'WESTSUGAR', unit: null }, { code: 'SUKARI', unit: null }, { code: 'KABRAS', unit: null }, { code: 'NZOIA', unit: null },
    ]);
  });
  it('reads an organisation alone, without West Kenya Sugar', () => {
    expect(familyRuns(family, ['KABRAS'], canSee)).toEqual([{ code: 'KABRAS', unit: null }]);
  });
  it('reads a site from West Kenya Sugar, by the name of the unit', () => {
    const [run, ...rest] = familyRuns(family, ['NAITIRI'], canSee);
    expect(rest).toEqual([]);
    expect(run.code).toBe('WESTSUGAR');
    for (const n of ['WKS - Naitiri - KCR 210Y', 'WKS - Naititi - X', 'WKS - NaitiriC - Y', 'Naitiri']) expect(run.unit.test(n)).toBe(true);
    for (const n of ['WKS - Olepito - X', 'WKS - Magut - KDL 489D']) expect(run.unit.test(n)).toBe(false);
  });
  it('knows Olepito misspelt', () => {
    const [run] = familyRuns(family, ['OLEPITO'], canSee);
    for (const n of ['WKS - Olepito - X', 'WKS - Oleptio - Y', 'Oleipito']) expect(run.unit.test(n)).toBe(true);
    expect(run.unit.test('WKS - Naitiri - X')).toBe(false);
  });
  it('reads both sites and an organisation together', () => {
    const runs = familyRuns(family, ['NZOIA', 'OLEPITO', 'NAITIRI'], canSee);
    expect(runs.map((r) => r.code)).toEqual(['WESTSUGAR', 'NZOIA']);
    expect(runs[0].unit.test('WKS - Olepito - X') && runs[0].unit.test('WKS - Naitiri - X')).toBe(true);
    expect(runs[0].unit.test('WKS - Magut - X')).toBe(false);
  });
});
