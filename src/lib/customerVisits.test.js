import { describe, it, expect } from 'vitest';
import { customerVisits, customerLabel, isFgVs, VISIT_GAP_MS } from './customerVisits';

const t0 = Date.parse('2026-11-11T07:00:00+03:00');
const min = 60_000;
const at = (m, lat, lng, kmh = 30) => ({ t: t0 + m * min, lat, lng, speedKmh: kmh });
const pin = (name, lat, lng, radiusM = 50) => ({ name, label: name, kind: /_FG/.test(name) ? 'FG' : 'Geofence',
  feature: { type: 'Feature', properties: { name, radiusM }, geometry: { type: 'Point', coordinates: [lng, lat] } } });
const A = pin('menengai: Dashama wholesalers', -0.30, 36.10);
const B = pin('MENENGAI_FG: Quick Mart Nakuru', -0.32, 36.12);
const span = { from: t0 - 60 * min, to: t0 + 600 * min };

describe('the customers a unit went through (operator, 12 Nov 2026)', () => {
  it('names a customer without the Menengai prefix', () => {
    expect(customerLabel('menengai: Dashama wholesalers')).toBe('Dashama wholesalers');
    expect(customerLabel('MENENGAI_VS:DEVAM')).toBe('DEVAM');
  });
  it('a stop and a pass, latest first, with the time stood', () => {
    const pings = [at(0, -0.25, 36.05), at(10, -0.30, 36.10, 0), at(12, -0.30, 36.10, 0), at(15, -0.3001, 36.1001, 0), at(20, -0.31, 36.11),
      at(30, -0.3203, 36.12), at(31, -0.33, 36.13)];
    const v = customerVisits(pings, [A, B], span);
    expect(v.map((x) => x.label)).toEqual(['Quick Mart Nakuru', 'Dashama wholesalers']);
    expect(v[1]).toMatchObject({ enteredAt: t0 + 10 * min, leftAt: t0 + 20 * min, stoodMs: 5 * min });
    expect(v[0]).toMatchObject({ enteredAt: t0 + 30 * min, leftAt: t0 + 31 * min, stoodMs: 0, kind: 'FG' });
  });
  it('a drift out and back within the gap is one visit; a later return is another', () => {
    const away = { lat: -0.31, lng: 36.11 };
    const pings = [at(0, -0.30, 36.10, 0), at(5, away.lat, away.lng), at(8, -0.30, 36.10, 0), at(12, away.lat, away.lng),
      at(12 + VISIT_GAP_MS / min + 30, -0.30, 36.10, 0), at(12 + VISIT_GAP_MS / min + 40, away.lat, away.lng)];
    const v = customerVisits(pings, [A], span);
    expect(v).toHaveLength(2);
    expect(v[1]).toMatchObject({ enteredAt: t0, leftAt: t0 + 12 * min });
  });
  it('still there at the last reading', () => {
    expect(customerVisits([at(0, -0.25, 36.05), at(10, -0.30, 36.10, 0)], [A], span)[0].leftAt).toBeNull();
  });
  it('for Menengai\'s FG and VS units only', () => {
    expect(isFgVs({ name: 'FG - Menengai - KBY 594Q' })).toBe(true);
    expect(isFgVs({ name: 'CPO - Menengai - KCF 186A' })).toBe(false);
    expect(isFgVs({ name: 'WKS - KCY 523U' })).toBe(false);
  });
});

describe('MORL HQ among the customers (operator, 12 Nov 2026)', async () => {
  const { yardStays } = await import('./customerVisits');
  const { findStorages, MORL_POINT } = await import('./deliveriesReport');
  const storages = findStorages(null);
  const away = { lat: -0.20, lng: 35.90 };
  it('each stay at MORL, from the first reading there to the first away', () => {
    const pings = [at(0, MORL_POINT.lat, MORL_POINT.lng, 0), at(30, MORL_POINT.lat, MORL_POINT.lng, 0), at(45, away.lat, away.lng),
      at(300, away.lat, away.lng), at(360, MORL_POINT.lat, MORL_POINT.lng, 0), at(400, MORL_POINT.lat, MORL_POINT.lng, 0)];
    const s = yardStays(pings, storages, span);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ label: 'MORL HQ', home: true, enteredAt: t0 + 360 * min, leftAt: null });
    expect(s[1]).toMatchObject({ enteredAt: t0, leftAt: t0 + 45 * min });
  });
  it('none away from MORL', () => {
    expect(yardStays([at(0, away.lat, away.lng), at(10, -0.30, 36.10)], storages, span)).toEqual([]);
  });
});
