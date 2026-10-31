import { describe, it, expect } from 'vitest';
import { withShiftReport } from './SidePanel';

const keys = (items) => items.map((i) => i.key);

describe('the End of shift report row in the sidebar', () => {
  it('sits between Workshop and Weighbridges', () => {
    const rows = withShiftReport([{ key: 'maintenance' }, { key: 'workshop' }, { key: 'weighbridges' }]);
    expect(keys(rows)).toEqual(['maintenance', 'workshop', 'endOfShiftReport', 'weighbridges']);
  });
  it('sits just above Weighbridges when Workshop is not shown', () => {
    expect(keys(withShiftReport([{ key: 'analytics' }, { key: 'weighbridges' }]))).toEqual(['analytics', 'endOfShiftReport', 'weighbridges']);
  });
  it('goes last when Weighbridges is not in the list', () => {
    expect(keys(withShiftReport([{ key: 'workshop' }]))).toEqual(['workshop', 'endOfShiftReport']);
  });
});
