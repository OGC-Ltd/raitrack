import { describe, it, expect } from 'vitest';
import { sheetsForWindow, sheetDays, sheetRow, trackersFor, outcomeWords, sheetWords } from './plannerReport';
import { stopWords, rowCells, deliveriesPdfBody, csvTable, notLeftWords, SHEET_STOP_HEADS, sheetStopCells } from './deliveriesReport';
import { kmWords } from './plannerActual';
import { dayStart, fleetDay } from './fleetReports';

const at = (d, s) => Date.parse(`2026-11-${d}T${s}:00+03:00`);

describe('which sheets a report takes', () => {
  // Printed 9 Nov 09:36, driven 10 Nov: the sheet's own span is 48 h from printing
  const printed9 = { id: 'a', planDate: '2026-11-09', sheetAt: new Date(at('09', '09:36')).toISOString() };
  const printed6 = { id: 'b', planDate: '2026-11-06', sheetAt: new Date(at('06', '10:00')).toISOString() };
  const noStamp = { id: 'c', planDate: '2026-11-10', sheetAt: null };
  const now = at('12', '12:00');

  it('asks the Planner for the day before too', () => {
    expect(sheetDays(at('10', '07:00'), at('10', '20:00'), fleetDay)).toEqual({ from: '2026-11-09', to: '2026-11-10' });
  });
  it('a sheet printed the day before is in, one printed four days before is out', () => {
    const got = sheetsForWindow([printed9, printed6, noStamp], at('10', '07:00'), at('10', '20:00'), dayStart, now);
    expect(got.map((p) => p.id)).toEqual(['a', 'c']);
  });
  it('a sheet printed after the window is out', () => {
    expect(sheetsForWindow([noStamp], at('09', '07:00'), at('09', '20:00'), dayStart, now)).toEqual([]);
  });
});

describe('a sheet as a Deliveries row', () => {
  const plan = {
    id: 'p1', plate: 'KDE 128E', vehicleId: 'v1', planDate: '2026-11-09', driverName: 'JOHN DOE',
    stops: [
      { id: 's1', sequence: 1, outcome: 'FULL', remarks: null, customer: { code: '100001', name: 'SAMPLE SHOP' } },
      { id: 's2', sequence: 2, outcome: 'REJECTED', remarks: 'closed', customer: { code: '100002', name: 'OTHER SHOP' } },
      { id: 's3', sequence: 3, outcome: null, remarks: null, customer: { code: '100003', name: 'FAR SHOP' } },
    ],
  };
  const actual = {
    telemetry: true, origin: { key: 'morl', label: 'MORL', short: 'MORL' },
    leftAt: at('10', '08:00'), backAt: at('10', '15:30'), km: 163.2, durationMs: 7.5 * 3_600_000, visited: 2, missed: 1,
    stops: [
      { id: 's1', at: at('10', '08:50'), leftAt: at('10', '09:08'), stayMs: 18 * 60_000, kmFromPrev: 12.4, visit: 1 },
      { id: 's2', at: at('10', '10:42'), leftAt: null, stayMs: null, kmFromPrev: 30, visit: 2 },
      { id: 's3', at: null, reachedAt: null, nearestM: 1200 },
    ],
  };
  const r = sheetRow(plan, actual, { place: 'Nakuru' });

  it('counts and times come from planActual', () => {
    expect(r.fulfilled).toBe(2);
    expect(r.planned).toBe(3);
    expect(r.trip.leftAt).toBe(actual.leftAt);
    expect(r.trip.arrivedTo.label).toBe('MORL');
    expect(rowCells(r)).toEqual(['KDE 128E', '10.11.2026 08:00:00 (MORL)', '2/3', 'MORL', '10.11.2026 15:30:00 (MORL)']);
  });
  it('each stop says what the truck did, how long, and the office mark', () => {
    expect(r.customers.map((c) => c.label)).toEqual(['100001 SAMPLE SHOP', '100002 OTHER SHOP', '100003 FAR SHOP']);
    expect(stopWords(r.customers[0])).toBe('Delivered 08:50, 18 min there, Full');
    expect(stopWords(r.customers[1])).toBe('Delivered 10:42, Rejected');
    expect(stopWords(r.customers[2])).toBe('Not reached, closest 1.2 km');
  });
  it('the PDF body and CSV carry the same words', () => {
    const body = deliveriesPdfBody([r], { from: at('10', '07:00'), at: at('10', '20:00'), fleet: 'Menengai' });
    expect(body.rows[0].customers[0].note).toBe('Delivered 08:50, 18 min there, Full');
    expect(body.rows[0].fulfilled).toBe(2);
    const csv = csvTable([r]);
    expect(csv.body[0].at(-1)).toBe('100003 FAR SHOP (Not reached, closest 1.2 km)');
  });
  it('the PDF gets the sheet’s columns per stop, and the driver on the run line', () => {
    const withCols = sheetRow({ ...plan, stops: plan.stops.map((s, i) => ({ ...s, invoiceNo: `INV${i + 1}`, amount: 12500.5, tonnage: 1.25,
      customer: { ...s.customer, location: 'NAKURU' } })) }, actual);
    const body = deliveriesPdfBody([withCols], { from: at('10', '07:00'), at: at('10', '20:00'), fleet: 'Menengai' });
    expect(SHEET_STOP_HEADS).toHaveLength(12);
    expect(body.rows[0].customers[0].sheet).toEqual(['1', '100001', 'SAMPLE SHOP', 'NAKURU', 'INV1', '12,500.5', '1.25', 'Delivered 08:50', '18 min', '12.4', 'Full', '']);
    expect(body.rows[0].customers[2].sheet.slice(7)).toEqual(['Not reached, closest 1.2 km', '', '', '', '']);
    expect(body.rows[0].customers[1].sheet.at(-1)).toBe('closed');
    expect(body.rows[0].run).toBe('2/3 delivered · left MORL 08:00 · back MORL 15:30 · 1 not delivered');
    expect(body.rows[0].runSub).toBe('Sheet of 09.11.2026, driver JOHN DOE');
    // A hand-listed vehicle's stops stay two columns
    expect(sheetStopCells({ label: 'x', at: null }).length).toBe(12);
    expect(deliveriesPdfBody([{ ...r, sheet: undefined, customers: [{ name: 'A', label: 'A', at: null }] }], { from: 0, at: 1, fleet: 'M' }).rows[0].customers[0].sheet).toBeUndefined();
  });
  it('the sheet line and the office marks', () => {
    expect(sheetWords(r, kmWords)).toBe('Sheet of 09.11.2026, driver JOHN DOE, 163.2 km in 7 h 30 min');
    expect(outcomeWords(r)).toBe('1 Full, 1 Rejected, 1 not marked');
  });
  it('with no telemetry it says so instead of a departure', () => {
    const none = sheetRow(plan, { telemetry: false, stops: [], visited: 0 });
    expect(notLeftWords(none.trip)).toBe('No telemetry for this sheet');
    expect(none.fulfilled).toBe(0);
    expect(sheetRow(plan, null, { why: 'No tracked unit carries this plate' }).trip.why).toBe('No tracked unit carries this plate');
  });
  it('counts only the stops marked for the report\'s day (operator, 11 Nov 2026)', () => {
    const [s1, s2] = plan.stops;
    const marks = { [s1.id]: '2026-11-11' };
    const day1 = sheetRow(plan, actual, { marks, days: ['2026-11-11'] });
    expect(day1.planned).toBe(1);
    expect(day1.customers.map((c) => c.name)).toEqual([s1.id]);
    expect(day1.fulfilled).toBe(day1.customers.filter((c) => c.at != null).length);
    expect(sheetWords(day1, (k) => `${k} km`)).toMatch(/1 of \d+ stops marked for 11\.11$/);
    const day2 = sheetRow(plan, actual, { marks, days: ['2026-11-12'] });
    expect(day2.planned).toBe(plan.stops.length - 1);
    expect(day2.customers.some((c) => c.name === s1.id)).toBe(false);
    expect(day2.customers.some((c) => c.name === s2.id)).toBe(true);
    // No marks: the whole sheet, as before
    expect(sheetRow(plan, actual, { marks: null, days: ['2026-11-11'] }).planned).toBe(plan.stops.length);
  });
  it('not left and parked in MORL now reads "At MORL" (operator, 11 Nov 2026)', () => {
    const MORL = { key: 'morl', label: 'MORL', short: 'MORL' };
    const notLeft = { telemetry: true, origin: MORL, leftAt: null, backAt: null, stops: [], visited: 0 };
    const parked = sheetRow(plan, notLeft, { place: 'KAPTEMBWA, Nakuru West, Kenya', atStorage: MORL });
    expect(notLeftWords(parked.trip)).toBe('At MORL');
    expect(rowCells(parked)[1]).toBe('At MORL');
    expect(parked.place).toBe('MORL');
    // Out of MORL but never seen leaving it: as before
    expect(notLeftWords(sheetRow(plan, notLeft, { place: 'Nakuru' }).trip)).toBe('Not seen leaving MORL');
  });
});

