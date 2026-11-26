import { describe, it, expect } from 'vitest';
import { buildFuelUsage } from './fuelUsageReport';
import { fuelUsageHtml, registerTable, unrecordedTable, periodWords, cumulativeSvg, kes, n0 } from './fuelUsageReportPdf';

const at = (s) => new Date(`${s}+03:00`).toISOString();
const data = {
  factory: 'MUFINDI', from: '2026-11-16', to: '2026-11-22',
  machines: [
    { reference: 'EX-01', category: 'Excavator', basis: 'HOUR', rate: 16, status: null, tankLitres: 300, vehicleId: 'v1', plate: 'EX 01' },
    { reference: 'DZ-05', category: 'Bull Dozer', basis: 'HOUR', rate: 21, status: 'BROKEN_DOWN', tankLitres: 400, vehicleId: 'v5', plate: 'DZ 05' },
  ],
  lines: [
    { lineId: 'a', machine: 'EX-01', day: '2026-11-16', shiftNo: 1, planStatus: 'APPROVED', workLocation: 'Zone 4', department: 'IRRIGATION', plannedHours: 8, needLitres: 128, fullTank: false, litresRequested: 128 },
    { lineId: 'b', machine: 'DZ-05', day: '2026-11-17', shiftNo: 1, planStatus: 'APPROVED', workLocation: 'Factory Site', department: 'FACTORY', plannedHours: 8, needLitres: 168, fullTank: true },
  ],
  issues: [{ id: 'i1', machine: 'EX-01', day: '2026-11-16', at: '2026-11-16T06:30:00', litres: 120, done: true, operator: 'J. Mwita', flags: ['Off plan'], pump: 'Zone 4', sensor: null }],
};
const fillings = [
  { id: 'p1', vehicleId: 'v1', filledAt: at('2026-11-16T06:40:00'), filledMl: 118_000, verdict: 'REFILL', vehicle: { registrationPlate: 'EX 01' } },
  { id: 'p2', vehicleId: 'v1', filledAt: at('2026-11-18T19:00:00'), filledMl: 150_000, verdict: 'REFILL', vehicle: { registrationPlate: 'EX 01' } },
];
const rep = buildFuelUsage(data, { fillings, price: 214.03 });
const html = fuelUsageHtml(rep, { companyName: 'Mufindi Paper Mills Ltd', orgCode: 'KASULU', logos: { rai: 'r', ogc: 'o' }, now: Date.parse('2026-11-24T18:00:00+03:00') });

