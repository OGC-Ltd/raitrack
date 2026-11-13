import { describe, it, expect } from 'vitest';
import { targetForType, withTypeTargets } from './fuelTargets';

const row = (plate, kmPerL, target = null) => ({ vehicleId: plate, plate, kmPerL, target, belowTarget: null });

describe('a target from the fleet Excel TYPE (operator, 13 Nov 2026)', () => {
  it('names the rate sheet model', () => {
    expect(targetForType('HINO')).toMatchObject({ kmPerL: 5.5, words: '5.5-6.5', model: 'HINO 500' });
    expect(targetForType('Hyundai')).toMatchObject({ kmPerL: 7, words: '7-7.5' });
    expect(targetForType('FH')).toMatchObject({ kmPerL: 5.8, model: 'MITSUBISHI FH' });
    expect(targetForType('MANCLA')).toMatchObject({ kmPerL: 3, model: 'MAN CLA' });
    expect(targetForType('PICK UP')).toMatchObject({ kmPerL: 8 });
    expect(targetForType('TANKER')).toBeNull();
    expect(targetForType('FG')).toBeNull();
  });
  it('fills the units the server had none for, from the built-in list, and judges them', () => {
    const [vs, own, tanker] = withTypeTargets([row('KDE 134E', 11.85), row('KDE 142E', 4.8, { kmPerL: 6.183, words: '6.18', source: 'vehicle' }), row('KCK 456G', 2)]);
    expect(vs.target).toMatchObject({ kmPerL: 7, source: 'type' });          // KDE 134E: HYUNDAI on the VS sheet
    expect(vs.belowTarget).toBe(false);
    expect(own.target.source).toBe('vehicle');                                // set by registration: kept
    expect(tanker.target).toBeNull();                                         // TANKER names no make
  });
  it('from an uploaded list when there is one', () => {
    const [r] = withTypeTargets([row('KAA 001A', 3)], { 'KAA 001A': { driver: '', status: '', type: 'FUSO', list: 'X' } });
    expect(r.target).toMatchObject({ kmPerL: 6 });
    expect(r.belowTarget).toBe(true);
  });
});

describe('by category (operator, 13 Nov 2026)', async () => {
  const { rowsInGroup, groupCounts, totalsOf, fuelGroupsFor } = await import('./fuelTargets');
  const rows = [
    { plate: 'KCK 456G', distanceKm: 100, consumedL: 50, kmPerL: 2 },     // a tanker
    { plate: 'KDE 134E', distanceKm: 300, consumedL: 30, kmPerL: 10 },    // Van Sales
    { plate: 'KAA 001A', distanceKm: 0, consumedL: null, kmPerL: null },
  ];
  it("Menengai's categories, its fleet groups", () => {
    expect(fuelGroupsFor('MENENGAI').map((g) => g.name)).toEqual(expect.arrayContaining(['Tankers', 'Finished Goods', 'Van Sales']));
    expect(fuelGroupsFor('SUKARI')).toBeNull();
  });
  it('one category, its count, and its totals', () => {
    expect(rowsInGroup(rows, 'MENENGAI', 'Tankers').map((r) => r.plate)).toEqual(['KCK 456G']);
    expect(rowsInGroup(rows, 'MENENGAI', null)).toHaveLength(3);
    expect(groupCounts(rows, 'MENENGAI')).toMatchObject({ Tankers: 1, 'Van Sales': 1 });
    expect(totalsOf(rows)).toEqual({ units: 3, measured: 2, distanceKm: 400, consumedL: 80, kmPerL: 5 });
  });
});
