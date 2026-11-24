import { describe, it, expect } from 'vitest';
import { dayShifts, shiftHoursRows, shiftTone, shiftIssueRows, withProbeRefills } from './shiftHours';

// 10:00 Nairobi, 17 Nov 2026
const NOW = Date.parse('2026-11-17T10:00:00+03:00');
const H = 3_600_000;

const line = (o = {}) => ({
  lineId: 'L1', day: '2026-11-17', machine: 'EX-16', planStatus: 'APPROVED', shiftNo: 1,
  shiftStart: '06:00:00', plannedHours: 10, department: 'IRRIGATION', activity: 'Drainage Desilting', ...o,
});
const DATA = {
  machines: [{ reference: 'EX-16', name: 'Excavator', plate: 'MUFINDI - EX 16', vehicleId: 'veh_ex16' }],
  lines: [line()],
};
const UNITS = [{ key: 'u1', plate: 'MUFINDI - EX 16', type: 'Excavator', vehicles: [{ vehicleId: 'veh_ex16', regPlate: 'MUFINDI - EX 16' }] }];

describe('shiftTone', () => {
  it('is green from 70%, amber from 50%, red below', () => {
    expect(shiftTone(0.7)).toBe('good');
    expect(shiftTone(0.95)).toBe('good');
    expect(shiftTone(0.69)).toBe('warn');
    expect(shiftTone(0.5)).toBe('warn');
    expect(shiftTone(0.49)).toBe('bad');
    expect(shiftTone(0)).toBe('bad');
    expect(shiftTone(null)).toBeNull();
  });
  it('judges the whole percent shown: 69.6% reads 70% and is green', () => {
    expect(shiftTone(0.696)).toBe('good');
    expect(shiftTone(0.494)).toBe('bad');
  });
});

describe('dayShifts', () => {
  it('makes the shift from its start and planned hours, judged up to now while it runs', () => {
    const [s] = dayShifts(DATA, NOW);
    expect(s.start).toBe(Date.parse('2026-11-17T06:00:00+03:00'));
    expect(s.end).toBe(s.start + 10 * H);
    expect(s.upTo).toBe(NOW);
    expect(s).toMatchObject({ machine: 'EX-16', vehicleId: 'veh_ex16', plannedHours: 10 });
  });

  it('judges an ended shift to its end', () => {
    const [s] = dayShifts({ ...DATA, lines: [line({ shiftStart: '06:00', plannedHours: 2 })] }, NOW);
    expect(s.upTo).toBe(s.end);
  });

  it('leaves out pending plans, and lines with no start or no hours', () => {
    const lines = [
      line({ lineId: 'a', planStatus: 'SUBMITTED' }),
      line({ lineId: 'b', shiftStart: null }),
      line({ lineId: 'c', plannedHours: 0 }),
      line({ lineId: 'd' }),
    ];
    expect(dayShifts({ ...DATA, lines }, NOW).map((s) => s.key)).toEqual(['EX-16|2026-11-17|1|d']);
  });
});

