import { describe, it, expect } from 'vitest';
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
