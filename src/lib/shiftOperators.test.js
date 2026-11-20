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
    expect(got).toMatchObject({ names: ['Emmanuel Vicent Mtulo', 'John Doe'], shift: '06:00–16:00', planCode: 'WP-261119-ROA', workLocation: 'Zone 4' });
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

  it('reads a name without a role, cased', () => {
    expect(operatorName('  MARY  ANNE ')).toBe('Mary Anne');
  });
});

describe('withPlanDrivers', () => {
  const data = plans('APPROVED', [line(), line({ vehicleId: 'v2', operator: 'MARY ANNE - DRIVER' })]);

  it('fills in the driver of units with none, as any driver reads, and marks it from the work plan', async () => {
    const { withPlanDrivers, linesByVehicle } = await import('./shiftOperators');
    const fleet = [{ vehicleId: 'v1', driver: 'Unassigned' }, { vehicleId: 'v2', driver: null }, { vehicleId: 'v3', driver: null }];
    const out = withPlanDrivers(fleet, linesByVehicle(data), NOW);
    expect(out[0]).toMatchObject({ driver: 'Emmanuel Vicent Mtulo', driverSource: 'work-plan', planShift: { shift: '06:00–16:00' } });
    expect(out[1].driver).toBe('Mary Anne');
    expect(out[2]).toBe(fleet[2]);
  });

  it("keeps a unit's own driver but still gives it the shift, and returns the same fleet when nothing changes", async () => {
    const { withPlanDrivers, linesByVehicle } = await import('./shiftOperators');
    const own = withPlanDrivers([{ vehicleId: 'v1', driver: 'JANE DOE' }], linesByVehicle(data), NOW);
    expect(own[0]).toMatchObject({ driver: 'JANE DOE', planShift: { shift: '06:00–16:00', workLocation: 'Zone 4' } });
    expect(own[0].driverSource).toBeUndefined();
    // 12 h after its only shift ended (13:00Z), the plan lets go of it
    const offShift = [{ vehicleId: 'v1', driver: null }];
    expect(withPlanDrivers(offShift, linesByVehicle(data), Date.parse('2026-11-20T01:30:00Z'))).toBe(offShift);
    expect(withPlanDrivers(offShift, null, NOW)).toBe(offShift);
  });

  it('gives the shift to a unit whose line names nobody, leaving it Unassigned', async () => {
    const { withPlanDrivers, linesByVehicle } = await import('./shiftOperators');
    const nobody = plans('APPROVED', [line({ operator: '' })]);
    const out = withPlanDrivers([{ vehicleId: 'v1', driver: 'Unassigned' }], linesByVehicle(nobody), NOW);
    expect(out[0]).toMatchObject({ driver: 'Unassigned', planShift: { names: [], activity: 'Cane haulage' } });
  });
});

describe('night shift past midnight', () => {
  it("yesterday's 18:00 shift still names its operator and location at 02:53 (EX 16, 20 Nov)", async () => {
    const { withPlanDrivers, linesByVehicle, eatYesterday } = await import('./shiftOperators');
    const at = Date.parse('2026-11-19T23:53:00Z'); // 02:53 on 20 Nov in Nairobi
    expect(eatYesterday(at)).toBe('2026-11-19');
    const yesterday = { plans: [{ planCode: 'WP-261119-IRR', status: 'APPROVED', lines: [line({
      machine: 'EX-16', workLocation: 'Reservoir', activity: 'Irrigation - Drainage Desilting',
      operator: 'FATMA HAMADI HASSAN - EXCAVATOR OPERATOR',
      shiftFrom: '2026-11-19T15:00:00Z', shiftTo: '2026-11-20T01:00:00Z',
    })] }] };
    const today = { plans: [{ planCode: 'WP-261120-IRR', status: 'APPROVED', lines: [line({
      machine: 'EX-16', workLocation: 'Reservoir', operator: 'EMMANUEL DANIEL',
      shiftFrom: '2026-11-20T03:00:00Z', shiftTo: '2026-11-20T12:00:00Z',
    })] }] };
    const byVehicle = linesByVehicle({ plans: [...yesterday.plans, ...today.plans] });
    const [v] = withPlanDrivers([{ vehicleId: 'v1', driver: 'Unassigned' }], byVehicle, at);
    expect(v).toMatchObject({ driver: 'Fatma Hamadi Hassan', planShift: { workLocation: 'Reservoir', shift: '18:00–04:00', planCode: 'WP-261119-IRR' } });
    // today's plan alone (what the app read before) misses the night shift:
    // it can only offer the 06:00 shift as next
    expect(withPlanDrivers([{ vehicleId: 'v1', driver: 'Unassigned' }], linesByVehicle(today), at)[0].planShift.when).toBe('next');
  });
});

describe('between shifts (operator 2026-11-20: never Unassigned)', () => {
  const lines = { plans: [{ planCode: 'WP-261120-IRR', status: 'APPROVED', lines: [
    line({ operator: 'EMMANUEL DANIEL', workLocation: 'Reservoir', shiftFrom: '2026-11-20T03:00:00Z', shiftTo: '2026-11-20T12:00:00Z' }),
    line({ operator: 'FATMA HAMADI HASSAN - EXCAVATOR OPERATOR', workLocation: 'Reservoir', shiftFrom: '2026-11-20T15:00:00Z', shiftTo: '2026-11-21T01:00:00Z' }),
  ] }] };
  const at = async (iso) => {
    const { withPlanDrivers, linesByVehicle } = await import('./shiftOperators');
    return withPlanDrivers([{ vehicleId: 'v1', driver: 'Unassigned' }], linesByVehicle(lines), Date.parse(iso))[0];
  };
  it('before the first shift: the next shift', async () => {
    expect(await at('2026-11-20T01:30:00Z')).toMatchObject({ driver: 'Emmanuel Daniel', planShift: { when: 'next', shift: '06:00–15:00' } });
  });
  it('on shift', async () => {
    expect(await at('2026-11-20T05:00:00Z')).toMatchObject({ driver: 'Emmanuel Daniel', planShift: { when: 'now' } });
  });
  it('between shifts: the next one', async () => {
    expect(await at('2026-11-20T13:00:00Z')).toMatchObject({ driver: 'Fatma Hamadi Hassan', planShift: { when: 'next', workLocation: 'Reservoir' } });
  });
  it('after the last shift: that one for 12 h, then nobody', async () => {
    expect(await at('2026-11-21T05:00:00Z')).toMatchObject({ driver: 'Fatma Hamadi Hassan', planShift: { when: 'last' } });
    expect((await at('2026-11-21T14:00:00Z')).driver).toBe('Unassigned');
  });
});

describe('operator names are cased like the Operators page (operator, 2026-11-20)', () => {
  it('a lowercase name from the plan reads with capitals', () => {
    expect(operatorName('george heneriko')).toBe('George Heneriko');
    expect(operatorName('GEORGE HENERIKO - EXCAVATOR OPERATOR')).toBe('George Heneriko');
  });
});