describe('shiftHoursRows', () => {
  it('a running shift with no engine time is red, on the hours elapsed so far', () => {
    const [r] = shiftHoursRows(UNITS, new Map([['veh_ex16', []]]), dayShifts(DATA, NOW));
    expect(r).toMatchObject({ state: 'running', elapsed: 4, hours: 0, share: 0, tone: 'bad' });
    expect(r.unit.plate).toBe('EX-16');
  });

  it('a shift not yet started has no share and no tone', () => {
    const later = dayShifts({ ...DATA, lines: [line({ shiftStart: '14:00:00' })] }, NOW);
    const [r] = shiftHoursRows(UNITS, new Map(), later);
    expect(r).toMatchObject({ state: 'upcoming', elapsed: 0, hours: null, share: null, tone: null });
  });

  it('a machine with no tracked unit is said so, not counted as idle', () => {
    const data = { machines: [{ reference: 'EX-99' }], lines: [line({ machine: 'EX-99' })] };
    const [r] = shiftHoursRows(UNITS, new Map(), dayShifts(data, NOW));
    expect(r).toMatchObject({ state: 'untracked', hours: null, tone: null });
  });

  it('a machine whose readings could not be read is said so, not counted as idle', () => {
    const [r] = shiftHoursRows(UNITS, new Map(), dayShifts(DATA, NOW), new Set(['veh_ex16']));
    expect(r).toMatchObject({ state: 'unread', hours: null, tone: null });
  });

  it('finds the unit by plate when the register has no vehicleId', () => {
    const data = { machines: [{ reference: 'EX-16', plate: 'Mufindi-EX16' }], lines: [line()] };
    const [r] = shiftHoursRows(UNITS, new Map([['veh_ex16', []]]), dayShifts(data, NOW));
    expect(r.state).toBe('running');
  });
});

describe('shiftHoursRows, with engine time', () => {
  const at = (s) => Date.parse(`${s}+03:00`);
  /** A reading every 10 minutes, engine on, the hour meter ticking with it (as machineryReport.test). */
  function running(from, to) {
    const out = [];
    for (let t = at(from); t <= at(to); t += 600_000) {
      out.push({ t, engineOn: true, speedKmh: 0, lat: -8.6, lng: 35.3, engineHoursMeter: 1000 + (t - at(from)) / H });
    }
    return out;
  }

  it('counts the engine hours inside the shift so far: 3 of 4 elapsed is 75%, green', () => {
    const pings = new Map([['veh_ex16', running('2026-11-17T06:30:00', '2026-11-17T09:30:00')]]);
    const [r] = shiftHoursRows(UNITS, pings, dayShifts(DATA, NOW));
    expect(r.hours).toBeCloseTo(3, 1);
    expect(r.hoursFrom).toBe('meter');
    expect(r.share).toBeCloseTo(0.75, 1);
    expect(r.tone).toBe('good');
  });

  it('does not count engine time before the shift began', () => {
    const pings = new Map([['veh_ex16', running('2026-11-17T03:00:00', '2026-11-17T07:00:00')]]);
    const [r] = shiftHoursRows(UNITS, pings, dayShifts(DATA, NOW));
    // 06:00 to 07:00, not the three hours before. The hour meter is read from the
    // last reading before the shift (as the Machinery report reads it), so up to
    // one reading's gap at the start, 10 minutes here, can count with it.
    expect(r.hours).toBeGreaterThan(0.95);
    expect(r.hours).toBeLessThan(1.2);
    expect(r.tone).toBe('bad');                 // 1 of 4 h, 25%
  });

  it('2.2 of 4 hours is amber', () => {
    const pings = new Map([['veh_ex16', running('2026-11-17T06:00:00', '2026-11-17T08:12:00')]]);
    const [r] = shiftHoursRows(UNITS, pings, dayShifts(DATA, NOW));
    expect(r.tone).toBe('warn');
  });
});

