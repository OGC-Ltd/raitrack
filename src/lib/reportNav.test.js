import { describe, it, expect } from 'vitest';
import { REPORT_NODES, reportKeysFor, firstReport } from './reportNav';

describe('the reports menu', () => {
  it('lists the reports A–Z by name', () => {
    const labels = REPORT_NODES.map((n) => n.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(labels[0]).toBe('Driver conduct');
  });

  it('still opens on Shift, where the grants allow it', () => {
    expect(firstReport(reportKeysFor(() => true))).toBe('shift');
    expect(firstReport(reportKeysFor((g) => g !== 'weighbridge:read'))).toBe(reportKeysFor(() => false)[0]);
  });
});
