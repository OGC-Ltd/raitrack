import { describe, it, expect } from 'vitest';
import { stopsForDays, marksOf, shortDay } from './plannerDayMarks';

const stops = [1, 2, 3, 4, 5].map((id) => ({ id }));
const ids = (r) => r.stops.map((s) => s.id);

describe('which stops a sheet counts on a day', () => {
  it('no marks: every stop, as before', () => {
    expect(stopsForDays(stops, {}, ['2026-11-11'])).toEqual({ stops, by: 'all' });
    expect(stopsForDays(stops, null, ['2026-11-11']).by).toBe('all');
  });
  it('stops marked for the day: only those', () => {
    const r = stopsForDays(stops, { 1: '2026-11-11', 2: '2026-11-11', 4: '2026-11-12' }, ['2026-11-11']);
    expect(r.by).toBe('marked');
    expect(ids(r)).toEqual([1, 2]);
  });
  it('day two with no marks of its own: the stops left over', () => {
    const r = stopsForDays(stops, { 1: '2026-11-11', 2: '2026-11-11' }, ['2026-11-12']);
    expect(r.by).toBe('rest');
    expect(ids(r)).toEqual([3, 4, 5]);
  });
  it('a report over two days takes the marks of both', () => {
    expect(ids(stopsForDays(stops, { 1: '2026-11-11', 5: '2026-11-12' }, ['2026-11-11', '2026-11-12']))).toEqual([1, 5]);
  });
  it('writes "11.11"', () => expect(shortDay('2026-11-11')).toBe('11.11'));
});

describe('the marks, from the stops on the server', () => {
  it('reads each stop dueDay; unmarked stops are left out', () => {
    const plan = { stops: [{ id: 's1', dueDay: '2026-11-11' }, { id: 's2', dueDay: null }, { id: 's3' }] };
    expect(marksOf(plan)).toEqual({ s1: '2026-11-11' });
    expect(marksOf(null)).toEqual({});
  });
});
