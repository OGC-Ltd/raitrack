import { describe, expect, it } from 'vitest';
import {
  applyToRows, dayCandidates, findColumns, resolveDayChoices, resolveDays, fillPlan, matchRows, numberOf, outName, parseCsv, parseDay, requestsFor, sheetItems, toCsv, unitsByKey, varianceOf, CHECK, RECON_HEADS, reconCells, reconRows, reconSummary,
} from './probeRecon';
import { probeReconDoc } from './reportDocs';

// Aquamist's "Fuel Recon-Aqmst vs Probes(Sigona).csv", its head and real rows
const CSV = [
  'Date,Reg No,Qty per Aqmst Records,Filling as per Fuel Probes,Variance,Comment,,,,,,,,,Reg No,,,',
  '11/3/2025,KCJ 100X,40,39.06,0.94,,,,,,,,,,176, 6 ,,6',
  '11/3/2025,KBP 167E,17,No FLS,,,,,,,,,,,,,,',
  '12/20/2025,KBY 767G,178.02,188.6,-10.58,,,,,,,,,,,,,',
  '1/22/2026,KBY 767G,236.86,368,-131.14,,,,,,,,,,,,,',
  '1/9/2026,KBY 767G,186.63,202,-15.37,,,,,,,,,,,,,',
  '13/1/2026,KBY 767G,20,,20,,,,,,,,,,,,,',
  '"1/10/2026","KDM 148L","69.03","71",-1.97,"Fueled at Aquamist, Sigona",,,,,,,,,,,,',
].join('\r\n');

// Wialon's fills for KBY 767G (fleet-server probe-fills, each refuel once), in Nairobi time
const at = (day, t) => Date.parse(`${day}T${t}+03:00`);
const KBY767G = [
  { at: at('2025-12-20', '08:42:21'), litres: 11.58 }, { at: at('2025-12-20', '15:22:43'), litres: 190.19 },
  { at: at('2026-01-09', '09:26:14'), litres: 11.99 }, { at: at('2026-01-09', '15:35:06'), litres: 202.15 },
  { at: at('2026-01-09', '16:47:55'), litres: 10.86 }, { at: at('2026-01-09', '20:06:52'), litres: 11.44 },
  { at: at('2026-01-22', '09:28:54'), litres: 253.72 }, { at: at('2026-01-22', '17:26:39'), litres: 14.68 },
];

describe('parseDay', () => {
  it('reads the sheet as month first, unless the first part cannot be a month', () => {
    expect(parseDay('11/20/2025')).toBe('2025-11-20');
    expect(parseDay('1/6/2026')).toBe('2026-01-06');
    expect(parseDay('13/1/2026')).toBe('2026-01-13');
    expect(parseDay('2026-01-22')).toBe('2026-01-22');
    expect(parseDay('2/30/2026')).toBeNull();
    expect(parseDay('')).toBeNull();
  });
  it('reads Excel dates and serial numbers', () => {
    expect(parseDay(new Date(Date.UTC(2026, 0, 22)))).toBe('2026-01-22');
    expect(parseDay(46044)).toBe('2026-01-22');
  });
});

