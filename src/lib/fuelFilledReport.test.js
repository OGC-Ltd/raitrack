import { describe, it, expect } from 'vitest';
import { dayWords, groupsOf, plateHas, refuelsOf, rowCells, setAsideOf, summary, unitsOf, ymdOf } from './fuelFilledReport';
import { fuelFilledDoc } from './reportDocs';

const T0 = Date.parse('2026-10-13T21:00:00Z'); // 14 Oct 00:00 EAT
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const ex17 = { id: 'v1', name: 'MUFINDI - EX-17', registrationPlate: 'EX-17' };
const kaz = { id: 'v2', name: 'AQUAMIST: KAZ 581G', registrationPlate: 'KAZ 581G' };
const kck = { id: 'v3', name: 'AQUAMIST: KCK 851Z', registrationPlate: 'KCK 851Z' };
const fill = (o) => ({
  vehicleId: o.vehicle.id, filledAt: at(0), verdict: 'REFILL', filledMl: 0, observedRiseMl: null,
  initialFuelLevelMl: null, finalFuelLevelMl: null, location: null, ...o,
});

const ledger = [
  // EX-17's shape (23 Nov 2026): one pump issue, two rows, each measuring the whole rise
  fill({ vehicle: ex17, filledAt: at(811), filledMl: 231_500, observedRiseMl: 576_300, initialFuelLevelMl: 401_500, finalFuelLevelMl: 633_000 }),
  fill({ vehicle: ex17, filledAt: at(805), filledMl: 579_600, observedRiseMl: 577_700, initialFuelLevelMl: 53_300, finalFuelLevelMl: 633_000, location: 'Pump' }),
  fill({ vehicle: kaz, filledAt: at(600), filledMl: 45_500, initialFuelLevelMl: 10_000, finalFuelLevelMl: 55_500 }),
  // The level came back with no filling: never fuel in
  fill({ vehicle: kaz, filledAt: at(900), verdict: 'REDISTRIBUTION', filledMl: 20_000 }),
  fill({ vehicle: kaz, filledAt: at(1200), verdict: 'PENDING', filledMl: 12_000, observedRiseMl: 11_800 }),
  // KCK 851Z, 14 Oct 2026 07:15:43Z: two tanks, a row each and one for the total, at the same second
  fill({ vehicle: kck, filledAt: at(615.7), filledMl: 71_850, observedRiseMl: 71_968, initialFuelLevelMl: 23_930, finalFuelLevelMl: 95_790 }),
  fill({ vehicle: kck, filledAt: at(615.7), filledMl: 96_540, observedRiseMl: 71_968, initialFuelLevelMl: 94_920, finalFuelLevelMl: 191_470 }),
  fill({ vehicle: kck, filledAt: at(615.7), filledMl: 24_480, observedRiseMl: 71_968, initialFuelLevelMl: 71_510, finalFuelLevelMl: 95_990 }),
];

describe('refuels', () => {
  const rows = refuelsOf(ledger);
  it('joins a split ramp’s overlapping rows: 579.6 L once, not 811 L', () => {
    const ex = rows.filter((r) => r.vehicleId === 'v1');
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ filledL: 579.6, beforeL: 53.3, afterL: 633, rows: 2, fills: 1, location: 'Pump', pending: false, plate: 'EX-17' });
  });
  it('takes a two-tank unit’s total row, not the sum of its sensors: 96.5 L as the sheet has it', () => {
    expect(rows.filter((r) => r.vehicleId === 'v3')).toEqual([expect.objectContaining({ filledL: 96.5, beforeL: 94.9, afterL: 191.5, rows: 3, fills: 1 })]);
  });
  it('reads Wialon’s figure, not the verifier’s rise, which is 0 on some Aquamist refills', () => {
    const [r] = refuelsOf([fill({ vehicle: kaz, filledMl: 58_220, observedRiseMl: 0, initialFuelLevelMl: 31_060, finalFuelLevelMl: 89_280 })]);
    expect(r.filledL).toBe(58.2);
  });
  it('adds fills one after another at the same stop', () => {
    const [r, ...rest] = refuelsOf([
      fill({ vehicle: kaz, filledAt: at(0), filledMl: 40_000, initialFuelLevelMl: 10_000, finalFuelLevelMl: 50_000 }),
      fill({ vehicle: kaz, filledAt: at(20), filledMl: 30_000, initialFuelLevelMl: 50_000, finalFuelLevelMl: 80_000 }),
    ]);
    expect(rest).toEqual([]);
    expect(r).toMatchObject({ filledL: 70, beforeL: 10, afterL: 80, rows: 2, fills: 2 });
  });
  it('one row per refuel in time order; set-aside rows left out and counted', () => {
    expect(rows.map((r) => [r.plate, r.filledL, r.pending])).toEqual([['KAZ 581G', 45.5, false], ['KCK 851Z', 96.5, false], ['EX-17', 579.6, false], ['KAZ 581G', 12, true]]);
    expect(setAsideOf(ledger)).toBe(1);
    expect(summary(rows)).toEqual({ units: 3, refuels: 4, litres: 733.6, joined: 3, pending: 1 });
  });
  it('keeps fills more than an hour apart as two refuels', () => {
    const two = refuelsOf([fill({ vehicle: kaz, filledAt: at(0), filledMl: 40_000 }), fill({ vehicle: kaz, filledAt: at(61), filledMl: 30_000 })]);
    expect(two.map((r) => r.filledL)).toEqual([40, 30]);
  });
  it('lays out a row as the sheet has it: date, reg no, probe litres', () => {
    expect(rowCells(rows[0])).toEqual(['14/10/2026', '10:00', 'KAZ 581G', '45.5', '10.0', '55.5', '-']);
    expect(rowCells(rows[3])[3]).toBe('12.0 *');
    expect(unitsOf(rows).map((u) => u.label)).toEqual(['EX-17', 'KAZ 581G', 'KCK 851Z']);
  });
});

describe('the document', () => {
  it('carries every refuel and the total', () => {
    const doc = fuelFilledDoc(refuelsOf(ledger), { from: '2026-10-14', to: '2026-10-14', fleet: 'Aquamist', orgCode: 'AQUAMIST', now: T0 });
    expect(doc.title).toBe('FUEL FILLED REPORT');
    expect(doc.filename).toBe('Fuel Filled Report Aquamist 2026-10-14');
    expect(doc.blocks.find((b) => b.kind === 'table').rows).toHaveLength(4);
    expect(doc.meta.find((m) => m.label === 'Filled').value).toBe('733.6 L');
  });
});

describe('the page: days and the plate search', () => {
  it('puts a refuel on its Nairobi day, headed in words', () => {
    // 22:30 UTC on 13 Oct is 01:30 on the 14th in Nairobi
    expect(ymdOf(Date.UTC(2026, 9, 13, 22, 30))).toBe('2026-10-14');
    expect(dayWords('2026-10-14')).toBe('Wed 14 Oct 2026');
    expect(dayWords(null)).toBe('No date');
  });

  it('groups rows by day in the order they come', () => {
    const g = groupsOf([{ d: 'b', n: 1 }, { d: 'a', n: 2 }, { d: 'b', n: 3 }], (r) => r.d);
    expect(g.map((x) => [x.key, x.rows.map((r) => r.n)])).toEqual([['b', [1, 3]], ['a', [2]]]);
  });

  it('finds a plate however it is typed', () => {
    expect(plateHas('KBY 767G', 'kby767')).toBe(true);
    expect(plateHas('KBY 767G', ' 767 g')).toBe(true);
    expect(plateHas('KBY 767G', 'KBZ')).toBe(false);
  });
});
