// The events an operator can pick onto the Movements report (operator, 5 Nov
// 2026): a count a unit, and a list of each one with its time and place. The
// server finds them (reports/movements/events); this names and counts them for
// the page, the PDF, the JPEG and the CSV: a table a kind, 3.1, 3.2 on the
// document (operator, 5 Nov 2026), stops with their own columns.
//
// Pure: no React, no network.

import { stamp } from './movementReport';

// Whole words only (operator, 5 Nov 2026): `w` is the column in mm that holds the label on one line, as the PDF prints a heading
export const EVENTS = [
  { key: 'stop', label: 'Stop over 10 min', w: 26 },
  { key: 'freewheel', label: 'Free-wheeling', w: 23 },
  { key: 'cornering', label: 'Harsh cornering', w: 25 },
  { key: 'braking', label: 'Harsh stop', w: 20 },
  { key: 'acceleration', label: 'Harsh acceleration', w: 28 },
];
export const eventKeys = EVENTS.map((e) => e.key);

/** The counts the PDF's unit tables carry, right before Speed (operator, 5 Nov 2026), when picked. */
export const SHEET_COUNTS = [
  { key: 'acceleration', head: 'Harsh acceleration', w: 28 },
  { key: 'cornering', head: 'Harsh cornering', w: 25 },
  { key: 'stop', head: 'Stops', w: 13 },
];

/** The events picked, in the report's own order. */
export const pickedEvents = (kinds) => EVENTS.filter((e) => kinds?.includes(e.key));

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

const speed = (e) => (Number.isFinite(e.speedKmh) ? `${Math.round(e.speedKmh)} km/h` : '-');
const lasted = (minutes) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`);

const STOP_TABLE = {
  heads: ['Unit', 'Last speed', 'Time stopped', 'Duration', 'Location', 'Time left'],
  // In mm for the PDF: Location takes what is left
  cols: [{ w: 30 }, { w: 18, align: 'right' }, { w: 32 }, { w: 22 }, { w: 0, wrap: true }, { w: 32 }],
  cells: (e) => [
    e.plate || '-',
    speed(e),
    stamp(e.stoppedAt ?? e.at),
    lasted(e.minutes),
    e.place ?? '-',
    e.leftAt != null ? stamp(e.leftAt) : 'Still there',
  ],
};
const EVENT_TABLE = {
  heads: ['Unit', 'Time', 'Location', 'Speed', 'Source'],
  cols: [{ w: 30 }, { w: 32 }, { w: 0, wrap: true }, { w: 18, align: 'right' }, { w: 16 }],
  cells: (e) => [e.plate || '-', stamp(e.at), e.place ?? '-', speed(e), e.source === 'camera' ? 'Camera' : 'Tracker'],
};

/** A table for each kind picked, in the report's order, with its events in time order. */
export function eventSections(events, kinds) {
  return pickedEvents(kinds).map((k) => ({
    ...k,
    ...(k.key === 'stop' ? STOP_TABLE : EVENT_TABLE),
    events: (events ?? []).filter((e) => e.kind === k.key),
  }));
}

/** What the server says is missing from these events, each once. */
export const eventNotes = (notes = []) => [...new Set(notes)];
