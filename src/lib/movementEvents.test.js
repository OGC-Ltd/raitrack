import { describe, it, expect } from 'vitest';
import { EVENTS, pickedEvents, countByUnit, countCell, eventsFor, eventSections, eventNotes } from './movementEvents';
import { movementDoc } from './movementDoc';
import { textMm } from './shiftDoc';

const T = Date.parse('2026-11-05T08:30:00+03:00');
const at = (m) => T + m * 60_000;
const row = (vehicleId, plate) => ({ vehicleId, plate, grouping: plate, lastAt: at(0), lat: 0, lng: 0, location: 'Nakuru', speedKmh: 40, state: 'to', stale: false });
const stop = { vehicleId: 'v1', plate: 'KDE 136E', kind: 'stop', at: at(10), stoppedAt: at(10), leftAt: at(55), lat: 1, lng: 2, place: 'Gilgil', speedKmh: 62, source: 'tracker', minutes: 45 };
const brake = { vehicleId: 'v1', plate: 'KDE 136E', kind: 'braking', at: at(5), lat: 1, lng: 2, place: 'Naivasha', speedKmh: 38.4, source: 'tracker' };
const turn = { vehicleId: 'v2', plate: 'KDE 127E', kind: 'cornering', at: at(20), lat: null, lng: null, place: null, speedKmh: null, source: 'camera' };

describe('the events picked', () => {
  it('keeps the report’s order, whatever order they were ticked in', () => {
    expect(pickedEvents(['freewheel', 'stop']).map((e) => e.key)).toEqual(['stop', 'freewheel']);
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
  it('gives each kind its own table, an empty one for none', () => {
    const [stops, turns, brakes] = eventSections([stop, brake, turn], ['braking', 'cornering', 'stop']);
    expect([stops.label, turns.label, brakes.label]).toEqual(['Stops over 10 minutes', 'Harsh cornering', 'Harsh stops']);
    expect(brakes.events).toEqual([brake]);
    expect(eventSections([brake], ['stop'])[0].events).toEqual([]);
  });
  const stopCells = (e) => eventSections([e], ['stop'])[0].cells(e);
  it('writes a stop as last speed, time stopped, duration, location, time left', () => {
    expect(eventSections([stop], ['stop'])[0].heads).toEqual(['Unit', 'Last speed', 'Time stopped', 'Duration', 'Location', 'Time left']);
    const [unit, last, stopped, duration, place, left] = stopCells(stop);
    expect([unit, last, duration, place]).toEqual(['KDE 136E', '62 km/h', '45 min', 'Gilgil']);
    expect(stopped).toMatch(/^05\.11\.2026 08:40/);
    expect(left).toMatch(/^05\.11\.2026 09:25/);
  });
  it('gives a long stop in hours, and one still running no time left', () => {
    const cells = stopCells({ ...stop, minutes: 125, leftAt: null, ongoing: true });
    expect(cells[3]).toBe('2 h 05 min');
    expect(cells[5]).toBe('Still there');
  });
  it('says so when a stop began earlier than the readings show', () => {
    const cells = stopCells({ ...stop, speedKmh: null, before: true });
    expect(cells[1]).toBe('-');
    expect(cells[2]).toMatch(/^Before /);
    expect(cells[3]).toBe('Over 45 min');
  });
  it('writes the other events as time, location, speed, source', () => {
    const s = eventSections([turn, brake], ['cornering', 'braking']);
    expect(s[0].heads).toEqual(['Unit', 'Time', 'Location', 'Speed', 'Source']);
    expect(s[0].cells(turn).slice(2)).toEqual(['-', '-', 'Camera']);
    expect(s[1].cells(brake).slice(2)).toEqual(['Naivasha', '38 km/h', 'Tracker']);
  });
  it('keeps the server’s notes, each once, and adds none of its own', () => {
    expect(eventNotes(['A', 'A'])).toEqual(['A']);
    expect(eventNotes()).toEqual([]);
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
    expect(EVENTS.map((e) => e.label)).toEqual(['Stops over 10 minutes', 'Free-wheeling', 'Harsh cornering', 'Harsh stops', 'Harsh acceleration']);
  });
  it('leaves the sheet’s columns as they were, the counts in a table of their own, then a numbered section a kind', () => {
    const d = movementDoc([request], { ...opts, events: { kinds: ['stop', 'braking'], list: [stop, brake, turn] } });
    const [sheet, counted, stops, brakes] = tables(d);
    expect(sheet.head).toEqual(['Grouping', 'Last coordinates', 'Location', 'Speed', 'Direction']);
    expect(counted.head).toEqual(['Unit', 'Stops over 10 minutes', 'Harsh stops']);
    expect(counted.rows.map((r) => r.map((c) => c.text))).toEqual([['KDE 136E', '1', '1']]);
    expect(d.blocks.find((b) => b.title === '3. Events')).toMatchObject({ aside: '2 events' });
    expect(d.blocks.filter((b) => b.kind === 'h3').map((b) => b.title)).toEqual(['3.1 Stops over 10 minutes', '3.2 Harsh stops']);
    expect(stops.head[1]).toBe('Last speed');
    expect(brakes.rows[0][0].text).toBe('KDE 136E');
  });
  it('says none under a kind that had none, with no note about why', () => {
    const d = movementDoc([request], { ...opts, events: { kinds: ['stop', 'freewheel'], list: [stop] } });
    expect(d.blocks.filter((b) => b.kind === 'h3').map((b) => b.title)).toEqual(['3.1 Stops over 10 minutes', '3.2 Free-wheeling']);
    expect(d.blocks.find((b) => b.kind === 'none').text).toBe('None recorded in this window.');
    expect(JSON.stringify(d)).not.toMatch(/CAN-bus/);
  });
  it('never cuts a stop’s time or duration', () => {
    const worst = { ...stop, plate: 'KDE 136E', before: true, minutes: 10_080, speedKmh: 120 };
    const s = eventSections([worst], ['stop'])[0];
    s.cells(worst).forEach((text, i) => {
      if (s.cols[i].w && !s.cols[i].wrap) expect(textMm(text, 7.6, false) + 3.8, text).toBeLessThanOrEqual(s.cols[i].w);
    });
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
