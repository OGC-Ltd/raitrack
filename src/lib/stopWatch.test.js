import { describe, it, expect } from 'vitest';
import * as sw from './stopWatch';
import { flaggedUnits, placesOf, placeAt, flagWords, NOGO_MIN_MS, UNAUTHORISED_MIN_MS } from './stopWatch';
import { AUTHORISED, NO_GO } from '../data/menengaiStopPlaces';

const now = Date.parse('2026-11-05T16:30:00+03:00');
const ago = (min) => new Date(now - min * 60_000).toISOString();
const unit = (plate, lat, lng, over = {}) => ({ id: plate, regPlate: plate, vehicleId: plate, lat, lng, speed: 0,
  capturedAt: ago(1), movement: { state: 'resting', since: ago(30) }, ...over });

describe('the stop watch: Menengai units where they should not stand', () => {
  const authorised = placesOf(AUTHORISED);
  const noGo = placesOf(NO_GO);

  it('reads the file: 90 authorised places, 7 no-go zones, no test entries', () => {
    expect(AUTHORISED).toHaveLength(90);
    expect(NO_GO.map((f) => f.properties.name)).toEqual(['Voi', 'kwa dc', 'Kipsitet no Stopping Zone', 'Awasi No stop Zone', 'Maungu stop/rest zone', 'Kikopey', 'Kedowa Market no stopping Zone']);
    expect(JSON.stringify([AUTHORISED, NO_GO])).not.toMatch(/95E9|Test location|fbgddf/);
  });

  it('flags standing in a no-go zone after 2 minutes, and stopping elsewhere after 10', () => {
    const kipsitet = { lat: -0.207194830395194, lng: 35.1505851745605 };     // its centre
    const bush = { lat: -0.9, lng: 36.6 };                                      // no place near
    const sotik = { lat: -0.68995, lng: 35.10965 };                             // inside SOTIK CENTRAL STORES
    expect(placeAt(sotik, authorised)?.name).toBe('SOTIK CENTRAL STORES LTD');
    const flags = flaggedUnits([
      unit('KCF 180A', kipsitet.lat, kipsitet.lng),
      unit('KCF 181A', kipsitet.lat, kipsitet.lng, { movement: { state: 'resting', since: ago(1) } }),      // 1 min: not yet
      unit('KDE 127E', bush.lat, bush.lng),
      unit('KDE 128E', bush.lat, bush.lng, { movement: { state: 'idling', since: ago(5) } }),              // 5 min: not yet
      unit('KCS 076M', bush.lat, bush.lng, { speed: 45, movement: { state: 'moving', since: ago(40) } }), // driving
      unit('KCB 123P', sotik.lat, sotik.lng),                                                                // at a customer
      unit('KCH 045A', -0.2880, 36.0449),                                                                    // at MORL
      unit('KCA 918P', bush.lat, bush.lng, { capturedAt: ago(60 * 24) }),                                   // a day old: not judged
    ], { authorised, noGo, now });
    expect(flags.map((f) => [f.plate, f.kind, f.zone])).toEqual([
      ['KCF 180A', 'nogo', 'Kipsitet no Stopping Zone'],
      ['KDE 127E', 'unauthorised', null],
    ]);
    expect(flagWords(flags[0], now)).toBe('KCF 180A has stood 30 min in the no-go zone Kipsitet no Stopping Zone.');
    expect(NOGO_MIN_MS).toBe(120_000);
    expect(UNAUTHORISED_MIN_MS).toBe(600_000);
  });

  it('counts the platform’s own geofences as authorised', () => {
    const shop = { type: 'Feature', properties: { name: 'MENENGAI_VS: JOJAC' }, geometry: { type: 'Polygon', coordinates: [[[36.599, -0.901], [36.601, -0.901], [36.601, -0.899], [36.599, -0.899], [36.599, -0.901]]] } };
    const flags = flaggedUnits([unit('KDE 127E', -0.9, 36.6)], { authorised: [...authorised, ...placesOf([shop])], noGo, now });
    expect(flags).toEqual([]);
  });
});

describe('Alerts: an unauthorised stop’s place, copy and read marks', () => {
  const square = (name, lat, lng, props = {}) => ({ type: 'Feature', properties: { name, ...props },
    geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + 0.001, lat], [lng + 0.001, lat + 0.001], [lng, lat + 0.001], [lng, lat]]] } });
  const places = sw.placesOf([
    square('NAIVAS', 0.01, 36, { type: 'Customer' }),
    square('Menengai Yard', 0.05, 36, { category: 'yard' }),
    square('Far shop', 1, 37, { category: 'shop' }),
  ]);

  it('names the nearest authorised place, its type and how far', () => {
    const n = sw.nearestPlace({ lat: 0.0, lng: 36.0005 }, places);
    expect(n.name).toBe('NAIVAS');
    expect(n.category).toBe('customer');
    expect(n.metres).toBeGreaterThan(1000);
    expect(n.metres).toBeLessThan(1200);
    expect(sw.nearestPlace({ lat: 0.0505, lng: 36.0005 }, places)).toMatchObject({ name: 'Menengai Yard', metres: 0 });
    expect(sw.distanceWords(1113)).toBe('1.1 km');
    expect(sw.distanceWords(240)).toBe('240 m');
  });

  it('is unread from the moment it qualified as a stop', () => {
    const since = Date.parse('2026-11-06T10:00:00Z');
    expect(sw.stopLine({ key: 'v|stop|1', kind: 'unauthorised', since }).ts).toBe('2026-11-06T10:10:00.000Z');
    expect(sw.stopLine({ key: 'v|nogo|Z|1', kind: 'nogo', since }).ts).toBe('2026-11-06T10:02:00.000Z');
  });

  it('copies a stop as lines to paste', () => {
    const f = { kind: 'unauthorised', plate: 'KDE 127E', since: Date.parse('2026-11-06T11:00:00Z'), lat: -0.1, lng: 36.2 };
    expect(sw.stopCopyText(f, { now: Date.parse('2026-11-06T11:25:00Z'), place: 'NAIVAS (Customer), 1.1 km' })).toBe([
      'Unauthorised stop · KDE 127E',
      'Standing since: 6 Nov 2026, 14:00',
      'For: 25 min',
      'Where: Outside any authorised place',
      'Nearest place: NAIVAS (Customer), 1.1 km',
      'Location: -0.10000, 36.20000 · https://www.google.com/maps?q=-0.1,36.2',
    ].join('\n'));
    expect(sw.stopCopyText(f, { area: 'Londiani, Kericho' })).toContain('Where: Londiani, Kericho, outside any authorised place');
    expect(sw.stopCopyText({ ...f, kind: 'nogo', zone: 'Awasi' })).toContain('Where: No-go zone Awasi');
  });
});
