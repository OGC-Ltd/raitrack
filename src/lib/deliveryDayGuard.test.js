import { describe, it, expect, vi, beforeEach } from 'vitest';
import { editDayOf, emptiesDay } from './deliveryPlan';

const apiFetch = vi.fn();
vi.mock('../services/api', () => ({ apiFetch: (...args) => apiFetch(...args) }));

// Operator, 20 Nov 2026: Menengai's 18 and 19 Nov Finished Goods lists were emptied from the
// 18 to 20 Nov range view, a ✕ at a time, and nothing could bring them back
describe('a day’s list is never emptied unasked', () => {
  it('asks only when a day that had vehicles would have none', () => {
    expect(emptiesDay(24, 0)).toBe(true);
    expect(emptiesDay(1, 0)).toBe(true);
    expect(emptiesDay(24, 23)).toBe(false);
    expect(emptiesDay(0, 0)).toBe(false);   // an empty day stays empty without a word
    expect(emptiesDay(0, 3)).toBe(false);
  });

  it('the save says the operator confirmed it, and only then', async () => {
    const { saveDeliveryDay } = await import('../api/deliveries');
    apiFetch.mockResolvedValue({ data: { day: '2026-11-18', vehicles: [] } });
    await saveDeliveryDay('org', '2026-11-18', []);
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ vehicles: [] });
    await saveDeliveryDay('org', '2026-11-18', [], { clear: true });
    expect(apiFetch.mock.calls[1][0]).toBe('/api/v1/organisations/org/deliveries/days/2026-11-18');
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ vehicles: [], clear: true });
  });
});

describe('the day new vehicles go on, while a range is open and none is picked', () => {
  beforeEach(() => apiFetch.mockReset());
  const range = ['2026-11-18', '2026-11-19', '2026-11-20'];
  it('today when the range holds it', () => {
    expect(editDayOf(range, '2026-11-20')).toBe('2026-11-20');
    expect(editDayOf(range, '2026-11-19')).toBe('2026-11-19');
  });
  it('else the range’s first day, never silently its last', () => {
    expect(editDayOf(range, '2026-11-25')).toBe('2026-11-18');
    expect(editDayOf(['2026-11-18'], '2026-11-25')).toBe('2026-11-18');
    expect(editDayOf([], '2026-11-25')).toBe('2026-11-25');
  });
});