describe('the Fuel Usage Report PDF', () => {
  it('is the letterhead, landscape, numbered FU- for the organisation', () => {
    expect(html).toContain('FUEL USAGE REPORT');
    expect(html).toContain('FU-KASULU-');
    expect(html).toContain('16 – 22 November 2026');
  });

  it('leads with fuel into tanks, the pump records and the fuel with no pump record', () => {
    expect(html).toContain('Probe records');
    expect(html).toContain('Pump records');
    expect(html).toContain('268 L');                       // 118 + 150, the probe's fills
    expect(html).toContain('Not at pump');
    expect(html).toContain('150 L');
    expect(html).toContain('Probe records not at pump');
    expect(html).toContain('<th class="r t-not">Not at pump</th>');
  });

  it('carries no cost: five figures in the band, no KES anywhere (operator 2026-11-24)', () => {
    expect(html).not.toMatch(/KES|>Cost</);
    expect(html).toContain('grid-template-columns: repeat(6, 1fr)');
  });

  it('shows a machine down on the plan, the register with its header to repeat, and the basis', () => {
    expect(html).toContain('Machines down, still on the plan');
    expect(html).toMatch(/DZ-05<\/b><span class="fu-down">down/);
    expect(html).toContain('<table class="lst fu-t fu">');
    expect(html).toContain('Basis of preparation');
  });

  it('keeps to black, white and greys, colour only for meaning', () => {
    // The report's own blocks; the letterhead's dark band and base styles are the house letterhead's
    const own = html.slice(html.indexOf('<div id="flow"'));
    expect(own.length).toBeGreaterThan(1000);
    for (const c of own.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
      expect(['#5f5f5f', '#c8c8c8', '#e8e8e8', '#a33030', '#1e6b3a', '#8a5a00', '#ececec', '#9a9a9a', '#7a7a7a', '#cfcfcf', '#ff8c8c', '#e6eef8', '#e6f2ea', '#f8e6e6', '#2b5c8a']).toContain(c.toLowerCase());
    }
    expect(html).not.toMatch(/navy|#1f3a5f|gold/i);
  });

  it('draws the cumulative chart with one axis and three lines', () => {
    const svg = cumulativeSvg(rep.cumulative);
    expect(svg.match(/<path /g)).toHaveLength(4);            // the gap, need, pump records, probe records
    expect(svg).toContain('Probe records 268');
    expect(svg).not.toContain('Used');                        // no tank days read: no Used line
  });

  it('adds a Used line from the tank days: opening + fills - drains - closing, the report machines only', () => {
    const tankDays = [
      { vehicleId: 'v1', day: '2026-11-16', openingL: 100, closingL: 150, fillL: 118, drainL: 0 },   // 68 used
      { vehicleId: 'v1', day: '2026-11-17', openingL: 150, closingL: 120, fillL: 0, drainL: 10 },    // 20 used
      { vehicleId: 'v1', day: '2026-11-18', openingL: 120, closingL: null, fillL: 150, drainL: 0 },  // no closing: left out
      { vehicleId: 'v9', day: '2026-11-16', openingL: 500, closingL: 100, fillL: 0, drainL: 0 },     // not on the report
    ];
    const r2 = buildFuelUsage(data, { fillings, tankDays });
    expect(r2.totals.used).toEqual({ litres: 88, machines: 1 });
    expect(r2.cumulative.find((d) => d.day === '2026-11-17').used).toBe(88);
    const svg = cumulativeSvg(r2.cumulative);
    expect(svg.match(/<path /g)).toHaveLength(5);            // and used
    expect(svg).toContain('Used 88');
  });
});

describe('probe records and shifts completed (operator 2026-11-26)', () => {
  const shiftRuns = [
    { lineId: 'a', day: '2026-11-16', state: 'ran', runHours: 7.2, plannedHours: 8 },       // 90% of its 8 hours: completed
    { lineId: 'b', day: '2026-11-17', state: 'ran', runHours: 7.1, plannedHours: 8 },       // just under 90%: not completed
  ];
  const r3 = buildFuelUsage(data, { fillings, shiftRuns });
  const h3 = fuelUsageHtml(r3, { companyName: 'Mufindi Paper Mills Ltd', orgCode: 'KASULU', logos: { rai: 'r', ogc: 'o' }, now: Date.parse('2026-11-24T18:00:00+03:00') });

  it('probe records are the probe fills only; a machine with no probe shows no probe', () => {
    expect(r3.totals.probe).toBe(268);
    expect(r3.register.find((x) => x.machine === 'EX-01').probe).toBe(268);
    expect(r3.register.find((x) => x.machine === 'DZ-05').probe).toBeNull();
    expect(h3).toContain('no probe');
  });

  it('a shift is completed when the tracker shows it ran 90% of its planned hours', () => {
    expect(r3.totals).toMatchObject({ shiftsCompleted: 1, shiftsJudged: 2 });
    expect(r3.register.find((x) => x.machine === 'EX-01')).toMatchObject({ completed: 1, judged: 1 });
    expect(h3).toContain('Shifts completed');
    expect(h3).toContain('of 2 the tracker could check');
  });

  it('without the tracker hours, completed reads as a dash, not zero', () => {
    expect(rep.totals.shiftsCompleted).toBeNull();
    expect(html).toContain('tracker hours not read');
  });
});

describe('words and figures', () => {
  it('periods across months and years', () => {
    expect(periodWords('2026-11-16', '2026-11-22')).toBe('16 – 22 November 2026');
    expect(periodWords('2026-10-28', '2026-11-03')).toBe('28 October – 3 November 2026');
    expect(periodWords('2026-12-29', '2027-01-04')).toBe('29 December 2026 – 4 January 2027');
    expect(periodWords('2026-11-16', '2026-11-16')).toBe('16 November 2026');
  });
  it('thousands with commas, money in millions', () => {
    expect(n0(12342.4)).toBe('12,342');
    expect(kes(7_977_442)).toBe('KES 7.98 M');
    expect(kes(845_000)).toBe('KES 845,000');
    expect(kes(null)).toBe('–');
  });
});

describe('the Excel files', () => {
  it('the register: one row a machine, every column', () => {
    const t = registerTable(rep);
    expect(t.head).toHaveLength(17);
    expect(t.body.find((r) => r[0] === 'EX-01')).toEqual(['EX-01', 'Excavator', 'Zone 4', 'IRRIGATION', 1, 1, '', 8, 128, 268, 120, 1, 150, 1, 140, '', 'Yes']);   // '' = shifts completed not read
  });
  it('no pump record: one row a fill', () => {
    const t = unrecordedTable(rep);
    expect(t.body).toHaveLength(1);
    expect(t.body[0].slice(0, 5)).toEqual(['EX-01', 'Excavator', 'Zone 4', '18 Nov 19:00', 150]);
  });
});
