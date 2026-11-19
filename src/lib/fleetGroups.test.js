import { describe, it, expect } from 'vitest';
import { machineKey, unitKey, vehicleKeys } from './fleetGroups';

describe('a machine named in full matches the list\'s short name', () => {
  it('reads wheel loaders, forklifts, excavators and JCBs as the MORL FLEET sheet names them', () => {
    expect(machineKey('WL - RAIMDF - WLOADER 01')).toBe(unitKey('WL 01'));
    expect(machineKey('WL - RAIMDF - WLOADER02')).toBe(unitKey('WL 02'));
    expect(machineKey('FL - RAIMDF - FORKLIFT 04')).toBe(unitKey('FL 04'));
    expect(machineKey('CIVIL - Menengai - EXCAVATOR001')).toBe(unitKey('EX 01'));
    expect(machineKey('CIVIL - Menengai - EXCAVATOR 002')).toBe(unitKey('EX 02'));
    expect(machineKey('LOGYARD - Menengai - JCB 1 H00052413')).toBe(unitKey('JCB 01'));
  });

  it('leaves everything else alone', () => {
    expect(machineKey('TR - RAIMDF - TRACTOR 02')).toBeNull();
    expect(machineKey('CPO - Menengai - KCK 345G')).toBeNull();
    expect(machineKey('MORL FARM EQUIPMENT - GENSET TEACHERS')).toBeNull();
  });

  it('is among the keys a unit may be listed under', () => {
    expect(vehicleKeys({ name: 'WL - RAIMDF - WLOADER 03' }).has(unitKey('WL 03'))).toBe(true);
  });
});

describe('reportGroupsFor', () => {
  it("shows Menengai's Equipment and Farm Equipment as one group, MORL Farm and Equipment, in the Equipment's place", async () => {
    const { groupsFor, reportGroupsFor } = await import('./fleetGroups');
    const plain = groupsFor('MENENGAI').map((g) => g.name);
    const merged = reportGroupsFor('MENENGAI');
    const names = merged.map((g) => g.name);
    expect(names).not.toContain('Equipment');
    expect(names).not.toContain('Farm Equipment');
    expect(names.indexOf('MORL Farm and Equipment')).toBe(plain.indexOf('Equipment'));
    const both = groupsFor('MENENGAI').filter((g) => g.name === 'Equipment' || g.name === 'Farm Equipment').flatMap((g) => g.units);
    expect(merged.find((g) => g.name === 'MORL Farm and Equipment').units).toEqual(both);
    expect(names).toHaveLength(plain.length - 1);
  });

  it('leaves the plain groups (geofence rules, access) and other organisations alone', async () => {
    const { groupsFor, reportGroupsFor } = await import('./fleetGroups');
    expect(groupsFor('MENENGAI').map((g) => g.name)).toEqual(expect.arrayContaining(['Equipment', 'Farm Equipment']));
    expect(reportGroupsFor('KASULU')).toEqual(groupsFor('KASULU'));
  });
});
