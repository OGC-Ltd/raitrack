import { describe, it, expect } from 'vitest';
import { plannedVs, inWindow, windowWords, onTimeCount, isItinerary, planCsvRows, ON_TIME_MS } from './plannerActual';

const at = (s) => Date.parse(`2026-11-11T${s}:00+03:00`);
const stop = (id, planned, win = ['04:00', '22:00']) => ({
  id, sequence: 1, plannedAt: planned ? new Date(at(planned)).toISOString() : null, windowFrom: win[0], windowTo: win[1],
  serviceMin: 60, legKm: 12.5, customer: { code: `WL:SHOP ${id}`, name: `SHOP ${id}`, location: '' }, invoiceNo: '',
});

describe('a Wialon itinerary stop against what the truck did', () => {
  it('says on time, late or early', () => {
    expect(plannedVs(stop('a', '07:13'), { at: at('07:20') })).toMatchObject({ words: 'On time', tone: 'ok', inWindow: true });
    expect(plannedVs(stop('a', '07:13'), { at: at('08:40') })).toMatchObject({ words: '1 h 27 min late', tone: 'warn' });
    expect(plannedVs(stop('a', '07:13'), { at: at('06:43') })).toMatchObject({ words: '30 min early', tone: 'ok' });
    expect(plannedVs(stop('a', '07:13'), {})).toMatchObject({ lateMs: null, words: null });
    expect(plannedVs(stop('a', null), { at: at('07:13') })).toBeNull();
    expect(ON_TIME_MS).toBe(15 * 60_000);
  });

  it('reads the delivery window in fleet time, overnight too', () => {
    expect(inWindow(stop('a', null, ['08:00', '23:59']), at('07:59'))).toBe(false);
    expect(inWindow(stop('a', null, ['22:00', '04:00']), at('23:30'))).toBe(true);
    expect(inWindow(stop('a', null, ['22:00', '04:00']), at('12:00'))).toBe(false);
    expect(inWindow(stop('a', null, [null, null]), at('12:00'))).toBeNull();
    expect(windowWords(stop('a', null))).toBe('04:00–22:00');
  });

  it('counts the stops reached on time', () => {
    const plan = { source: 'itinerary', stops: [stop('a', '07:00'), stop('b', '08:00'), stop('c', '09:00')] };
    const actual = { stops: [{ id: 'a', at: at('07:05') }, { id: 'b', at: at('09:00') }, { id: 'c', at: null }] };
    expect(isItinerary(plan)).toBe(true);
    expect(onTimeCount(plan, actual)).toEqual({ onTime: 1, judged: 2 });
  });

  it('adds the plan to the CSV, only for an itinerary', () => {
    const plan = { source: 'itinerary', stops: [{ ...stop('a', '07:00'), outcome: null, remarks: '' }] };
    const [head, row] = planCsvRows(plan, { stops: [{ id: 'a', at: at('07:40') }] });
    expect(head.slice(7, 10)).toEqual(['Planned arrival', 'Window', 'Against plan']);
    expect(row.slice(7, 10)).toEqual(['11.11.2026 07:00', '04:00–22:00', '40 min late']);
    expect(planCsvRows({ stops: [] }, null)[0]).not.toContain('Planned arrival');
  });
});
