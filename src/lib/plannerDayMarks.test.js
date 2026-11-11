import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stopsForDays, setDayMark, readMarks, shortDay } from './plannerDayMarks';

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

describe('the marks kept in this browser', () => {
  // vitest runs in node here: a small in-memory localStorage, as navMemory.test does
  beforeEach(() => {
    const m = new Map();
    globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  });
  afterEach(() => { delete globalThis.localStorage; });
  it('marks, moves and clears a stop', () => {
    setDayMark('org1', 'p1', 's1', '2026-11-11');
    setDayMark('org1', 'p1', 's2', '2026-11-11');
    expect(readMarks('org1')).toEqual({ p1: { s1: '2026-11-11', s2: '2026-11-11' } });
    setDayMark('org1', 'p1', 's1', '2026-11-12');
    expect(readMarks('org1').p1.s1).toBe('2026-11-12');
    setDayMark('org1', 'p1', 's1', null);
    setDayMark('org1', 'p1', 's2', null);
    expect(readMarks('org1')).toEqual({});
    expect(readMarks('org2')).toEqual({});
  });
});
