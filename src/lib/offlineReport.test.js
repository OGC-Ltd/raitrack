import { describe, it, expect } from 'vitest';
import { sectionOf, offlineReport, offlineCount, rowCells, sectionDays, SECTIONS, csvTable, offlineHtml } from './offlineReport';
import { reportKeysFor } from './reportNav';

const at = (s) => Date.parse(`${s}+03:00`);
// Made on 31 Oct, as their sheet was
const NOW = at('2026-10-31T09:00:00');
const row = (id, name, last, location = 'D267, Kenya, 1.84 km from Kambi-Mwanza') => ({ vehicleId: id, grouping: name, lastAt: last == null ? null : at(last), location });

describe('Non-Updating Assets Report', () => {
  it('puts a vehicle in its section by the day of its last message', () => {
    expect(sectionOf(at('2026-10-31T00:30:00'), NOW)).toBeNull();          // today: not yet
    expect(sectionOf(at('2026-10-30T23:59:00'), NOW)).toBe('yesterday');
    expect(sectionOf(at('2026-10-30T00:00:00'), NOW)).toBe('yesterday');
    expect(sectionOf(at('2026-10-29T20:20:34'), NOW)).toBe('two');
    expect(sectionOf(at('2026-10-28T08:22:08'), NOW)).toBe('two');
    expect(sectionOf(at('2026-10-27T18:23:20'), NOW)).toBe('over');
    expect(sectionOf(at('2026-10-01T10:00:00'), NOW)).toBe('over');
    expect(sectionOf(null, NOW)).toBeNull();
  });

  it('builds the three sections newest first, and counts those never heard from', () => {
    const rep = offlineReport([
      row('a', 'WKS - Kabras - KDJ 814Z-', '2026-10-30T11:31:44'),
      row('b', 'WKS - Kabras - KBV 472N', '2026-10-30T11:42:05'),
      row('c', 'WKS - Magut - KCD 394D', '2026-10-29T20:20:34'),
      row('d', 'WKS - Misikhu - KDR 095Q', '2026-10-27T18:23:20'),
      row('e', 'WKS - Kabras - KCR 932Q', '2026-10-31T08:58:00'),         // reporting
      row('f', 'WKS - Kabras - KTCC 411H', null),
      row('b', 'WKS - Kabras - KBV 472N', '2026-10-30T11:42:05'),          // the same unit twice: once
    ], NOW);
    expect(rep.sections.yesterday.map((r) => r.name)).toEqual(['WKS - Kabras - KBV 472N', 'WKS - Kabras - KDJ 814Z-']);
    expect(rep.sections.two.map((r) => r.name)).toEqual(['WKS - Magut - KCD 394D']);
    expect(rep.sections.over.map((r) => r.name)).toEqual(['WKS - Misikhu - KDR 095Q']);
    expect(rep.never.map((r) => r.name)).toEqual(['WKS - Kabras - KTCC 411H']);
    expect(rep.total).toBe(6);
    expect(offlineCount(rep)).toBe(4);
    expect(rowCells(rep.sections.yesterday[0])).toEqual(['WKS - Kabras - KBV 472N', '2026-10-30 11:42:05', 'D267, Kenya, 1.84 km from Kambi-Mwanza']);
    expect(csvTable(rep).body[0][0]).toBe('Offline yesterday');

    const { html, filename } = offlineHtml(rep, { fleet: 'West Kenya', orgCode: 'KABRAS', logos: { rai: '', ogc: '' }, now: NOW });
    expect(html).toContain('NON-UPDATING ASSETS REPORT');
    for (const s of SECTIONS) expect(html).toContain(s.title);
    expect(html).toContain('1 vehicle has never reported');
    expect(filename).toBe('Non-Updating Assets Report West Kenya 2026-10-31.pdf');
  });

  it('names the days each section covers', () => {
    expect(SECTIONS.map((s) => sectionDays(s, NOW))).toEqual(['30/10/2026', '28/10/2026 – 29/10/2026', '27/10/2026 and earlier']);
  });

  it('is West Kenya’s and Menengai’s', () => {
    for (const org of ['WESTSUGAR', 'KABRAS', 'NZOIA', 'MENENGAI']) expect(reportKeysFor(() => true, org)).toContain('offline');
    expect(reportKeysFor(() => true, 'KASULU')).not.toContain('offline');
    expect(reportKeysFor(() => true, 'MENENGAI')).not.toContain('geofences');
  });
});
