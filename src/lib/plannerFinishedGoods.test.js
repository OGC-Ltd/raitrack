import { describe, it, expect, vi, beforeEach } from 'vitest';

const plan = {
  id: 'p1', plate: 'KCA 226M', vehicleId: 'v1', planDate: '2026-11-11', sheetAt: null, source: 'manual', driverName: '',
  stops: [
    { id: 's1', sequence: 1, outcome: null, dueDay: null, customer: { id: 'c1', name: 'Dashama wholesalers', lat: -0.3, lng: 36.1, geofenceId: null } },
    { id: 's2', sequence: 2, outcome: null, dueDay: null, customer: { id: 'c2', name: 'Gitare wholesalers', lat: -0.9, lng: 36.5, geofenceId: null } },
  ],
};
vi.mock('../api/planner', () => ({ getPlan: vi.fn(async () => plan) }));
const loadPings = vi.fn(async () => ({ pings: new Map(), failed: [] }));
vi.mock('../api/fleetReports', () => ({ loadPings: (...a) => loadPings(...a) }));
vi.mock('../api/reports', () => ({ loadMovementReport: vi.fn(async () => { throw new Error('no movements'); }) }));

import { plannerFgRows, plannerFgDoc } from './plannerFinishedGoods';

const zones = { type: 'FeatureCollection', features: [] };
const at = Date.parse('2026-11-11T18:50:00Z');

beforeEach(() => loadPings.mockClear());

describe('the Planner printed as the Finished Goods report', () => {
  it('reads each plan as Deliveries reads a sheet: its truck over its own span, every stop counted', async () => {
    const rows = await plannerFgRows({ orgId: 'o', plans: [{ id: 'p1' }], vehicles: [{ vehicleId: 'v1', registrationPlate: 'KCA 226M' }], zones, at });
    expect(loadPings).toHaveBeenCalledOnce();
    expect(loadPings.mock.calls[0][0].vehicles).toEqual([{ vehicleId: 'v1' }]);
    // The plan's own span: its day start, a day back to find where the truck began, 48 h on (capped at now)
    const { from, to } = loadPings.mock.calls[0][0];
    expect(to - from).toBeLessThanOrEqual(3 * 86_400_000);
    expect(rows).toHaveLength(1);
    expect(rows[0].plate).toBe('KCA 226M');
    expect(rows[0].customers.map((c) => c.label ?? c.name)).toEqual(['Dashama wholesalers', 'Gitare wholesalers']);
  });

  it('each plan reads only its own trucks, over its own span', async () => {
    await plannerFgRows({ orgId: 'o', plans: [{ id: 'p1' }, { id: 'p1' }], vehicles: [{ vehicleId: 'v1', registrationPlate: 'KCA 226M' }], zones, at });
    expect(loadPings).toHaveBeenCalledTimes(2);
  });

  it('a plate no unit carries is still printed, with why, and Movements failing does not stop it', async () => {
    const doc = await plannerFgDoc({ orgId: 'o', plans: [{ id: 'p1' }], vehicles: [], zones, from: at - 12 * 3_600_000, at, fleet: 'Menengai Oil Refineries Ltd', orgCode: 'MENENGAI' });
    expect(loadPings).not.toHaveBeenCalled();
    expect(doc.title).toBe('DELIVERIES REPORT · FINISHED GOODS');
    const table = doc.blocks.find((b) => b.kind === 'table');
    expect(table.rows).toHaveLength(2);
    expect(table.rows.every((r) => r[0].fill === '#ff0000')).toBe(true);
  });
});
