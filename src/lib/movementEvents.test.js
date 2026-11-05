import { describe, it, expect } from 'vitest';
import { EVENTS, pickedEvents, countByUnit, countCell, eventsFor, eventCells, eventNotes, FREEWHEEL_NOTE } from './movementEvents';
import { movementDoc } from './movementDoc';
import { textMm } from './shiftDoc';

const T = Date.parse('2026-11-05T08:30:00+03:00');
const at = (m) => T + m * 60_000;
const row = (vehicleId, plate) => ({ vehicleId, plate, grouping: plate, lastAt: at(0), lat: 0, lng: 0, location: 'Nakuru', speedKmh: 40, state: 'to', stale: false });
const stop = { vehicleId: 'v1', plate: 'KDE 136E', kind: 'stop', at: at(10), lat: 1, lng: 2, place: 'Gilgil', speedKmh: 0, source: 'tracker', minutes: 45 };
const brake = { vehicleId: 'v1', plate: 'KDE 136E', kind: 'braking', at: at(5), lat: 1, lng: 2, place: 'Naivasha', speedKmh: 38.4, source: 'tracker' };
const turn = { vehicleId: 'v2', plate: 'KDE 127E', kind: 'cornering', at: at(20), lat: null, lng: null, place: null, speedKmh: null, source: 'camera' };

describe('the events picked', () => {
  it('keeps the report’s order, whatever order they were ticked in', () => {
    expect(pickedEvents(['stop', 'freewheel']).map((e) => e.key)).toEqual(['freewheel', 'stop']);
  });
  it('counts a unit’s events by kind, a dash for none', () => {
    const counts = countByUnit([stop, brake, { ...brake, at: at(6) }]);
    expect(countCell(counts, 'v1', 'braking')).toBe(2);
    expect(countCell(counts, 'v1', 'stop')).toBe(1);
    expect(countCell(counts, 'v1', 'cornering')).toBe('-');
    expect(countCell(counts, 'v9', 'stop')).toBe('-');
  });
  it('lists only the kinds picked and the units still in the report, in time order', () => {
    expect(eventsFor([stop, brake, turn], [row('v1', 'KDE 136E')], ['stop', 'braking'])).toEqual([brake, stop]);
    expect(eventsFor([stop, brake], [row('v1', 'KDE 136E')], ['stop'])).toEqual([stop]);
    expect(eventsFor([stop], [row('v2', 'KDE 127E')], ['stop'])).toEqual([]);
  });
  it('writes a line for each kind of event', () => {
    expect(eventCells(brake).slice(0, 2)).toEqual(['KDE 136E', 'Harsh stops']);
    expect(eventCells(brake)[4]).toBe('38 km/h');
    expect(eventCells(stop)[4]).toBe('45 min');
    expect(eventCells({ ...stop, ongoing: true })[4]).toBe('45 min, still there');
    expect(eventCells({ ...stop, before: true })[2]).toMatch(/^Before /);
    expect(eventCells(turn).slice(3)).toEqual(['-', '-', 'Camera']);
  });
  it('says a free-wheeling zero proves nothing, and only then', () => {
    expect(eventNotes([], ['freewheel'])).toEqual([FREEWHEEL_NOTE]);
    expect(eventNotes([{ kind: 'freewheel' }], ['freewheel'])).toEqual([]);
    expect(eventNotes([], ['stop'], ['A', 'A'])).toEqual(['A']);
  });
});

describe('the events on the document', () => {
  const request = { hours: 4, from: at(-60), to: at(180), morl: 'MORL', site: 'MORL', groups: [{ name: 'Van Sales', rows: [row('v1', 'KDE 136E')] }] };
  const opts = { organisation: 'Menengai', orgCode: 'MENENGAI' };
  const tables = (d) => d.blocks.filter((b) => b.kind === 'table');
  it('is as it was with nothing picked', () => {
    const d = movementDoc([request], opts);
    expect(tables(d)).toHaveLength(1);
    expect(tables(d)[0].head).toEqual(['Grouping', 'Last coordinates', 'Location', 'Speed', 'Direction']);
    expect(d.blocks.some((b) => b.title?.includes('Events'))).toBe(false);
  });
  it('never cuts a heading: each fits its column whole, on one line as the PDF prints it', () => {
    const d = movementDoc([request], { ...opts, events: { kinds: EVENTS.map((e) => e.key), list: [stop, brake, turn] } });
    const pageMm = 184;
    for (const t of tables(d)) {
      t.cols.forEach((c, i) => { if (c.w) expect(textMm(t.head[i], 7.2, true) + 3.8, t.head[i]).toBeLessThanOrEqual(c.w); });
      expect(t.cols.reduce((n, c) => n + c.w, 0)).toBeLessThan(pageMm);
    }
    expect(EVENTS.map((e) => e.label)).toEqual(['Free-wheeling', 'Harsh cornering', 'Harsh stops', 'Harsh acceleration', 'Stops over 10 min']);
  });
  it('leaves the sheet’s columns as they were, the counts in a table of their own, then the list', () => {
    const d = movementDoc([request], { ...opts, events: { kinds: ['stop', 'braking'], list: [stop, brake, turn] } });
    const [sheet, counted, list] = tables(d);
    expect(sheet.head).toEqual(['Grouping', 'Last coordinates', 'Location', 'Speed', 'Direction']);
    expect(counted.head).toEqual(['Unit', 'Harsh stops', 'Stops over 10 min']);
    expect(counted.rows.map((r) => r.map((c) => c.text))).toEqual([['KDE 136E', '1', '1']]);
    expect(d.blocks.find((b) => b.title === '3. Events')).toMatchObject({ aside: '2 events' });
    expect(list.rows.map((r) => r[1].text)).toEqual(['Harsh stops', 'Stops over 10 min']);
  });
  it('says so when none of the kinds picked happened', () => {
    const d = movementDoc([request], { ...opts, events: { kinds: ['stop'], list: [] } });
    expect(d.blocks.find((b) => b.kind === 'none').text).toBe('None of the events picked in this window.');
  });
  it('leaves out a unit taken off the report', () => {
    const gone = { ...request, groups: [{ name: 'Van Sales', rows: [row('v2', 'KDE 127E')] }] };
    expect(tables(movementDoc([gone], { ...opts, events: { kinds: ['stop'], list: [stop] } }))).toHaveLength(1);
  });
  it('takes each day’s events from its own window', () => {
    const next = { ...request, from: at(1380), to: at(1620) };
    const d = movementDoc([request, next], { ...opts, events: { kinds: ['stop'], list: [stop] } });
    expect(tables(d).map((t) => t.rows.length)).toEqual([1, 1, 1, 1]);
    expect(d.blocks.filter((b) => b.kind === 'none').map((b) => b.text)).toEqual(['None of the events picked in this window.']);
  });
});
