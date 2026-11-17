import { describe, it, expect } from 'vitest';
import { tableLetterheadHtml } from './tableLetterhead';

const LOGOS = { rai: 'rai.png', ogc: 'ogc.png' };
// 12:40 on 17 Nov 2026, Nairobi
const NOW = Date.UTC(2026, 10, 17, 9, 40);

const MALFUNCTION = {
  reportTitle: 'Sensor Monitor: Malfunction',
  sectionTitle: '2 units',
  filterNote: 'Sensor fault episodes for today. Every unit in the window.',
  cards: [{ label: 'Units in report', value: '2' }],
  head: ['Unit', 'Sensor', 'Episodes', 'Still open', 'Time faulty', 'Longest episode', 'Faults', 'Date', 'Timestamp', 'Location', 'Motion', 'Status'],
  body: [
    ['MUFINDI : MTR 10', 'Ignition', 51, '-', '3h 39m', '33m', 'Speed with ignition off; In transit, ignition off', '17/11/2026', '11:40 hrs', 'T9, Mtabili, Kigoma', 'Moving · 12 km/h', 'Resolved'],
    ['MUFINDI: BUS 01', 'Fuel probe, Ignition', 11, 2, '17h 42m', '12h 55m', 'Fuel probe dead; In transit, ignition off', '17/11/2026', '12:48 hrs', 'Kigoma, Tanzania', 'Moving · 2 km/h', 'Open'],
  ],
  companyName: 'Mufindi Paper Mills Ltd',
  orgCode: 'KASULU',
  logos: LOGOS,
  now: NOW,
};

describe('tableLetterheadHtml', () => {
  it('prints on the letterhead, named for the organisation, not "Fleet Tracking"', () => {
    const { html } = tableLetterheadHtml(MALFUNCTION);
    expect(html).toContain('class="lh"');
    expect(html).toContain('src="rai.png"');
    expect(html).toContain('SENSOR MONITOR: MALFUNCTION');
    expect(html).toContain('Mufindi Paper Mills Ltd');
    expect(html).not.toContain('Fleet Tracking');
  });

  it('numbers the report for the organisation', () => {
    expect(tableLetterheadHtml(MALFUNCTION).html).toContain('SM-KASULU-20261117-1240');
  });

  it('turns a wide table on its side, keeps a narrow one upright', () => {
    expect(tableLetterheadHtml(MALFUNCTION).landscape).toBe(true);
    const narrow = { ...MALFUNCTION, head: ['Unit', 'Episodes'], body: [['A', 1]] };
    expect(tableLetterheadHtml(narrow).landscape).toBe(false);
  });

  it('carries every row and the overview figures', () => {
    const { html } = tableLetterheadHtml(MALFUNCTION);
    expect(html).toContain('MUFINDI : MTR 10');
    expect(html).toContain('MUFINDI: BUS 01');
    expect(html).toContain('Units in report');
    expect(html).toContain('2 rows');
  });

  it('right-aligns figures and durations, wraps the wordy columns', () => {
    const { html } = tableLetterheadHtml(MALFUNCTION);
    const heads = [...html.matchAll(/<th class="([^"]*)">([^<]*)<\/th>/g)].map((m) => [m[2], m[1]]);
    const cls = Object.fromEntries(heads);
    expect(cls.Episodes).toBe('r');
    expect(cls['Time faulty']).toBe('r');
    expect(cls.Faults).toBe('');
    expect(html).toContain('class="wrap"');
  });

  it('greys an empty cell and escapes what it prints', () => {
    const { html } = tableLetterheadHtml({ ...MALFUNCTION, body: [['<b>X</b>', '', '-', '', '', '', '', '', '', '', '', '']] });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('<td class="m">-</td>');
  });

  it('says so when nothing matched', () => {
    expect(tableLetterheadHtml({ ...MALFUNCTION, body: [] }).html).toContain('Nothing matched the current filters.');
  });

  it('names the file without characters Windows refuses', () => {
    expect(tableLetterheadHtml(MALFUNCTION).filename)
      .toBe('Sensor Monitor - Malfunction Mufindi Paper Mills Ltd 2026-11-17.pdf');
  });
});
