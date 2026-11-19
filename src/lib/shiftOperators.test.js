import { describe, it, expect } from 'vitest';
import { shiftOperators, operatorName } from './shiftOperators';

const NOW = Date.parse('2026-11-19T09:00:00Z'); // 12:00 in Nairobi
const line = (o) => ({
  vehicleId: 'v1', machine: 'FTT 11', activity: 'Cane haulage', workLocation: 'Zone 4',
  shiftFrom: '2026-11-19T03:00:00Z', shiftTo: '2026-11-19T13:00:00Z',
  operator: 'EMMANUEL VICENT MTULO - TRUCK DRIVER', secondOperator: null, thirdOperator: null, ...o,
});
const plans = (status, lines) => ({ plans: [{ planCode: 'WP-261119-ROA', status, lines }] });

describe('shiftOperators', () => {
  it('names the operators on the approved line covering now, without their role', () => {
    const got = shiftOperators(plans('APPROVED', [line({ secondOperator: 'JOHN DOE - TURNBOY' })]), 'v1', NOW);
    expect(got).toMatchObject({ names: ['EMMANUEL VICENT MTULO', 'JOHN DOE'], shift: '06:00–16:00', planCode: 'WP-261119-ROA', workLocation: 'Zone 4' });
  });

  it('is null off shift, on a plan awaiting approval or cancelled, or for another unit', () => {
    expect(shiftOperators(plans('APPROVED', [line({ shiftFrom: '2026-11-19T14:00:00Z', shiftTo: '2026-11-19T20:00:00Z' })]), 'v1', NOW)).toBeNull();
    expect(shiftOperators(plans('SUBMITTED', [line()]), 'v1', NOW)).toBeNull();
    expect(shiftOperators(plans('CANCELLED', [line()]), 'v1', NOW)).toBeNull();
    expect(shiftOperators(plans('APPROVED', [line()]), 'v2', NOW)).toBeNull();
    expect(shiftOperators(null, 'v1', NOW)).toBeNull();
  });

  it('is null when the line names nobody', () => {
    expect(shiftOperators(plans('APPROVED', [line({ operator: '' })]), 'v1', NOW)).toBeNull();
  });

  it('reads a name without a role as it is', () => {
    expect(operatorName('  MARY  ANNE ')).toBe('MARY ANNE');
  });
});

describe('withPlanDrivers', () => {
  const data = plans('APPROVED', [line(), line({ vehicleId: 'v2', operator: 'MARY ANNE - DRIVER' })]);

  it('fills in the driver of units with none, as any driver reads, and marks it from the work plan', async () => {
    const { withPlanDrivers, linesByVehicle } = await import('./shiftOperators');
    const fleet = [{ vehicleId: 'v1', driver: 'Unassigned' }, { vehicleId: 'v2', driver: null }, { vehicleId: 'v3', driver: null }];
    const out = withPlanDrivers(fleet, linesByVehicle(data), NOW);
    expect(out[0]).toMatchObject({ driver: 'EMMANUEL VICENT MTULO', driverSource: 'work-plan', planShift: { shift: '06:00–16:00' } });
    expect(out[1].driver).toBe('MARY ANNE');
    expect(out[2]).toBe(fleet[2]);
  });

  it("keeps a unit's own driver, and returns the same fleet when nothing changes", async () => {
    const { withPlanDrivers, linesByVehicle } = await import('./shiftOperators');
    const own = [{ vehicleId: 'v1', driver: 'JANE DOE' }];
    expect(withPlanDrivers(own, linesByVehicle(data), NOW)).toBe(own);
    const offShift = [{ vehicleId: 'v1', driver: null }];
    expect(withPlanDrivers(offShift, linesByVehicle(data), Date.parse('2026-11-19T20:00:00Z'))).toBe(offShift);
    expect(withPlanDrivers(offShift, null, NOW)).toBe(offShift);
  });
});
