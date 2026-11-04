import { describe, it, expect } from 'vitest';
import { depotsFor, findDepots, depotAt, metresToFence } from './movementDepots';

// The Nairobi depot fence: a square of about 35 m round a yard in Nairobi
const LAT = -1.3; const LNG = 36.85; const D = 0.00016;
const depot = { type: 'Feature', properties: { name: 'MENENGAI_FG: NAIROBI DEPOT' },
  geometry: { type: 'Polygon', coordinates: [[[LNG - D, LAT - D], [LNG + D, LAT - D], [LNG + D, LAT + D], [LNG - D, LAT + D], [LNG - D, LAT - D]]] } };
const zones = { features: [{ type: 'Feature', properties: { name: 'MENENGAI_VS: COCACOLA' }, geometry: depot.geometry }, depot] };
const row = (lat, lng, extra = {}) => ({ vehicleId: 'v', lat, lng, lastAt: 1, ...extra });
const kmNorth = (km) => LAT + D + km / 111.2;

describe('Movements depots: Menengai’s Van Sales at the Nairobi depot', () => {
  it('finds the depot fence by its name, and says when it is not on the platform', () => {
    expect(depotsFor('menengai')).toHaveLength(1);
    expect(depotsFor('KABRAS')).toEqual([]);
    const { found, missing } = findDepots('MENENGAI', zones);
    expect(found[0].fence).toBe('MENENGAI_FG: NAIROBI DEPOT');
    expect(missing).toEqual([]);
    expect(findDepots('MENENGAI', { features: [] }).missing[0].label).toBe('Nairobi depot');
  });

  it('measures to the fence’s edge: 0 inside', () => {
    expect(metresToFence({ lat: LAT, lng: LNG }, depot)).toBe(0);
    expect(metresToFence({ lat: kmNorth(0.5), lng: LNG }, depot)).toBeGreaterThan(490);
    expect(metresToFence({ lat: kmNorth(0.5), lng: LNG }, depot)).toBeLessThan(510);
  });

  it('marks a Van Sales unit inside or within 1 km, nobody else', () => {
    const { found } = findDepots('MENENGAI', zones);
    expect(depotAt(row(LAT, LNG), 'Van Sales', found)?.key).toBe('nairobi');
    expect(depotAt(row(kmNorth(0.9), LNG), 'Van Sales', found)?.key).toBe('nairobi');
    expect(depotAt(row(kmNorth(1.2), LNG), 'Van Sales', found)).toBeNull();
    expect(depotAt(row(LAT, LNG), 'Tankers', found)).toBeNull();
    expect(depotAt(row(null, null), 'Van Sales', found)).toBeNull();
    expect(depotAt(row(LAT, LNG, { lastAt: null }), 'Van Sales', found)).toBeNull();
  });
});
