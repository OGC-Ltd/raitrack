import { describe, it, expect } from 'vitest';
import { alertFeed, readAlert } from './alertFeed';

// CTR 07's Alerts tab on 27 Sep, as the playback route sent it (times EAT)
const at = (hhmm) => Date.parse(`2026-09-27T${hhmm}:00+03:00`);
const UNIT = 'MUFINDI - CTR 07';
const CTR07 = [
  { t: at('07:43'), kind: 'theft', severity: 'critical', label: 'Fuel drain',
    detail: 'POSSIBLE THEFT — FUEL DRAINED FROM A PARKED MACHINE: MUFINDI - CTR 07 lost 12.1 L (692.9 L to 680.8 L) after standing still for 27 minutes with the engine off, and was still down 5 minutes later. This is updated if the fuel comes back.' },
  { t: at('08:11'), kind: 'theft', severity: 'critical', label: 'Fuel drain',
    detail: 'POSSIBLE THEFT: MUFINDI - CTR 07 recorded a drop of 21.3 L, drawn off while parked at T9, Tanzania, Nyamidaho Ward, Kasulu DC, Kigoma Region, 3.20 km from Nyalulanga. The tank now holds 659.6 L.' },
  { t: at('08:11'), kind: 'theft', severity: 'critical', label: 'Fuel drain', detail: '21.3 L', ml: 21300 },
  { t: at('08:43'), kind: 'theft', severity: 'critical', label: 'Fuel drain',
    detail: 'POSSIBLE THEFT — FUEL DRAINED FROM A PARKED MACHINE: MUFINDI - CTR 07 lost 21.3 L (680.8 L to 659.6 L) after standing still for 11 minutes with the engine off, and was still down 5 minutes later. This is updated if the fuel comes back.' },
  { t: at('15:11'), kind: 'theft', severity: 'critical', label: 'Fuel drain',
    detail: 'POSSIBLE THEFT — FUEL STILL MISSING: MUFINDI - CTR 07 lost 21.3 L while parked with the engine off, and the level had not come back as fuel two hours after the machine started (it next started 6.5 h after the fall).' },
  { t: at('15:11'), kind: 'theft', severity: 'critical', label: 'Fuel drain',
    detail: 'POSSIBLE THEFT — FUEL STILL MISSING: MUFINDI - CTR 07 lost 12.1 L while parked with the engine off, and the level had not come back as fuel two hours after the machine started (it next started 7.5 h after the fall).' },
];

describe('readAlert', () => {
  it('splits the headline into a tag and a title, in sentence case', () => {
    const a = readAlert(CTR07[4], UNIT);
    expect(a.tag).toBe('Possible theft');
    expect(a.title).toBe('Fuel still missing');
  });

  it("drops the unit's own name from the sentence", () => {
    expect(readAlert(CTR07[4], UNIT).body).toMatch(/^Lost 21\.3 L while parked/);
    expect(readAlert(CTR07[1], UNIT).body).toMatch(/^Recorded a drop of 21\.3 L/);
  });

  it('reads the litres from the figure or the sentence', () => {
    expect(readAlert(CTR07[2], UNIT).litres).toBe(21.3);
    expect(readAlert(CTR07[0], UNIT).litres).toBe(12.1);
  });

  it('has no body when the detail was only the litres', () => {
    const a = readAlert(CTR07[2], UNIT);
    expect(a.title).toBe('Fuel drain');
    expect(a.body).toBeNull();
  });

  it('leaves a sentence with no headline alone', () => {
    const a = readAlert({ t: 1, kind: 'zone', severity: 'info', label: 'Zone', detail: 'Entered Farm #215' }, UNIT);
    expect(a).toMatchObject({ title: 'Zone', tag: null, body: 'Entered Farm #215', litres: null });
  });

  it('keeps FUEL RATE in capitals, as it is named everywhere else', () => {
    const a = readAlert({ t: 1, kind: 'theft', severity: 'warning', label: 'Fuel drain', detail: 'FUEL RATE: burned 40 L in 2 h' }, UNIT);
    expect(a.title).toBe('FUEL RATE');
  });
});

describe('alertFeed', () => {
  const [day] = alertFeed(CTR07, UNIT);

  it('folds the six rows of 27 Sep into its two losses', () => {
    expect(day.day).toBe('2026-09-27');
    expect(day.entries.map((e) => [e.type, e.litres, e.reports.length])).toEqual([
      ['loss', 21.3, 4],
      ['loss', 12.1, 2],
    ]);
  });

  it('dates a loss from its first report and names its latest', () => {
    const loss = day.entries[0];
    expect(loss.t).toBe(at('08:11'));
    expect(loss.title).toBe('Possible theft');
    expect(loss.latest).toMatchObject({ t: at('15:11'), title: 'Fuel still missing' });
    expect(loss.severity).toBe('critical');
  });

  it('keeps a lone report as a plain alert, and other kinds unfolded', () => {
    const feed = alertFeed([
      CTR07[0],
      { t: at('09:00'), kind: 'speeding', severity: 'warning', label: 'Speeding', detail: '92 km/h' },
    ], UNIT);
    expect(feed[0].entries.map((e) => [e.type, e.title])).toEqual([
      ['alert', 'Speeding'],
      ['alert', 'Fuel drained from a parked machine'],
    ]);
  });

  it('puts the newest day first', () => {
    const feed = alertFeed([
      { ...CTR07[0], t: at('07:43') },
      { ...CTR07[0], t: at('07:43') + 86_400_000 },
    ], UNIT);
    expect(feed.map((d) => d.day)).toEqual(['2026-09-28', '2026-09-27']);
  });
});
