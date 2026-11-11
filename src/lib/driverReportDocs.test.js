import { describe, expect, it } from 'vitest';
import { drawable, driverDoc, driversDoc, nameCase } from './driverReportDocs';
import { NOTE_LINES } from './letterhead';

const NOW = Date.UTC(2026, 10, 10, 9, 0); // 10 Nov 2026 12:00 EAT

const roster = [
  { id: 'a', fullName: 'JOSEPH OTIENO', employeeId: '114', vehicle: 'KDA 101A', status: 'ACTIVE', rating: 4.6,
    trips: 12, tonnes: 300.5, mileageKm: 1800, fuelTheftCases: 1, overspeedingCases: 3, harshAccelerationCases: 0, harshBrakingCases: 2 },
  { id: 'b', fullName: 'mary McOmbaka', vehicle: null, status: 'SUSPENDED', rating: 0,
    trips: 0, tonnes: 0, mileageKm: 0, fuelTheftCases: 0, overspeedingCases: 0, harshAccelerationCases: 0, harshBrakingCases: 0 },
];
const details = { a: { byDay: [{ day: '2026-09-01', tonnes: 100, mileageKm: 600 }, { day: '2026-11-08', tonnes: 200.5, mileageKm: 1200 }] } };

/** What the server's reportDocSchema (fleet-server report.schema) caps. */
function fitsSchema(doc) {
  expect(doc.title.length).toBeLessThanOrEqual(120);
  expect(doc.meta.length).toBeLessThanOrEqual(8);
  expect(doc.blocks.length).toBeLessThanOrEqual(300);
  for (const b of doc.blocks) {
    if (b.kind === 'figures') expect(b.items.length).toBeLessThanOrEqual(12);
    if (b.kind === 'table') {
      expect(b.head.length).toBe(b.cols.length);
      for (const r of b.rows) expect(r.length).toBe(b.cols.length);
    }
  }
}

describe('drawable', () => {
  it('swaps the characters Helvetica cannot draw', () => {
    expect(drawable('Field 7 → Mill')).toBe('Field 7 to Mill');
    expect(drawable('−3.5')).toBe('-3.5');
    expect(drawable('12/09/2026 – 01/10/2026 · ok')).toBe('12/09/2026 – 01/10/2026 · ok');
  });

  it('leaves no such character in the roster document', () => {
    const d = driversDoc(roster, { details, fleet: "A → B", orgCode: "X", now: NOW });
    const text = JSON.stringify([d.blocks, d.meta, d.footer]);
    expect(text).not.toMatch(/[→−]/);
  });
});

describe('nameCase', () => {
  it('repairs case but keeps a mixed-case word as typed', () => {
    expect(nameCase('JOSEPH OTIENO')).toBe('Joseph Otieno');
    expect(nameCase('mary McOmbaka')).toBe('Mary McOmbaka');
  });

  it('capitalises after an apostrophe, straight or curly', () => {
    expect(nameCase("PETER O'BRIEN")).toBe("Peter O'Brien");
    expect(nameCase('PETER O’BRIEN')).toBe('Peter O’Brien');
  });
});

/** The Notes section: a numbered heading, then the ruled rows to write on, last in the document. */
const expectNotesLast = (doc, n) => {
  const [h2, lines] = doc.blocks.slice(-2);
  expect(h2).toEqual({ kind: 'h2', title: `${n}. Notes` });
  expect(lines.kind).toBe('table');
  expect(lines.rows).toHaveLength(NOTE_LINES);
  expect(lines.rows.every((r) => r.length === 1 && !r[0].text.trim())).toBe(true);
};

