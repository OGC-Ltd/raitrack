// The events an operator can pick onto the Movements report (operator, 5 Nov
// 2026): a count a unit, and a list of each one with its time and place. The
// server finds them (reports/movements/events); this names and counts them for
// the page, the PDF, the JPEG and the CSV.
//
// Pure: no React, no network.

import { stamp } from './movementReport';

// Whole words only (operator, 5 Nov 2026): `w` is the column in mm that holds the label on one line, as the PDF prints a heading
export const EVENTS = [
  { key: 'freewheel', label: 'Free-wheeling', w: 23 },
  { key: 'cornering', label: 'Harsh cornering', w: 25 },
  { key: 'braking', label: 'Harsh stops', w: 20 },
  { key: 'acceleration', label: 'Harsh acceleration', w: 28 },
  { key: 'stop', label: 'Stops over 10 min', w: 28 },
];
const BY_KEY = new Map(EVENTS.map((e) => [e.key, e]));
export const eventKeys = EVENTS.map((e) => e.key);

/** The events picked, in the report's own order. */
export const pickedEvents = (kinds) => EVENTS.filter((e) => kinds?.includes(e.key));

/** A zero is not a clean result when the camera could not have seen it. */
export const FREEWHEEL_NOTE = 'No free-wheeling alarms. These need the camera’s CAN-bus link, so none does not show there was none.';

/** By unit, then by kind: how many of each. */
export function countByUnit(events) {
  const units = new Map();
  for (const e of events ?? []) {
    const unit = units.get(e.vehicleId) ?? {};
    unit[e.kind] = (unit[e.kind] ?? 0) + 1;
    units.set(e.vehicleId, unit);
  }
  return units;
}

/** A row's count of one kind, as the table prints it. */
export const countCell = (counts, vehicleId, kind) => counts.get(vehicleId)?.[kind] || '-';

/** Only the events of the kinds picked and the units still in the report, in time order. */
export function eventsFor(events, rows, kinds) {
  const units = new Set(rows.map((r) => r.vehicleId));
  const picked = new Set(kinds);
  return (events ?? []).filter((e) => picked.has(e.kind) && units.has(e.vehicleId)).sort((a, b) => a.at - b.at);
}

const time = (e) => {
  const s = stamp(e.at);
  return e.before ? `Before ${s}` : s;
};
/** How hard to read at a glance: a stop's length, or the speed it happened at. */
const detail = (e) => {
  if (e.kind === 'stop') return `${e.minutes} min${e.ongoing ? ', still there' : ''}`;
  return Number.isFinite(e.speedKmh) && e.speedKmh > 0 ? `${Math.round(e.speedKmh)} km/h` : '-';
};

export const EVENT_HEADS = ['Unit', 'Event', 'Time', 'Place', 'Speed or length', 'Source'];

/** One line of the Events list, labelled by the row's plate where it has it. */
export function eventCells(e) {
  return [e.plate || '-', BY_KEY.get(e.kind)?.label ?? e.kind, time(e), e.place ?? '-', detail(e), e.source === 'camera' ? 'Camera' : 'Tracker'];
}

/** What a reader must be told about these events: the server's notes, and a free-wheeling zero. */
export function eventNotes(events, kinds, notes = []) {
  const said = [...new Set(notes)];
  if (kinds?.includes('freewheel') && !(events ?? []).some((e) => e.kind === 'freewheel')) said.push(FREEWHEEL_NOTE);
  return said;
}