describe('the Shift hours report, as printed', async () => {
  const { REPORTS } = await import('./reportTables');
  const { reportHtml } = await import('./reportLetterhead');
  const def = REPORTS.shiftHours;
  const shifts = dayShifts({ ...DATA, lines: [line(), line({ lineId: 'L2', machine: 'EX-16', shiftNo: 2, shiftStart: '14:00:00' })] }, NOW);
  const rows = shiftHoursRows(UNITS, new Map([['veh_ex16', []]]), shifts).map((r, i) => (i === 0 ? { ...r, hours: 2.4, share: 0.6, tone: 'warn' } : r));
  const done = {
    rows, secs: [{ name: null, rows, total: 2.4 }], missing: [], units: 1, failed: 0,
    ctx: { from: Date.parse('2026-11-17T00:00:00+03:00'), to: NOW },
  };
  const { html } = reportHtml(def, done, { companyName: 'Mufindi Paper Mills Ltd', orgCode: 'KASULU', groupWords: 'Machines on approved work plans', periodWords: '17 Nov 2026', logos: { rai: 'r', ogc: 'o' }, now: NOW });

  it('prints the key: every colour and every column', () => {
    expect(html).toContain('. Key</h2>');
    for (const [, name] of def.legend.tones) expect(html).toContain(name);
    for (const [col, words] of def.legend.columns) {
      expect(html).toContain(col);
      expect(html).toContain(words);
    }
  });

  it('shades the amber row amber, and leaves a shift not started plain', () => {
    expect(html).toContain('background:rgb(254,243,199)');
    expect(html).toContain('Not started');
  });

  it('numbers the report WP- for the organisation', () => {
    expect(html).toContain('WP-KASULU-');
    expect(html).toContain('WORK PLANS UPDATES REPORT');
  });
});

describe('shiftHoursRows, fuel used in the shift', () => {
  const at = (s) => Date.parse(`${s}+03:00`);
  /** Engine on, hour meter and fuel counter ticking: 10 L an hour. */
  function burning(from, to, { fuel = true } = {}) {
    const out = [];
    for (let t = at(from); t <= at(to); t += 600_000) {
      const h = (t - at(from)) / H;
      out.push({ t, engineOn: true, speedKmh: 0, lat: -8.6, lng: 35.3, engineHoursMeter: 1000 + h, ...(fuel ? { fuelUsedMl: 500_000 + h * 10_000 } : {}) });
    }
    return out;
  }

  it('counts the litres used inside the shift so far', () => {
    const pings = new Map([['veh_ex16', burning('2026-11-17T06:30:00', '2026-11-17T09:30:00')]]);
    const [r] = shiftHoursRows(UNITS, pings, dayShifts(DATA, NOW));
    expect(r.usedL).toBeGreaterThan(25);
    expect(r.usedL).toBeLessThan(35);
  });

  it('says No sensor for a machine that reports no fuel, not 0', async () => {
    const { REPORTS } = await import('./reportTables');
    const pings = new Map([['veh_ex16', burning('2026-11-17T06:30:00', '2026-11-17T09:30:00', { fuel: false })]]);
    const [r] = shiftHoursRows(UNITS, pings, dayShifts(DATA, NOW));
    expect(r.usedL).toBeNull();
    expect(REPORTS.shiftHours.cells(r).at(-1)).toBe('No sensor');
  });
});

