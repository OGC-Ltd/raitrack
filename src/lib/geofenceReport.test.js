import { describe, it, expect } from 'vitest';
import {
  placesIn, placeNames, visitsOf, geofenceRows, rowCells, counts, periodProblem, durationWords, stampWords, geofencePdfBody,
} from './geofenceReport';
import { templateFor, familyOf } from './reportTemplates';
import { reportKeysFor, hasTankersTab, hasGeofencesTab } from './reportNav';

const at = (s) => Date.parse(`${s}+03:00`);
// Khalaba Station: a square; Magut: a circle 300 m round; a road that is no place
const square = (name, lat, lng, d = 0.005) => ({ type: 'Feature', properties: { name },
  geometry: { type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] } });
const zones = { features: [
  square('Khalaba Station', 0.5, 34.8),
  { type: 'Feature', properties: { name: 'Magut', radiusM: 300 }, geometry: { type: 'Point', coordinates: [34.9, 0.6] } },
  { type: 'Feature', properties: { name: 'Haulage road' }, geometry: { type: 'LineString', coordinates: [[34.8, 0.5], [34.9, 0.6]] } },
] };
const KHALABA = { lat: 0.5, lng: 34.8 };
const MAGUT = { lat: 0.6, lng: 34.9 };
const ROAD = { lat: 0.55, lng: 34.85 };
const ping = (s, where) => ({ t: at(s), ...where });
const day = { from: at('2026-10-30T00:00:00'), to: at('2026-10-31T00:00:00') };

describe('Geofence Report', () => {
  it('knows the places: polygons and circles, never roads', () => {
    expect(placeNames(zones)).toEqual(['Khalaba Station', 'Magut']);
    expect(placesIn(zones, ['Magut']).map((p) => p.name)).toEqual(['Magut']);
  });

  it('reads each visit, cut at the period’s edges, a return a few minutes later its own row', () => {
    const pings = [
      ping('2026-10-29T22:00:00', KHALABA),                   // inside before the day began
      ping('2026-10-30T04:29:11', ROAD),
      ping('2026-10-30T09:32:12', MAGUT), ping('2026-10-30T12:59:07', ROAD),
      ping('2026-10-30T13:00:00', MAGUT), ping('2026-10-30T13:00:20', ROAD), // 20 seconds: kept, as the sheet has it
      ping('2026-10-30T18:00:06', KHALABA), ping('2026-10-30T23:59:55', KHALABA),
    ];
    const v = visitsOf(pings, placesIn(zones), day);
    expect(v.map((x) => [x.place, stampWords(x.in), stampWords(x.out), x.open])).toEqual([
      ['Khalaba Station', '2026-10-30 00:00:00', '2026-10-30 04:29:11', false],
      ['Magut', '2026-10-30 09:32:12', '2026-10-30 12:59:07', false],
      ['Magut', '2026-10-30 13:00:00', '2026-10-30 13:00:20', false],
      ['Khalaba Station', '2026-10-30 18:00:06', '2026-10-31 00:00:00', true],
    ]);
    expect(durationWords(v[0].out - v[0].in)).toBe('4:29:11');
  });

  it('says Still inside only when the period ends now', () => {
    const r = { vehicle: 'WKS - Kabras - KCR 932Q', place: 'Khalaba Station', in: at('2026-10-30T18:00:00'), out: day.to, open: true };
    expect(rowCells(r, { to: day.to, now: at('2026-11-03T13:00:00') })[3]).toBe('2026-10-31 00:00:00');
    expect(rowCells(r, { to: day.to, now: day.to + 60_000 })[3]).toBe('Still inside');
  });

  it('builds the rows by vehicle, then time in, and counts them', () => {
    const vehicles = [{ vehicleId: 'b', name: 'WKS - Naitiri - KCR 210Y' }, { vehicleId: 'a', name: 'WKS - Kabras - KCS 650G' }];
    const pings = { a: [ping('2026-10-30T11:08:11', MAGUT), ping('2026-10-30T11:08:31', ROAD)], b: [ping('2026-10-30T07:00:00', KHALABA), ping('2026-10-30T08:00:00', ROAD)] };
    const rows = geofenceRows(vehicles, (id) => pings[id], placesIn(zones), day);
    expect(rows.map((r) => r.vehicle)).toEqual(['WKS - Kabras - KCS 650G', 'WKS - Naitiri - KCR 210Y']);
    expect(counts(rows)).toEqual({ visits: 2, vehicles: 2, places: 2, still: 0 });
    const body = geofencePdfBody(rows, { ...day, fleet: 'West Kenya', places: ['Magut'], failed: 1 });
    expect(body.fleet).toBe('West Kenya');
    expect(body.places).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.rows[0]).toMatchObject({ vehicle: 'WKS - Kabras - KCS 650G', open: false });
    expect(geofencePdfBody(rows, { ...day, fleet: 'W' }).places).toBeNull();
  });

  it('refuses a period it cannot make', () => {
    const now = at('2026-11-03T13:00:00');
    expect(periodProblem({ from: now - 3600_000, to: now }, now)).toBeNull();
    expect(periodProblem({ from: now, to: now - 1 }, now)).toBe('The period has not begun yet');
    expect(periodProblem({ from: now - 9 * 86_400_000, to: now }, now)).toBe('7 days at most for this report');
  });

  it('is a template: West Kenya’s organisations have it, and make it together', () => {
    expect(templateFor('geofences', 'kabras')).toEqual({});
    expect(templateFor('geofences', 'MENENGAI')).toBeNull();
    expect(familyOf('geofences', 'NZOIA')).toBeNull();
    expect(familyOf('geofences', 'WESTSUGAR').name).toBe('West Kenya');
    expect(hasGeofencesTab(() => true, 'KABRAS')).toBe(true);
    expect(hasGeofencesTab(() => true, 'MENENGAI')).toBe(false);
    expect(reportKeysFor(() => true, 'KABRAS')).not.toContain('geofences');
    // Tankers is a tab under Movements, Menengai's only (operator, 3 Nov 2026)
    expect(reportKeysFor(() => true, 'MENENGAI')).not.toContain('tankers');
    expect(hasTankersTab(() => true, 'MENENGAI')).toBe(true);
    expect(hasTankersTab(() => true, 'KABRAS')).toBe(false);
  });
});
