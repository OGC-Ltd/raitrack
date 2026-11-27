import { describe, it, expect } from 'vitest';
import { tableLetterheadSpec } from './tableLetterhead';
import { drawLetterheadTablePdf } from './letterheadTablePdf';

const HEAD = ['Date', 'Time', 'Vehicle', 'Driver', 'Type', 'Token', 'Centre', 'Tare (kg)', 'Tare at', 'Gross (kg)',
  'Gross at', 'Net (kg)', 'Payload (t)', 'Load time', 'Ticket no. today', 'Tickets today', 'Since previous'];
const row = (i) => ['17/11/2026', '18:59', `KTCB ${String(i).padStart(3, '0')}X`, 'OLIVER MWAMGALA SIKUKU', 'Delivery',
  String(1000900000 + i), 'FACTORY', '5,580', '17/11 19:00', '10,480', '17/11 19:03', '4,900', '4.90', '3m', 1, 1, 'first'];

const spec = (rows) => tableLetterheadSpec({
  reportTitle: 'Weighbridge Tickets: FACTORY', sectionTitle: 'FACTORY, 17 Oct to 17 Nov',
  filterNote: '17 Oct to 17 Nov · FACTORY', cards: [{ label: 'Tickets', value: String(rows) }, { label: 'Net weighed', value: '49,295.4 t' }],
  head: HEAD, body: Array.from({ length: rows }, (_, i) => row(i)),
  companyName: 'Sukari Industries', orgCode: 'SUKARI', prefix: 'WB', now: Date.parse('2026-11-17T14:00:00+03:00'),
});

describe('tableLetterheadSpec', () => {
  it('turns the table into plain data: landscape, widths that fill the page, figures right', () => {
    const s = spec(3);
    expect(s.landscape).toBe(true);
    expect(s.reportNo).toMatch(/^WB-SUKARI-20261117-/);
    expect(s.cols.reduce((t, c) => t + c.w, 0)).toBeCloseTo(271, 0);
    expect(s.cols[HEAD.indexOf('Net (kg)')].right).toBe(true);
    expect(s.cols[0].bold).toBe(true);
    expect(s.filename).toBe('Weighbridge Tickets - FACTORY Sukari Industries 2026-11-17.pdf');
  });
});

describe('drawLetterheadTablePdf', () => {
  it('draws 7,049 rows into a PDF, saying how far it has got all the way', () => {
    const seen = [];
    const t0 = Date.now();
    const buf = drawLetterheadTablePdf(spec(7049), {}, (p) => seen.push(p));
    const ms = Date.now() - t0;
    const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 5));
    expect(head).toBe('%PDF-');
    const pages = (new TextDecoder('latin1').decode(new Uint8Array(buf)).match(/\/Type \/Page\b/g) ?? []).length;
    // About 39 rows a page, not 12: a name on one line, the headings wrapping instead
    expect(pages).toBeGreaterThan(150);
    expect(pages).toBeLessThan(220);
    const rows = seen.filter((p) => p.phase === 'Drawing rows').map((p) => p.done);
    expect(rows.length).toBeGreaterThan(50);              // many steps, a percentage each
    expect(rows.at(-1)).toBe(7049);
    expect(rows).toEqual([...rows].sort((a, b) => a - b)); // only ever forward
    expect(seen.at(-1).phase).toBe('Saving');
    // For the record: how long the worker spends on it, off the page's thread
    console.info(`7,049 rows: ${pages} pages in ${(ms / 1000).toFixed(1)} s`);
  }, 120_000);

  it('says so when there is nothing to print', () => {
    const buf = drawLetterheadTablePdf(spec(0), {});
    expect(new TextDecoder().decode(new Uint8Array(buf).slice(0, 5))).toBe('%PDF-');
  });
});

describe('sections before the main table (the Wialon unit report, 2026-11-27)', () => {
  const unitSpec = (before) => tableLetterheadSpec({
    reportTitle: 'Maintenance: Wialon - KDJ 813Z', sectionTitle: 'KDJ 813Z, every case loaded', filterNote: 'test',
    cards: [{ label: 'Unit', value: 'KDJ 813Z' }], head: ['Fault', 'Started', 'Detail'],
    body: [['Fuel probe status error', '27 Nov, 11:46', 'Fuel probe: Status Error']],
    companyName: 'Nzoia Sugar', orgCode: 'NZOIA', now: Date.parse('2026-11-27T16:00:00+03:00'), before,
  });
  const section = { title: 'Tracker status now', small: '27/11/2026 16:00 · 2 faults', head: ['Reading', 'Value', 'Label in Wialon', 'Status'],
    body: [['Fls Status', '3', 'Error', 'Fault'], ['Fls Temperature', '0 °C', 'Sensor not found', 'Fault'], ['External Battery Voltage', '26.1 V', '', '']] };
  it('carries them into the spec, blanks as dashes; none by default', () => {
    expect(unitSpec(undefined).before).toEqual([]);
    const s = unitSpec([section]);
    expect(s.before).toHaveLength(1);
    expect(s.before[0].body[2]).toEqual(['External Battery Voltage', '26.1 V', '-', '-']);
  });
  it('draws a PDF with them, longer than the same report without', () => {
    const without = drawLetterheadTablePdf(unitSpec([]));
    const withIt = drawLetterheadTablePdf(unitSpec([section]));
    expect(new TextDecoder().decode(new Uint8Array(withIt).slice(0, 5))).toBe('%PDF-');
    expect(withIt.byteLength).toBeGreaterThan(without.byteLength);
  });
  it('a unit’s 29 readings in two columns fit the first page with its case (MUFINDI DG 11)', () => {
    const readings = Array.from({ length: 29 }, (_, i) => [`Reading number ${i + 1}`, i === 0 ? '1 Kvants' : `${i}.5 V`, i === 0 ? 'No Fuel Error - Contact Support' : '-', i === 0 ? 'Fault' : '-']);
    const two = { ...section, columns: 2, body: readings };
    const pages = (buf) => (new TextDecoder('latin1').decode(new Uint8Array(buf)).match(/\/Type \/Page\b/g) ?? []).length;
    expect(unitSpec([two]).before[0].columns).toBe(2);
    expect(pages(drawLetterheadTablePdf(unitSpec([two])))).toBe(1);
  });
});
