import { describe, it, expect } from 'vitest';
import { matchUnits } from './UnitPicker';

const fleet = [
  { id: 'KTCC 872B', name: 'Mahindra 9200 4WD KTCC 872B', vehicleType: 'TRACTOR' },
  { id: 'KTCC 101', name: 'John Deere', vehicleType: 'TRACTOR' },
  { id: 'MUFINDI - EX 14', name: 'Excavator', machineName: 'Excavator', vehicleType: 'TRUCK' },
  { id: 'KBU 872X', name: 'Isuzu FVZ', vehicleType: 'TRUCK' },
];
const plates = (q) => matchUnits(fleet, q).map((v) => v.id);

describe('matchUnits', () => {
  it('ignores spaces and case', () => {
    expect(plates('ktcc872b')).toEqual(['KTCC 872B']);
  });
  it('puts plates that start with the query first, then plates that contain it', () => {
    expect(plates('872')).toEqual(['KBU 872X', 'KTCC 872B'].sort((a, b) => a.localeCompare(b)));
    expect(plates('ktcc')).toEqual(['KTCC 101', 'KTCC 872B']);
  });
  it('finds a unit by its name or machine', () => {
    expect(plates('mahindra')).toEqual(['KTCC 872B']);
    expect(plates('excavator')).toEqual(['MUFINDI - EX 14']);
  });
  it('lists the whole fleet A–Z with nothing typed', () => {
    expect(plates('')).toEqual(['KBU 872X', 'KTCC 101', 'KTCC 872B', 'MUFINDI - EX 14']);
  });
});