describe('resolveDays', () => {
  it('reads both ways only when it can', () => {
    expect(dayCandidates('9/2/2026')).toEqual(['2026-09-02', '2026-02-09']);
    expect(dayCandidates('2/2/2026')).toEqual(['2026-02-02']);
    expect(dayCandidates('30/01/2026')).toEqual(['2026-01-30']);
  });
  // Aquamist's sheet, rows 1,180–1,330: a day-first run inside a month-first sheet
  it('takes the reading inside the sheet span, else follows the proven dates nearest it', () => {
    const cells = ['30/01/2026', '31/01/2026', '2/2/2026', '6/2/2026', '4/2/2026', '9/2/2026', '10/2/2026', '1/28/2026', '1/29/2026', '2/3/2026', '2/12/2026'];
    const got = resolveDayChoices(cells);
    // The sheet runs 28 Jan to 12 Feb: 2 Jun and 2 Oct are outside it
    expect(got[3]).toEqual({ day: '2026-02-06', alt: null });
    expect(got[6]).toEqual({ day: '2026-02-10', alt: null });
    // 3 Feb and 2 Mar are both inside: the month-first dates beside it decide, the fills may yet
    expect(got[9]).toEqual({ day: '2026-02-03', alt: '2026-03-02' });
    expect(got[0]).toEqual({ day: '2026-01-30', alt: null });
  });

  // The top of Aquamist's sheet: 11/3/2025 is 3 Nov on a sheet running Nov 2025 to Nov 2026
  it('never reads a date months outside the sheet', () => {
    const got = resolveDays(['11/3/2025', '12/5/2025', '11/8/2025', '28/01/2026', '11/13/2025', '11/24/2026']);
    expect(got.slice(0, 3)).toEqual(['2025-11-03', '2025-12-05', '2025-11-08']);
  });
  it('lets the refuels settle a date the sheet does not (07/08/2026 among 7/27 and 8/11)', () => {
    const [, , seven] = resolveDayChoices(['7/27/2026', '7/28/2026', '07/08/2026', '8/11/2026']);
    expect(seven).toEqual({ day: '2026-07-08', alt: '2026-08-07' });
    const item = { row: 1, plate: 'KDE 176P', key: 'KDE176P', qty: 84.24, was: '', ...seven };
    const aug7 = Date.parse('2026-08-07T09:00:00+03:00');
    const m = matchRows([item], new Map([['KDE176P', { fills: [{ at: aug7, litres: 84.5 }] }]]), '2025-11-27');
    expect(m.get(1)).toEqual({ litres: 84.5, at: aug7, day: '2026-08-07' });
  });
  // Rows 104–135: 3/3/2026 and one 12/15/2025 dropped among the 11 November block
  it('is not pulled off course by dates that prove nothing, or one stray', () => {
    const cells = ['11/10/2025', '11/18/2025', '3/3/2026', '11/11/2025', '12/15/2025', '11/5/2025', '3/3/2026', '11/12/2025', '11/12/2025', '3/3/2026', '11/13/2025', '11/14/2025', '11/17/2025'];
    const days = resolveDays(cells);
    expect(days[7]).toBe('2025-11-12');
    expect(days[3]).toBe('2025-11-11');
    expect(days[5]).toBe('2025-11-05');
    expect(days[2]).toBe('2026-03-03');
  });

  it('is month first with nothing to go by', () => {
    expect(resolveDays(['11/3/2025', '1/9/2026'])).toEqual(['2025-11-03', '2026-01-09']);
  });
});

