import { describe, it, expect } from 'vitest';
import { reportHtml, reportNumber, fitColumns } from './reportLetterhead';
import { textMm } from './shiftDoc';
import { shownColumns } from './reportTables';
import { NOTE_LINES } from './letterhead';
import { REPORTS, overspeedEventTable } from './reportTables';
import { sections, overspeedRows, overspeedEvents } from './fleetReports';

const at = (s) => Date.parse(`${s}+03:00`);
const unit = (plate, group) => ({ key: plate, plate, type: 'Hino', group, vehicles: [{}] });
const opts = { companyName: 'Menengai <Oil>', orgCode: 'MENENGAI', groupWords: 'All groups', periodWords: 'p', nightWords: null,
  logos: { rai: 'r.png', ogc: 'o.png' }, now: at('2026-11-01T13:20:00') };

describe('report on the letterhead', () => {
  describe('overspeeding columns fitted to what they hold (16 Nov 2026)', () => {
    // Mufindi's week, as the operator's PDF had it: Driver blank (so left out), long top-speed times
    const week = { from: at('2026-11-09T00:00:00'), to: at('2026-11-16T00:00:00') };
    const units = [['MUFINDI - LMV 15', 115, 'T9, Mtabili, Kigoma', '2026-11-09T14:32:15'], ['MUFINDI: LMV 05', 114, 'T9, Nyankwi, Kigoma', '2026-11-14T08:01:44'],
      ['MUFINDI: LMV 06', 105, 'T18, Kazuramimba, Kigoma', '2026-11-15T17:20:09'], ['MUFINDI: LMV 19', 117, 'T9, Mtabili, Kigoma', '2026-11-12T11:47:30']];
    const rows = units.map(([plate, peak, place, when]) => ({
      ...overspeedRows([{ key: plate, plate, type: 'SALOON', group: 'Mufindi', vehicles: [{}] }],
        new Map([[undefined, [{ durationSec: 240, distanceM: 5_980, peakKmh: peak, limitKmh: 100 }]]]))[0],
      peakAt: at(when), peakPlace: place,
    }));
    const def = REPORTS.overspeed;
    const heads = def.columns(week);
    const cells = rows.map((r) => def.cells(r, week));
    const keep = shownColumns(def, rows, week);
    const need = (i) => Math.max(textMm(heads[i], 7.2, true), ...cells.map((c) => textMm(c[i], 7.8, i === 0)));

    it('gives every column room for its heading and its longest value, and Location the rest', () => {
      expect(keep.map((i) => heads[i])).not.toContain('Driver');
      const { widths, wraps } = fitColumns(heads, cells, keep, 184, { flex: 'Location', wrap: ['Driver', 'Top speed at', 'Type'] });
      keep.forEach((i, k) => { if (heads[i] !== 'Location') expect(widths[k]).toBeGreaterThanOrEqual(need(i)); });
      expect(widths.reduce((s, w) => s + w, 0)).toBeCloseTo(184, 0);
      expect([...wraps]).toEqual(['Location']);
      // Location is no longer the giant: it holds only what the others leave
      expect(widths[keep.indexOf(heads.indexOf('Location'))]).toBeLessThan(60);
    });

    it('lets Driver and Top speed at wrap, not cut, when a Driver column leaves too little room', () => {
      const named = rows.map((r) => ({ ...r, driver: 'Abdallah Rashidi Mwakyusa Kitwana' }));
      const namedCells = named.map((r) => def.cells(r, week));
      const all = shownColumns(def, named, week);
      const { widths, wraps } = fitColumns(heads, namedCells, all, 184, { flex: 'Location', wrap: ['Driver', 'Top speed at', 'Type'] });
      expect(widths.reduce((s, w) => s + w, 0)).toBeLessThanOrEqual(184.5);
      expect(wraps.has('Location')).toBe(true);
      expect(wraps.has('Driver')).toBe(true);
      // The figures still fit whole
      for (const h of ['Overspeeds', 'Time over', 'Distance, km', 'Top / limit']) {
        const i = heads.indexOf(h);
        expect(widths[all.indexOf(i)]).toBeGreaterThanOrEqual(need(i) - 0.5);
      }
    });

    it('marks Location cells to wrap in the PDF, so no place name is cut', () => {
      const done = { rows, secs: sections(rows, ['Mufindi'], (r) => r.count), ctx: week, missing: [], units: rows.length, failed: 0 };
      const { html } = reportHtml(def, done, opts);
      expect(html).toMatch(/class="[^"]*wrap[^"]*"[^>]*>T18, Kazuramimba, Kigoma/);
      expect(html).not.toMatch(/NaN/);
    });
  });

  it('numbers the report by kind, organisation and time', () => {
    expect(reportNumber('HA', 'MENENGAI', at('2026-11-01T13:20:00'))).toBe('HA-MENENGAI-20261101-1320');
  });

  it('puts the Driver Conduct Report on the letterhead', () => {
    const rows = [{ unit: unit('KCS 082M', 'Van Sales'), accel: 3, brake: 1, seatbelt: 2, phone: 0, total: 6, dashcam: true, suspect: true, driver: 'Osero' },
                  { unit: unit('KDE 140E', 'Van Sales'), accel: 1, brake: 0, seatbelt: 0, phone: 0, total: 1, dashcam: false, suspect: false, driver: null }];
    const done = { rows, secs: sections(rows, ['Van Sales'], (r) => r.total), ctx: { from: at('2026-11-01T00:00:00'), to: at('2026-11-01T13:20:00'), dashcams: true },
                   missing: [{ plate: 'KDE 1', group: 'Van Sales' }], units: 2, failed: 0 };
    const out = reportHtml(REPORTS.behaviour, done, opts);
    expect(out.landscape).toBe(false);
    expect(out.filename).toBe('Driver Conduct Report Menengai <Oil> 2026-11-01.pdf');
    expect(out.html).toContain('DRIVER CONDUCT REPORT');
    expect(out.html).toContain('DC-MENENGAI-20261101-1320');
    expect(out.html).toContain('2. Van Sales');
    expect(out.html).toContain('Check sensor');
    expect(out.html).toContain('has no dashcam');
    expect(out.html).toContain('Not tracked on the platform');
    expect(out.html).toContain('Menengai &lt;Oil&gt;');
    expect(out.html).not.toContain('Menengai <Oil>');
    // Room to write on the printed copy: full-width ruled lines, last section
    expect(out.html.match(/<div class="rule"><\/div>/g)).toHaveLength(NOTE_LINES);
    expect(out.html).toMatch(/<h2>\d+\. Notes<\/h2>/);
  });

  it('gives only the Driver Conduct Report a Notes section', () => {
    const rows = overspeedRows([unit('KDE 132E', 'Van Sales')], new Map([[undefined, [{ durationSec: 60, distanceM: 1_400, peakKmh: 83, limitKmh: 80 }]]]));
    const done = { rows, secs: sections(rows, ['Van Sales'], (r) => r.count),
                   ctx: { from: at('2026-10-30T00:00:00'), to: at('2026-10-31T00:00:00') }, missing: [], units: 1, failed: 0 };
    const { html } = reportHtml(REPORTS.overspeed, done, opts);
    expect(html).not.toContain('Notes</h2>');
    expect(html).not.toContain('class="rule"');
  });

  it('names the one unit an overspeeding report was made for', () => {
    const rows = overspeedRows([unit('KDE 132E', 'Van Sales')], new Map([[undefined, [{ durationSec: 60, distanceM: 1_400, peakKmh: 83, limitKmh: 80 }]]]));
    const done = { rows, secs: sections(rows, ['Van Sales'], (r) => r.count),
                   ctx: { from: at('2026-10-30T00:00:00'), to: at('2026-10-31T00:00:00'), unit: 'KDE 132E' }, missing: [], units: 1, failed: 0 };
    const out = reportHtml(REPORTS.overspeed, done, opts);
    expect(rows).toHaveLength(1);
    expect(out.filename).toBe('Overspeeding Report Menengai <Oil> KDE 132E 2026-11-01.pdf');
    expect(out.html).toMatch(/Unit<\/[^>]+>\s*<[^>]+>KDE 132E/);
  });

  it('lists each overspeed of the one unit, oldest first, past the 5 s floor', () => {
    const ep = (start, sec, peak, extra = {}) => ({ startedAt: `${start}+03:00`, endedAt: new Date(at(start) + sec * 1000).toISOString(),
      durationSec: sec, peakKmh: peak, avgKmh: peak - 2, limitKmh: 80, distanceM: sec * 23, peakLat: -0.29412, peakLng: 36.07215, ...extra });
    const list = [ep('2026-10-30T14:56:00', 60, 83), ep('2026-10-30T09:10:05', 228, 91, { driverName: 'Osero' }), ep('2026-10-30T11:00:00', 4, 99)];
    const events = overspeedEvents([list]);
    expect(events.map((e) => e.peakKmh)).toEqual([91, 83]);   // 4 s is under the floor; oldest first

    const t = overspeedEventTable(events);
    expect(t.head).toContain('Driver');
    expect(t.rows[0]).toEqual(['1', '30 Oct 09:10:05', '09:13:53', '-', '3 min 48 s', '91 / 80', '89', '5.24', 'Osero', '-0.29412, 36.07215']);
    expect(t.rows[1][4]).toBe('1 min 00 s');
    expect(t.rows[1][8]).toBe('-');
    // Once the reading it peaked on is found, its time to the second
    expect(overspeedEventTable([{ ...events[0], peakAt: at('2026-10-30T09:11:47') }]).rows[0][3]).toBe('09:11:47');

    const rows = overspeedRows([unit('KDE 132E', 'Van Sales')], new Map([[undefined, list]]));
    const done = { rows, secs: sections(rows, ['Van Sales'], (r) => r.count),
                   ctx: { from: at('2026-10-30T00:00:00'), to: at('2026-10-31T00:00:00'), unit: 'KDE 132E', events }, missing: [], units: 1, failed: 0 };
    const html = reportHtml(REPORTS.overspeed, done, opts).html;
    expect(html).toContain('3. Each overspeed');
    expect(html).toContain('30 Oct 09:10:05');
    expect(html).toContain('3 min 48 s');
  });

  it('gives the top speed time alone over one day, and where it was', () => {
    const rows = overspeedRows([unit('KDE 132E', 'Van Sales')], new Map([[undefined, [{ durationSec: 60, distanceM: 1_400, peakKmh: 83, limitKmh: 80 }]]]))
      .map((r) => ({ ...r, peakAt: at('2026-11-07T14:32:15'), peak: { lat: -0.82341, lng: 34.38449 } }));
    const day = { from: at('2026-11-07T00:00:00'), to: at('2026-11-08T00:00:00') };
    const heads = REPORTS.overspeed.columns();
    const cell = (r, ctx, h) => REPORTS.overspeed.cells(r, ctx)[heads.indexOf(h)];
    expect(cell(rows[0], day, 'Top speed at')).toBe('14:32:15');
    // No name found: its coordinates; a name: the name; no fix at all: blank, and the column left out
    expect(cell(rows[0], day, 'Location')).toBe('-0.82341, 34.38449');
    expect(cell({ ...rows[0], peakPlace: 'A1, Stelah, Uriri' }, day, 'Location')).toBe('A1, Stelah, Uriri');
    expect(cell({ ...rows[0], peak: null }, day, 'Location')).toBe('–');

    const named = [{ ...rows[0], peakPlace: 'A1, Stelah, Uriri' }];
    const done = { rows: named, secs: sections(named, ['Van Sales'], (r) => r.count), ctx: day, missing: [], units: 1, failed: 0 };
    const { html } = reportHtml(REPORTS.overspeed, done, opts);
    expect(html).toContain('A1, Stelah, Uriri');
    expect(html).not.toMatch(/NaN/);    // a width for every column
  });

  it('says when each vehicle reached its top speed, to the second', () => {
    const rows = overspeedRows([unit('KDE 132E', 'Van Sales')], new Map([[undefined, [{ durationSec: 60, distanceM: 1_400, peakKmh: 83, limitKmh: 80 }]]]))
      .map((r) => ({ ...r, peakAt: at('2026-11-07T14:32:15') }));
    const done = { rows, secs: sections(rows, ['Van Sales'], (r) => r.count),
                   ctx: { from: at('2026-11-02T00:00:00'), to: at('2026-11-09T00:00:00'), peaksFailed: 1 }, missing: [], units: 1, failed: 0 };
    // Over a week the day is there too
    expect(REPORTS.overspeed.cells(rows[0], done.ctx)[REPORTS.overspeed.columns().indexOf('Top speed at')]).toBe('Sat 07 Nov 2026 14:32:15');
    const html = reportHtml(REPORTS.overspeed, done, opts).html;
    expect(html).toContain('Top speed at');
    expect(html).toContain('Sat 07 Nov 2026 14:32:15');
    expect(html).toContain('could not be read: their top speed time shows as -');
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
