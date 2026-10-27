import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/api', () => ({ apiFetch: vi.fn(async () => ({ data: null })) }));

import { jobText, mineGroup } from './WorkshopScreen';

const job = {
  stage: 'remote_fix', faultCategory: 'fuel_probe', targetKind: 'probe', ticketNo: 'RT-2026-00011',
  suspectedFault: 'No readings since Tuesday', vehicle: { registrationPlate: 'MUFINDI: CTR 19' },
};

describe('the Jobs search', () => {
  it('reads the reg, ticket, fault, suspected fault and stage', () => {
    const text = jobText(job);
    for (const q of ['ctr 19', 'rt-2026-00011', 'fuel probe', 'tuesday']) expect(text).toContain(q);
  });

  it('is lower case, so a search matches whatever the case typed', () => {
    expect(jobText(job)).toBe(jobText(job).toLowerCase());
  });
});

describe("a technician's own jobs", () => {
  it('splits them into open, sent to the workshop, and closed', () => {
    expect(mineGroup({ stage: 'remote_fix', queue: 'controltech' })).toBe('open');
    expect(mineGroup({ stage: 'forwarded', queue: 'controltech' })).toBe('open');
    expect(mineGroup({ stage: 'awaiting_assessment', path: 'physical', queue: 'controltech' })).toBe('workshop');
    expect(mineGroup({ stage: 'fixing', queue: 'workshop' })).toBe('workshop');
    expect(mineGroup({ stage: 'fixed', resolvedAt: '2026-10-26T08:00:00Z', path: 'physical' })).toBe('closed');
  });
});
