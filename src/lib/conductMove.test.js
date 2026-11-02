import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/driverConduct', () => ({
  importCases: vi.fn(async (_org, cases) => ({ added: cases.length, cases })),
  importIncidents: vi.fn(async (_org, entries) => ({ added: entries.length, entries })),
}));

import { moveBrowserFollowUp } from './conductMove';
import { saveCases, loadCases } from './followUp';
import { saveEntries, loadEntries } from './operatorLog';
import { importCases, importIncidents } from '../api/driverConduct';

const kase = { id: 'KCK345G|2026-11-01', day: '2026-11-01', unitKey: 'KCK345G', openedAt: 1, status: 'done', action: 'Driver called' };
const entry = { id: 'oi-1', kind: 'phone', at: 1_793_500_000_000, plate: 'KBT 114R', vehicleId: 'v1' };

describe('moving what a browser kept to the server', () => {
  beforeEach(() => {
    // No browser here: a stand-in storage, as lib/followUp's tests use
    const m = new Map();
    globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
    vi.clearAllMocks();
  });

  it('sends the cases and entries, then forgets this browser\'s copy', async () => {
    saveCases('org1', [kase]);
    saveEntries('org1', [entry]);
    expect(await moveBrowserFollowUp('org1')).toEqual({ cases: 1, entries: 1 });
    expect(importCases).toHaveBeenCalledWith('org1', [kase]);
    expect(importIncidents).toHaveBeenCalledWith('org1', [expect.objectContaining({ id: 'oi-1', kind: 'phone' })]);
    expect(loadCases('org1')).toEqual([]);
    expect(loadEntries('org1')).toEqual([]);
  });

  it('with nothing kept, sends nothing', async () => {
    expect(await moveBrowserFollowUp('org1')).toEqual({ cases: 0, entries: 0 });
    expect(importCases).not.toHaveBeenCalled();
  });

  it('keeps this browser\'s copy when the server does not take it, to try again', async () => {
    saveCases('org1', [kase]);
    importCases.mockRejectedValueOnce(new Error('offline'));
    await expect(moveBrowserFollowUp('org1')).rejects.toThrow('offline');
    expect(loadCases('org1')).toHaveLength(1);
  });
});