describe('Work Plan Fuel: expected, probe and issued per shift', () => {
  const at = (s) => Date.parse(`${s}+03:00`);
  /** Engine on 06:30 to 09:30, 10 L an hour on the fuel counter. */
  const pings = () => {
    const out = [];
    for (let t = at('2026-11-17T06:30:00'); t <= at('2026-11-17T09:30:00'); t += 600_000) {
      const h = (t - at('2026-11-17T06:30:00')) / H;
      out.push({ t, engineOn: true, speedKmh: 0, lat: -8.6, lng: 35.3, engineHoursMeter: 1000 + h, fuelUsedMl: 500_000 + h * 10_000 });
    }
    return new Map([['veh_ex16', out]]);
  };
  const rated = (o = {}, rate = 18) => ({
    machines: [{ ...DATA.machines[0], basis: 'HOUR', rate }],
    lines: [line({ requestId: 'R1', issuedLitres: 180, requestLitres: 200, operators: ['J. Mwita', 'A. Kim'], supervisor: 'P. Lema', workLocation: 'Ihefu', ...o })],
  });

  it('expects engine hours × the register’s litres per hour, and carries planned and issued', () => {
    const [r] = shiftHoursRows(UNITS, pings(), dayShifts(rated(), NOW));
    expect(r.hours).toBeCloseTo(3, 1);
    expect(r.expectedL).toBeCloseTo(54, 0);
    expect(r.usedL).toBeCloseTo(30, 0);
    expect(r.plannedL).toBe(200);
    expect(r.issuedL).toBe(180);
    expect(r.diffL).toBeCloseTo(150, 0);
    expect(r.actualLph).toBeCloseTo(10, 0);
    expect(r.ratedLph).toBe(18);
  });

  it('colours on probe used against expected: green to 110%, amber to 125%, red over', () => {
    // 30 L used: expected 54 L at 18 L/h is green; 26 L at about 8.7 L/h is amber; 21 L at 7 L/h is red
    expect(shiftHoursRows(UNITS, pings(), dayShifts(rated(), NOW))[0].fuelTone).toBe('good');
    expect(shiftHoursRows(UNITS, pings(), dayShifts(rated({}, 8.7), NOW))[0].fuelTone).toBe('warn');
    expect(shiftHoursRows(UNITS, pings(), dayShifts(rated({}, 7), NOW))[0].fuelTone).toBe('bad');
  });

  it('expects nothing where the register rates the machine by the km, or not at all', () => {
    const km = { ...rated(), machines: [{ ...DATA.machines[0], basis: 'KM_PER_LITRE', rate: 3 }] };
    const [r] = shiftHoursRows(UNITS, pings(), dayShifts(km, NOW));
    expect(r.expectedL).toBeNull();
    expect(r.fuelTone).toBeNull();
    expect(shiftHoursRows(UNITS, pings(), dayShifts(DATA, NOW))[0].expectedL).toBeNull();
  });

  it('issued is blank while the line has no fuel request, 0 when the request got nothing', () => {
    expect(shiftHoursRows(UNITS, pings(), dayShifts(rated({ requestId: null, issuedLitres: 0 }), NOW))[0].issuedL).toBeNull();
    expect(shiftHoursRows(UNITS, pings(), dayShifts(rated({ issuedLitres: 0 }), NOW))[0].issuedL).toBe(0);
  });

  it('reads as a table: work and where, who, shift, hours and the fuel figures', async () => {
    const { REPORTS } = await import('./reportTables');
    const def = REPORTS.shiftFuel;
    const [r] = shiftHoursRows(UNITS, pings(), dayShifts(rated(), NOW));
    const cells = def.cells(r, { oneDay: true });
    expect(cells.slice(0, 6)).toEqual(['EX-16', 'Drainage Desilting · Ihefu', 'J. Mwita, A. Kim', 'P. Lema', '06:00 – 16:00', '10.0']);
    expect(cells[8]).toBe('200.0');
    expect(cells[9]).toBe('180.0');
    expect(cells[12]).toBe('+150.0');
    expect(cells[13]).toBe('10.0 / 18.0');
    expect(def.legend.columns.map(([c]) => c)).toEqual(def.columns());
    // Over several days the shift carries its day
    expect(def.cells(r, { oneDay: false })[4]).toBe('Tue 17 Nov 06:00 – 16:00');
  });
});