describe('the truck’s trackers', () => {
  it('its own unit and any other with its plate', () => {
    const vs = [{ vehicleId: 'v1', regPlate: 'KDE 128E' }, { vehicleId: 'v2', regPlate: 'KDE 128E' }, { vehicleId: 'v3', regPlate: 'KDE 127E' }];
    expect(trackersFor({ plate: 'KDE 128E', vehicleId: 'v1' }, vs).map((v) => v.vehicleId)).toEqual(['v1', 'v2']);
  });
});

describe('every sheet from the Planner, for now (operator, 11 Nov 2026)', async () => {
  const { sheetDaysFor, sheetsForReport, ALL_SHEETS_DAYS } = await import('./plannerReport');
  const day = (d, hm = '00:00') => Date.parse(`2026-11-${d}T${hm}:00+03:00`);
  const from = day('11', '07:00');
  const to = day('11', '20:00');
  it('asks the Planner for the last week', () => {
    expect(ALL_SHEETS_DAYS).toBe(7);
    expect(sheetDaysFor(from, to, fleetDay)).toEqual({ from: '2026-11-05', to: '2026-11-11' });
    expect(sheetDaysFor(from, to, fleetDay, false)).toEqual({ from: '2026-11-10', to: '2026-11-11' });
  });
  it('keeps a 9 Nov sheet whose 48 hours ended before the window', () => {
    const plans = [
      { id: 'kbb', planDate: '2026-11-09', sheetAt: '2026-11-09T04:00:00+03:00' },
      { id: 'kax', planDate: '2026-11-11', sheetAt: '2026-11-11T06:00:00+03:00' },
      { id: 'later', planDate: '2026-11-11', sheetAt: '2026-11-11T21:00:00+03:00' },
    ];
    expect(sheetsForReport(plans, from, to, dayStart, to).map((p) => p.id)).toEqual(['kbb', 'kax']);
    expect(sheetsForReport(plans, from, to, dayStart, to, false).map((p) => p.id)).toEqual(['kax']);
  });
});
