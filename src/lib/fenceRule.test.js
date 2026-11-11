import { describe, it, expect } from 'vitest';
import { blankRule, fleetVehicleIds, ruleOf, rulePayload, ruleProblem, ruleWords, vehicleTypesOf } from './fenceRule';
import { exitRows, rowLabel, zoneIdOf } from './geofenceExits';

const units = [
  { vehicleId: 'v1', id: 'CPO - KCN 901F', name: 'CPO - KCN 901F', vehicleType: 'TANKER' },
  { vehicleId: 'v2', id: 'CPO - KCN 901F-CAMERA', name: 'CPO - KCN 901F-CAMERA', vehicleType: 'TANKER' },
  { vehicleId: 'v3', id: 'KBT 112R', name: 'KBT 112R', vehicleType: 'lorry' },
  { vehicleId: 'v4', id: 'KCT 507W', name: 'KCT 507W', vehicleType: null },
];

describe('a geofence rule on the form', () => {
  it('says the rule in one sentence', () => {
    expect(ruleWords({ ...blankRule(), fleets: ['Tankers'], vehicleIds: ['v1'] })).toBe('Tankers must not enter. Raise a no-go alert.');
    expect(ruleWords(blankRule())).toBe('No unit may enter. Raise a no-go alert.');
    expect(ruleWords({ ...blankRule(), trigger: 'inside', vehicleTypes: ['TANKER'], hours: { from: '18:00', to: '06:00' }, alert: { type: 'nogo', severity: 'warning' } }))
      .toBe('TANKER units must not be inside between 18:00 and 06:00. Raise a no-go alert (warning).');
  });

  it('turns a fleet into its units, both trackers on a truck', () => {
    expect(fleetVehicleIds(units, 'MENENGAI', ['Tankers'])).toEqual(['v1', 'v2', 'v4']);
    expect(fleetVehicleIds(units, 'SUKARI', ['Tankers'])).toEqual([]);
  });

  it('sends the fleets as unit ids, and classes in capitals', () => {
    const p = rulePayload({ ...blankRule(), fleets: ['Tankers'], vehicleTypes: ['lorry'] }, { vehicles: units, orgCode: 'MENENGAI' });
    expect(p).toEqual({
      trigger: 'enter', vehicleTypes: ['LORRY'], fleets: ['Tankers'], vehicleIds: ['v1', 'v2', 'v4'], hours: null,
      alert: { type: 'nogo', severity: 'critical' },
    });
    expect(rulePayload(null)).toBeNull();
  });

  it('keeps the saved units while the live list cannot be read', () => {
    const saved = ruleOf({ fleets: ['Tankers'], vehicleIds: ['v9'] });
    expect(rulePayload(saved, { vehicles: [], orgCode: 'MENENGAI' }).vehicleIds).toEqual(['v9']);
  });

  it('says what stops a save', () => {
    expect(ruleProblem({ ...blankRule(), hours: { from: '06:00', to: '06:00' } })).toMatch(/same time/);
    expect(ruleProblem({ ...blankRule(), fleets: ['Tankers'], vehicleIds: [] })).toMatch(/fleets/);
    expect(ruleProblem(blankRule())).toBeNull();
    expect(ruleProblem(null)).toBeNull();
  });

  it('lists the vehicle classes, most units first', () => {
    expect(vehicleTypesOf(units)).toEqual([{ type: 'TANKER', n: 2 }, { type: 'LORRY', n: 1 }]);
  });

  it('reads a stored rule back, and nothing as no rule', () => {
    expect(ruleOf(null)).toBeNull();
    expect(ruleOf({ trigger: 'inside', alert: { severity: 'warning' } })).toMatchObject({ trigger: 'inside', alert: { severity: 'warning' }, fleets: [] });
  });
});

describe('no-go alerts among the geofence exits', () => {
  it('finds the geofence in a rule alert id', () => {
    expect(zoneIdOf('fr-cmveh123-cmzone456-1762840000000')).toBe('cmzone456');
    expect(zoneIdOf('zn-cmveh123-cmzone456-o-1762840000000')).toBe('cmzone456');
  });

  it('marks a no-go row as one', () => {
    const [row] = exitRows([{ orgId: 'o', items: [{ id: 'fr-v-z-1', alertType: 'NOGO_ZONE', ts: '2026-11-11T06:00:00Z', plate: 'KCT 507W', text: 'KCT 507W entered X.' }] }]);
    expect(row).toMatchObject({ nogo: true, zoneId: 'z' });
    expect(rowLabel(row)).toBe('No-go zone');
  });
});