describe('Work Plan Fuel: each pump issue', () => {
  const at = (s) => Date.parse(`${s}+03:00`);
  /** The tank level every 2 minutes: 100 L, filled to 280 L between 05:40 and 05:50, then steady. */
  const levels = () => {
    const out = [];
    for (let t = at('2026-11-17T05:00:00'); t <= at('2026-11-17T06:40:00'); t += 120_000) {
      const l = t < at('2026-11-17T05:40:00') ? 100 : t < at('2026-11-17T05:50:00') ? 100 + ((t - at('2026-11-17T05:40:00')) / 600_000) * 180 : 280;
      out.push({ t, engineOn: false, speedKmh: 0, lat: -8.6, lng: 35.3, fuelLevelMl: l * 1000 });
    }
    return new Map([['veh_ex16', out]]);
  };
  const data = {
    machines: [{ ...DATA.machines[0], basis: 'HOUR', rate: 18 }],
    lines: [line({ requestId: 'R1', issuedLitres: 180 })],
    issues: [
      { id: 'I1', machine: 'EX-16', day: '2026-11-17', requestId: 'R1', startedAt: '2026-11-17T05:40:00', at: '2026-11-17T05:50:00', litres: 180, done: true, siv: 'SIV-000027', pump: 'Main pump', flags: ['Operator mismatch'], sensor: { check: 'MATCH', riseL: 176 } },
      { id: 'I2', machine: 'EX-16', day: '2026-11-17', requestId: null, startedAt: '2026-11-17T12:00:00', at: '2026-11-17T12:05:00', litres: 40, done: true, siv: null, pump: null, flags: [], sensor: null },
      { id: 'I3', machine: 'EX-99', day: '2026-11-17', requestId: null, startedAt: '2026-11-17T08:00:00', litres: 50, flags: [] },
    ],
  };

  it('ties each issue to its shift, reads our probe’s rise over it, and leaves out other machines', () => {
    const rows = shiftHoursRows(UNITS, levels(), dayShifts(data, NOW));
    const issues = shiftIssueRows(data, rows, levels());
    expect(issues.map((i) => i.key)).toEqual(['I1', 'I2']);
    expect(issues[0].shift.key).toBe(rows[0].key);
    expect(issues[0].probeRiseL).toBeGreaterThan(160);
    expect(issues[0].probeRiseL).toBeLessThan(190);
    expect(issues[1].shift).toBeNull();
    const [r] = withProbeRefills(rows, issues);
    expect(r.probeRefillL).toBeCloseTo(issues[0].probeRiseL, 5);
  });

  it('lists the issues under the report: voucher, pump, FactorySuite’s check and the flags', async () => {
    const { REPORTS } = await import('./reportTables');
    const rows = shiftHoursRows(UNITS, levels(), dayShifts(data, NOW));
    const issues = shiftIssueRows(data, rows, levels());
    const t = REPORTS.shiftFuel.extra({ rows, ctx: { issues, oneDay: true } });
    expect(t.head).toHaveLength(t.widths.length);
    expect(t.rows[0].slice(0, 5)).toEqual(['EX-16', '05:40', 'SIV-000027', 'Main pump', '180.0']);
    expect(t.rows[0].slice(6)).toEqual(['Match, +176.0 L', 'Operator mismatch', '06:00 – 16:00']);
    expect(t.rows[1].at(-1)).toBe('Not on a plan line');
    expect(REPORTS.shiftFuel.extra({ rows, ctx: { issues: [] } })).toBeNull();
  });

  it('prints with the Work Plan Fuel title, a WF- number, department sections and the issues', async () => {
    const { REPORTS } = await import('./reportTables');
    const { reportHtml } = await import('./reportLetterhead');
    const rows = withProbeRefills(shiftHoursRows(UNITS, levels(), dayShifts(data, NOW)), []).map((r) => ({ ...r, section: 'IRRIGATION' }));
    const issues = shiftIssueRows(data, rows, levels());
    const done = { rows, secs: [{ name: 'IRRIGATION', rows, total: 0 }], missing: [], units: 1, failed: 0, ctx: { from: Date.parse('2026-11-17T00:00:00+03:00'), to: NOW, issues, oneDay: true } };
    const { html } = reportHtml(REPORTS.shiftFuel, done, { companyName: 'Mufindi Paper Mills Ltd', orgCode: 'KASULU', groupWords: 'Machines on approved work plans', periodWords: '17 Nov 2026', logos: { rai: 'r', ogc: 'o' }, now: NOW, landscape: true });
    expect(html).toContain('WORK PLAN FUEL REPORT');
    expect(html).toContain('WF-KASULU-');
    expect(html).toContain('IRRIGATION');
    expect(html).toContain('Fuel issues');
    expect(html).toContain('SIV-000027');
    expect(html).toContain('. Key</h2>');
  });
});
