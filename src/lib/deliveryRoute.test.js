import { describe, it, expect } from 'vitest';
import { routePlanFor, routeWords } from './deliveryRoute';

const plan = (over = {}) => ({ id: 'p1', vehicleId: 'v1', plate: 'KDE 141E', planDate: '2026-11-12', stopCount: 6, ...over });

describe('routePlanFor', () => {
  it('finds the unit by its vehicle id', () => {
    expect(routePlanFor([plan()], { id: 'KDE 141E', vehicleId: 'v1' })?.id).toBe('p1');
  });

  it('falls back to the plate, however the unit names it', () => {
    expect(routePlanFor([plan({ vehicleId: null })], { id: 'Menengai - KDE141E', vehicleId: 'v9' })?.id).toBe('p1');
  });

  it('a plan with no stops, another unit, or no plans is not a route', () => {
    expect(routePlanFor([plan({ stopCount: 0 })], { id: 'KDE 141E', vehicleId: 'v1' })).toBe(null);
    expect(routePlanFor([plan()], { id: 'KAX 536U', vehicleId: 'v2' })).toBe(null);
    expect(routePlanFor([], { id: 'KDE 141E', vehicleId: 'v1' })).toBe(null);
    expect(routePlanFor(null, { id: 'KDE 141E' })).toBe(null);
  });
});

describe('routeWords', () => {
  it('counts the stops', () => {
    expect(routeWords(plan())).toBe("on today's delivery route (6 stops)");
    expect(routeWords(plan({ stopCount: 1 }))).toBe("on today's delivery route (1 stop)");
  });
});
