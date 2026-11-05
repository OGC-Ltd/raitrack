import { describe, it, expect, beforeEach } from 'vitest';
import { loadOrders, saveOrder, ORDERS_KEEP_DAYS } from './deliveryPlan';

describe('Deliveries: orders fulfilled typed by hand are kept for the next report', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* no storage in this run */ } });
  it('keeps the last value per plate, forgets a cleared one and old ones', () => {
    const now = Date.parse('2026-11-05T09:00:00+03:00');
    saveOrder('MENENGAI', 'KDE 127E', '8/10', now);
    saveOrder('MENENGAI', 'KCP 136P', ' 6/8 ', now);
    saveOrder('MENENGAI', 'KDE 127E', '9/10', now + 1000);
    expect(loadOrders('menengai', now + 2000)).toEqual({ 'KDE 127E': '9/10', 'KCP 136P': '6/8' });
    saveOrder('MENENGAI', 'KCP 136P', '', now + 3000);
    expect(loadOrders('MENENGAI', now + 4000)).toEqual({ 'KDE 127E': '9/10' });
    expect(loadOrders('MENENGAI', now + (ORDERS_KEEP_DAYS + 1) * 86_400_000)).toEqual({});
    expect(loadOrders('SUKARI', now)).toEqual({});
  });
});

describe('Deliveries: a unit reported under another group for the day', async () => {
  const { addVehicle, setVehicleGroup, emptyPlan } = await import('./deliveryPlan');
  it('keeps the group picked, and forgets it when put back under its own', () => {
    let plan = addVehicle(emptyPlan(), { key: 'KDE127E', plate: 'KDE 127E', vehicles: [{ vehicleId: 'v1' }] });
    plan = setVehicleGroup(plan, 'KDE127E', 'Finished Goods');
    expect(plan.vehicles[0].group).toBe('Finished Goods');
    plan = setVehicleGroup(plan, 'KDE127E', null);
    expect('group' in plan.vehicles[0]).toBe(false);
  });
});
