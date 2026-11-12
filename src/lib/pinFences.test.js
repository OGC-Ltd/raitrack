import { describe, it, expect } from 'vitest';
import { pinFencePlan, drawPinFences, pinName, readNamedPaste, FENCE_RADIUS_M } from './pinFences';

const circle = (name, lat, lng, radiusM = 100) => ({
  name, feature: { type: 'Feature', properties: { name, radiusM }, geometry: { type: 'Point', coordinates: [lng, lat] } },
});
const customers = [
  circle('MENENGAI_VS: JOJAC INVESTMENTS', -0.28, 36.04),
  circle('Kamau Stores', 0.01075, 37.07514),
  circle('RAFIKI', -1.0, 37.0),
];

describe('points on the Deliveries list become geofences (operator, 13 Nov 2026)', () => {
  it('a point with no fence gets a 100 m circle named after the customer', () => {
    const { use, draw } = pinFencePlan([{ name: 'MAGUNA ANDU', lat: -0.0951, lng: 36.1271 }], customers);
    expect(use).toEqual([]);
    expect(draw).toEqual([{ pin: { name: 'MAGUNA ANDU', lat: -0.0951, lng: 36.1271 },
      body: { name: 'MAGUNA ANDU', type: 'CIRCLE', mode: 'ALLOWLIST', purpose: 'shop', centerLat: -0.0951, centerLng: 36.1271, radiusM: FENCE_RADIUS_M } }]);
  });

  it('the radius typed beside the box is the fence’s, held to 10 m – 5 km', () => {
    expect(pinFencePlan([{ name: 'A', lat: 1, lng: 36, radiusM: 250 }], []).draw[0].body.radiusM).toBe(250);
    expect(pinFencePlan([{ name: 'A', lat: 1, lng: 36, radiusM: 2 }], []).draw[0].body.radiusM).toBe(10);
    expect(pinFencePlan([{ name: 'A', lat: 1, lng: 36, radiusM: 90000 }], []).draw[0].body.radiusM).toBe(5000);
  });

  it('a fence of the same name at the same place is taken, not drawn again; by the short name too', () => {
    const { use, draw } = pinFencePlan([
      { name: 'JOJAC INVESTMENTS', lat: -0.2805, lng: 36.0405 },
      { name: 'kamau  stores', lat: 0.0108, lng: 37.0752 },
    ], customers);
    expect(use).toEqual(['MENENGAI_VS: JOJAC INVESTMENTS', 'Kamau Stores']);
    expect(draw).toEqual([]);
  });

  it('a fence of the same name far away is another place: a new fence, numbered so a pick by name is this one', () => {
    const { use, draw } = pinFencePlan([
      { name: 'RAFIKI', lat: -0.3, lng: 36.07 },
      { name: 'RAFIKI', lat: -0.5, lng: 36.2 },
    ], customers);
    expect(use).toEqual([]);
    expect(draw.map((d) => d.body.name)).toEqual(['RAFIKI (2)', 'RAFIKI (3)']);
  });

  it('a point fenced in the Planner takes that fence', () => {
    const fenced = new Map([['PIN:-0.30000,36.07000', 'Kamau Stores']]);
    const { use, draw } = pinFencePlan([{ name: '', lat: -0.3, lng: 36.07 }], customers, fenced);
    expect(use).toEqual(['Kamau Stores']);
    expect(draw).toEqual([]);
  });

  it('a point with no name is never fenced (operator, 13 Nov 2026); a point without numbers is left out', () => {
    expect(pinName({ name: '  ', lat: -0.288021, lng: 36.044943 })).toBe('');
    const bare = { name: '', lat: -0.288021, lng: 36.044943 };
    const { use, draw, unnamed } = pinFencePlan([bare, { name: 'x', lat: null, lng: 36 }, { name: 'Duka', lat: 1, lng: 36 }], []);
    expect(use).toEqual([]);
    expect(draw.map((d) => d.body.name)).toEqual(['Duka']);
    expect(unnamed).toEqual([bare]);
  });

  it('an unnamed point fenced in the Planner still takes that fence: nothing is drawn', () => {
    const fenced = new Map([['PIN:0.01075,37.07514', 'Kamau Stores']]);
    const r = pinFencePlan([{ name: '', lat: 0.0107497, lng: 37.0751401 }], customers, fenced);
    expect(r).toEqual({ use: ['Kamau Stores'], draw: [], unnamed: [] });
  });

  it('draws one after another; a failure keeps that point and the rest are still drawn', async () => {
    const { draw } = pinFencePlan([{ name: 'A', lat: 1, lng: 36 }, { name: 'B', lat: 2, lng: 36 }, { name: 'C', lat: 3, lng: 36 }], []);
    const made = [];
    const r = await drawPinFences(draw, async (body) => {
      if (body.name === 'B') throw new Error('Forbidden');
      made.push(body.name);
      return { id: body.name.toLowerCase(), name: body.name };
    });
    expect(made).toEqual(['A', 'C']);
    expect(r).toEqual({ names: ['A', 'C'], kept: [{ name: 'B', lat: 2, lng: 36 }], error: 'Forbidden' });
  });

  it('a pasted coordinates line needs the customer’s name: without one it waits in the box', () => {
    const r = readNamedPaste(['Naivas Nakuru, -0.28802, 36.04494', '-0.3, 36.07', 'JOJAC INVESTMENTS', 'https://maps.google.com/?q=-0.5,36.1', '', ''].join('\n'), 100);
    expect(r.pins).toEqual([{ name: 'Naivas Nakuru', lat: -0.28802, lng: 36.04494, radiusM: 100 }]);
    expect(r.bad).toEqual(['JOJAC INVESTMENTS']);
    expect(r.nameless).toEqual(['-0.3, 36.07', 'https://maps.google.com/?q=-0.5,36.1']);
  });
});