describe('a sheet', () => {
  const rows = parseCsv(CSV);
  const cols = findColumns(rows);

  it('finds its columns by name, the first Reg No only', () => {
    expect(cols).toMatchObject({ head: 0, date: 0, reg: 1, qty: 2, probe: 3, variance: 4, added: [] });
    expect(rows[7][5]).toBe('Fueled at Aquamist, Sigona');
  });

  it('adds the probe and variance columns after the last heading when missing', () => {
    expect(findColumns([['Date', 'Reg No', 'Qty per Aqmst Records', 'Comment', '']]))
      .toMatchObject({ probe: 4, variance: 5, added: ['Filling as per Fuel Probes', 'Variance'] });
  });

  it('asks for the whole sheet at once: every unit, its days and the other readings of two-way dates', () => {
    const items = sheetItems(rows, cols).filter((it) => !it.alt);
    expect(requestsFor(items)).toEqual([
      { plates: ['KBY 767G', 'KDM 148L'], from: '2025-12-20', to: '2026-01-22' },
    ]);
    const all = requestsFor(sheetItems(rows, cols));
    expect(all.flatMap((r) => r.plates).filter((p, i, a) => a.indexOf(p) === i)).toEqual(['KCJ 100X', 'KBP 167E', 'KBY 767G', 'KDM 148L']);
  });

  it('splits days past the server\'s 400', () => {
    const items = [{ row: 1, day: '2025-01-01', plate: 'A 1', key: 'A1', qty: 1 }, { row: 2, day: '2026-06-01', plate: 'B 2', key: 'B2', qty: 1 }];
    expect(requestsFor(items)).toEqual([
      { plates: ['A 1', 'B 2'], from: '2025-01-01', to: '2025-01-01' },
      { plates: ['A 1', 'B 2'], from: '2026-06-01', to: '2026-06-01' },
    ]);
  });

  it('reads the server\'s units by plate, any spelling', () => {
    const got = unitsByKey([{ units: [
      { plate: 'kby767g', vehicle: { id: 'v1' }, fills: [{ at: 1, litres: 2 }] },
      { plate: 'KDM 148L', vehicle: null, note: 'Not on the platform', fills: [] },
    ] }]);
    expect(got.get('KBY767G')).toEqual({ fills: [{ at: 1, litres: 2 }], note: null });
    expect(got.get('KDM148L')).toEqual({ fills: [], note: 'Not on the platform' });
  });

  it('fills each row from its own unit and day, nearest in litres, blank with no fill that day', () => {
    const items = sheetItems(rows, cols);
    const fills = new Map([
      ['KCJ100X', { fills: [] }], ['KBP167E', { fills: [], note: 'Not on the platform' }],
      ['KBY767G', { fills: KBY767G }], ['KDM148L', { fills: [], note: 'Not on the platform' }],
    ]);
    const { writes, tally } = fillPlan(items, matchRows(items, fills, '2025-11-01'));
    const byRow = Object.fromEntries(writes.map((w) => [w.row, w]));
    expect(byRow[3]).toMatchObject({ probe: 190.19, variance: -12.17 }); // 20 Dec
    expect(byRow[4]).toMatchObject({ probe: 253.72, variance: -16.86 }); // 22 Jan: not 368
    expect(byRow[5]).toMatchObject({ probe: 202.15, variance: -15.52 }); // 9 Jan, the big one of four
    expect(byRow[1]).toEqual({ row: 1, probe: '', variance: '' }); // 3 Nov 2025: no fill on Wialon that day
    expect(byRow[6]).toEqual({ row: 6, probe: '', variance: '' }); // 13 Jan: no fill
    expect(byRow[2]).toBeUndefined(); // KBP 167E is not on the platform: left as it was
    expect(tally).toMatchObject({ rows: 7, matched: 3, notOnPlatform: 2, noFill: 2, blanked: 1, changed: 2 });

    const out = parseCsv(toCsv(applyToRows(rows, cols, writes)));
    expect(out[4].slice(0, 5)).toEqual(['1/22/2026', 'KBY 767G', '236.86', '253.72', '-16.86']);
    expect(out[1].slice(0, 5)).toEqual(['11/3/2025', 'KCJ 100X', '40', '', '']);
    expect(out[2][3]).toBe('No FLS');
    expect(out[7][5]).toBe('Fueled at Aquamist, Sigona');
  });

  it('never takes a refuel from another day', () => {
    const items = [{ row: 1, day: '2026-01-08', plate: 'KBY 767G', key: 'KBY767G', qty: 200, was: '' },
      { row: 2, day: '2026-01-21', plate: 'KBY 767G', key: 'KBY767G', qty: 100, was: '' }];
    const m = matchRows(items, new Map([['KBY767G', { fills: KBY767G }]]), '2025-11-27');
    expect(m.get(1)).toEqual({ note: 'No probe fill' });
    expect(m.get(2)).toEqual({ note: 'No probe fill' });
  });

  it('leaves rows before the records unchecked, as the sheet had them', () => {
    const items = sheetItems(rows, cols);
    const fills = new Map([['KCJ100X', { fills: [] }], ['KBY767G', { fills: KBY767G }]]);
    const { writes, tally } = fillPlan(items, matchRows(items, fills, '2025-11-27'));
    expect(writes.find((w) => w.row === 1)).toBeUndefined(); // 3 Nov 2025, KCJ 100X keeps 39.06
    expect(writes.find((w) => w.row === 4)).toMatchObject({ probe: 253.72 });
    expect(tally.notChecked).toBe(1);
  });
});

