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
