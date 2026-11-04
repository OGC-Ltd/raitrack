import { describe, it, expect } from 'vitest';
import { atSto, withStoDirections, STO_POINT } from './stoUnits';
import { directionWords, statesFor, countRows } from './movementReport';

const AT_STO = { lat: STO_POINT.lat + 0.005, lng: STO_POINT.lng };      // ~550 m
const TOWN = { lat: -1.2864, lng: 36.8172 };                              // Nairobi CBD, ~5.7 km
const MORL = { lat: -0.288, lng: 36.0449 };
const row = (over) => ({ vehicleId: 'v1', plate: 'KCH 467T', grouping: 'Menengai - KCH 467T', lastAt: 1, speedKmh: 0, state: 'from', ...TOWN, ...over });
const fence = { type: 'Feature', properties: { name: 'MENENGAI_FG: NAIROBI DEPOT' },
  geometry: { type: 'Polygon', coordinates: [[[36.866, -1.3027], [36.8664, -1.3027], [36.8664, -1.3023], [36.866, -1.3023], [36.866, -1.3027]]] } };

describe('Menengai units at the Nairobi depot on the Movements report', () => {
  it('is at STO within 1 km of its point or of the depot geofence', () => {
    expect(atSto(AT_STO)).toBe(true);
    expect(atSto(TOWN)).toBe(false);
    const nearFence = { lat: -1.3023 + 0.0085, lng: 36.8662 };       // ~950 m north of the fence, ~1 km+ off the point
    expect(atSto(nearFence, fence)).toBe(true);
  });

  it('shows At STO in place of To/From MORL or Stopped; At MORL and silent units stay', () => {
    const out = withStoDirections({ groups: [{ name: 'Van Sales', rows: [
      row({ ...AT_STO }), row({ vehicleId: 'v2', state: 'stopped', ...AT_STO }), row({ vehicleId: 'v3', state: 'to', ...AT_STO }),
      row({ vehicleId: 'v4', state: 'at', ...MORL }), row({ vehicleId: 'v5', state: 'no-fix', ...AT_STO }), row({ vehicleId: 'v6' }),
    ] }] }, fence).groups[0].rows;
    expect(out.map((r) => r.state)).toEqual(['sto-at', 'sto-at', 'sto-at', 'at', 'no-fix', 'from']);
    const words = directionWords('MORL');
    expect(words['sto-at']).toBe('At STO');
    expect(statesFor(out[5]).map((s) => words[s])).toEqual(['To MORL', 'From MORL', 'At MORL', 'Stopped', 'At STO']);
    expect(statesFor({ state: 'from' }).map((s) => words[s])).toEqual(['To MORL', 'From MORL', 'At MORL', 'Stopped']);
    expect(countRows([{ rows: out }])['sto-at']).toBe(3);
  });
});