describe('figures', () => {
  it('variance is records minus probe', () => { expect(varianceOf(40, 39.06)).toBe(0.94); expect(varianceOf(236.86, 253.72)).toBe(-16.86); });
  it('text is not a number', () => { expect(numberOf('No FLS')).toBeNull(); expect(numberOf(' 1,234.5 ')).toBe(1234.5); });
  it('names the filled copy', () => { expect(outName('Fuel Recon-Aqmst vs Probes(Sigona).csv', 'csv')).toBe('Fuel Recon-Aqmst vs Probes(Sigona) (probes).csv'); });
});

describe('the reconciliation report', () => {
  const rows = parseCsv(CSV);
  const cols = findColumns(rows);
  const items = sheetItems(rows, cols);
  const fills = new Map([
    ['KCJ100X', { fills: [] }], ['KBP167E', { fills: [], note: 'Not on the platform' }],
    ['KBY767G', { fills: KBY767G }], ['KDM148L', { fills: [], note: 'Not on the platform' }],
  ]);
  const report = reconRows(items, matchRows(items, fills, '2025-11-27'), rows, cols);

  it('shows every sheet row in date order, with what the filled sheet holds and why', () => {
    expect(report.map((r) => [r.day, r.plate, r.probe, r.variance, r.check])).toEqual([
      ['2025-11-03', 'KBP 167E', 'No FLS', null, CHECK.NOT_ON_PLATFORM],
      ['2025-11-03', 'KCJ 100X', 39.06, 0.94, CHECK.BEFORE],
      ['2025-12-20', 'KBY 767G', 190.19, -12.17, CHECK.FILLED],
      ['2026-01-09', 'KBY 767G', 202.15, -15.52, CHECK.FILLED],
      ['2026-01-10', 'KDM 148L', 71, -1.97, CHECK.NOT_ON_PLATFORM],
      ['2026-01-13', 'KBY 767G', null, null, CHECK.NO_FILL],
      ['2026-01-22', 'KBY 767G', 253.72, -16.86, CHECK.FILLED],
    ]);
    expect(report.find((r) => r.plate === 'KDM 148L').comment).toBe('Fueled at Aquamist, Sigona');
  });

  it('totals the rows a probe refuel was found for', () => {
    expect(reconSummary(report)).toMatchObject({
      rows: 7, units: 4, filled: 3, noFill: 1, before: 1, notOnPlatform: 2,
      recordsL: 601.51, probeL: 646.06, varianceL: -44.55, from: '2025-11-03', to: '2026-01-22',
    });
  });

  it('makes a standard report document', () => {
    const doc = probeReconDoc(report, { fleet: 'Aquamist Ltd', orgCode: 'AQUAMIST', sheet: 'Sigona.csv', now: Date.parse('2026-11-27T08:00:00Z') });
    expect(doc.title).toBe('FUEL RECONCILIATION REPORT');
    expect(doc.filename).toBe('Fuel Reconciliation Aquamist Ltd 2025-11-03 to 2026-01-22');
    const table = doc.blocks.find((b) => b.kind === 'table');
    expect(table.head).toEqual(RECON_HEADS);
    expect(table.rows[6].map((c) => c.text)).toEqual(['22/01/2026', 'KBY 767G', '236.86', '253.72', '-16.86', CHECK.FILLED, '']);
    expect(reconCells(report[5])).toEqual(['13/01/2026', 'KBY 767G', '20.00', '', '', CHECK.NO_FILL, '']);
  });
});
