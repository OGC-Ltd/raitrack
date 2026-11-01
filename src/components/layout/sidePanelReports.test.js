import { describe, it, expect } from 'vitest';
import { withReports } from './SidePanel';

const keys = (items) => items.map((i) => i.key);

describe('the Reports group in the sidebar', () => {
  it('sits between Workshop and Weighbridges', () => {
    const rows = withReports([{ key: 'maintenance' }, { key: 'workshop' }, { key: 'weighbridges' }]);
    expect(keys(rows)).toEqual(['maintenance', 'workshop', 'reports', 'weighbridges']);
  });
  it('sits just above Weighbridges when Workshop is not shown', () => {
    expect(keys(withReports([{ key: 'analytics' }, { key: 'weighbridges' }]))).toEqual(['analytics', 'reports', 'weighbridges']);
  });
  it('goes last when Weighbridges is not in the list', () => {
    expect(keys(withReports([{ key: 'workshop' }]))).toEqual(['workshop', 'reports']);
  });
});