describe('driversDoc', () => {
  const doc = driversDoc(roster, { details, fleet: 'Sukari', orgCode: 'SUKARI', now: NOW, weighbridge: true });

  it('is a landscape letterhead document over the 90-day window', () => {
    fitsSchema(doc);
    expect(doc.title).toBe('DRIVERS REPORT');
    expect(doc.landscape).toBe(true);
    expect(doc.reportNo).toMatch(/^DR-SUKARI-20261110-/);
    expect(doc.meta.find((m) => m.label === 'Period').value).toBe('13/08/2026 – 10/11/2026');
  });

  it('lists every driver, then a total row', () => {
    const table = doc.blocks.find((b) => b.kind === 'table');
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0].map((c) => c.text)).toEqual([
      '1', 'Joseph Otieno #114', 'KDA 101A', 'Active', '01/09/2026 – 08/11/2026', '4.6', '12', '300.5', '1,800', '1', '3', '0', '2',
    ]);
    expect(table.rows[1][5].text).toBe('New');
    expect(table.rows[1][4].text).toBe('-');
    expect(table.rows[2][1].text).toBe('Total');
  });

  it('puts only drivers with cases in Conduct, and says when tonnes include the weighbridge', () => {
    const conduct = doc.blocks.filter((b) => b.kind === 'table')[1];
    expect(conduct.rows).toHaveLength(1);
    expect(conduct.rows[0].at(-1).text).toBe('6');
    expect(doc.blocks.some((b) => b.kind === 'note' && /weighbridge/.test(b.text))).toBe(true);
  });

  it('names the vehicle type when the grid is filtered', () => {
    const typed = driversDoc(roster, { fleet: 'Sukari', orgCode: 'SUKARI', typeName: 'Trucks', now: NOW });
    expect(typed.meta.find((m) => m.label === 'Vehicles').value).toBe('Trucks');
    expect(typed.filename).toBe('Drivers Report Sukari Trucks 2026-11-10');
  });

  it('ends with ruled Notes, after the footnotes', () => {
    expectNotesLast(doc, 4);
  });
});

describe('driverDoc', () => {
  const detail = {
    driver: { id: 'a', fullName: 'JOSEPH OTIENO', employeeId: '114', rating: 4.6 },
    totals: { trips: 12, tonnes: 300.5, mileageKm: 1800, hoursOnRoad: 40.25, overspeedingCases: 1, harshAccelerationCases: 0, harshBrakingCases: 1 },
    heaviestLoad: { tonnes: 31.2, date: '2026-11-08', route: 'Field 7 → Mill' },
    byDay: details.a.byDay,
    incidents: {
      thefts: [
        { id: 't1', at: '2026-11-07T10:15:00Z', plate: 'KDA 101A', litres: 22.4, fromL: 180, toL: 158, where: 'Awendo', cause: 'SIPHON', review: 'confirmed' },
        { id: 't2', at: '2026-11-06T10:15:00Z', plate: 'KDA 101A', litres: 3, cause: 'SLOSH' },
      ],
      overspeeds: [{ id: 'o1', at: '2026-11-05T05:02:30Z', plate: 'KDA 101A', peakKmh: 94, limitKmh: 80, route: 'Migori road', attributedBy: 'posted' }],
      harsh: [{ id: 'h1', at: '2026-11-04T12:00:00Z', plate: 'KDA 101A', kind: 'braking' }],
    },
  };
  const doc = driverDoc(detail, { fleet: 'Sukari', orgCode: 'SUKARI', vehicle: 'KDA 101A', now: NOW });

  it('is a portrait statement with the driver in the heading', () => {
    fitsSchema(doc);
    expect(doc.landscape).toBe(false);
    expect(doc.reportNo).toMatch(/^DS-SUKARI-/);
    expect(doc.meta.map((m) => m.label)).toEqual(['Driver', 'Employee no.', 'Vehicle', 'Fleet', 'Period']);
    expect(doc.filename).toBe('Driver Report Joseph Otieno 2026-11-10');
  });

  it('lists each flagged case with its local time', () => {
    const tables = doc.blocks.filter((b) => b.kind === 'table');
    const theft = tables[1];
    expect(theft.rows).toHaveLength(1); // the slosh is not a theft case
    expect(theft.rows[0].map((c) => c.text)).toEqual(['07/11/2026 13:15', 'KDA 101A', '22.4', '180 to 158', 'Awendo', 'Confirmed theft']);
    expect(tables[2].rows[0].map((c) => c.text)).toEqual(['05/11/2026 08:02', 'KDA 101A', '94', '80', 'Migori road']);
    expect(tables[3].rows[0][2].text).toBe('Hard braking');
    expect(doc.blocks.some((b) => b.kind === 'note' && /before anyone was posted/.test(b.text))).toBe(true);
  });

  it('says so when there are no cases', () => {
    const quiet = driverDoc({ ...detail, incidents: {}, byDay: [] }, { fleet: 'Sukari', orgCode: 'SUKARI', now: NOW });
    expect(quiet.blocks.filter((b) => b.kind === 'none')).toHaveLength(3);
    expect(quiet.blocks.some((b) => b.title === '6. Daily Activity')).toBe(false);
  });

  it('ends with ruled Notes, numbered after Daily Activity when there is one', () => {
    expectNotesLast(doc, 7);
    const quiet = driverDoc({ ...detail, incidents: {}, byDay: [] }, { fleet: 'Sukari', orgCode: 'SUKARI', now: NOW });
    fitsSchema(quiet);
    expectNotesLast(quiet, 6);
  });
});
