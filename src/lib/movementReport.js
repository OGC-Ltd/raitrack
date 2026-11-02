// The Movements report as a table the operator can edit before the PDF
// (operator, 2026-11-02). The server answers the report as data
// (reports/movements); the operator may change a row's location or direction,
// or leave a row out; the edited report goes back to the server, which draws
// the PDF from it (POST reports/movements.pdf).
//
// Edits are kept apart from the report, keyed by vehicleId, so Reset is just
// dropping them and the server's answer is never changed in place.
//
// Pure: no React, no network.

import { dayStart } from './fleetReports';

/** The Direction column's words, as the PDF prints them. */
export const DIRECTION = {
  to: 'To MORL', from: 'From MORL', at: 'At MORL', moving: 'Moving', stopped: 'Stopped', 'no-fix': 'No fix',
};
export const STATES = Object.keys(DIRECTION);

/** Moving, as the server reads it: this fast or faster on a fix inside the window. */
export const MOVING_KMH = 5;

/**
 * Is the unit moving now? Its Location cell is filled green (operator, 2026-11-02).
 * Pass the row as edited: one the operator set to Stopped or No fix is not
 * moving, whatever the last speed said. The server reads it the same way.
 */
export function isMoving(row) {
  return row.lastAt != null && !row.stale && row.state !== 'stopped' && row.state !== 'no-fix'
    && (row.speedKmh ?? 0) >= MOVING_KMH;
}

/** The Mombasa loading point and its radius (operator, 2026-11-02), as the server has it. */
export const MOMBASA_LOADING = { lat: -4.04579, lng: 39.65165, radiusM: 1000 };

const rad = (d) => (d * Math.PI) / 180;
function metres(lat1, lng1, lat2, lng2) {
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Is the unit loading in Mombasa? Its last fix, inside the window, is within
 * 1 km of the loading point: its Location cell is filled orange, ahead of green.
 */
export function isLoading(row) {
  return row.lastAt != null && !row.stale && row.lat != null && row.lng != null
    && metres(row.lat, row.lng, MOMBASA_LOADING.lat, MOMBASA_LOADING.lng) <= MOMBASA_LOADING.radiusM;
}

/** The PDF's tints for the rows heading somewhere or standing at MORL. */
export const TINT = { to: '#e3f1dc', from: '#fbe4d3', at: '#fdf3c9' };

const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).formatToParts(ms).map((p) => [p.type, p.value]));

/** "18.06.2025 07:56:26", as the PDF and the operator's sheet write it. */
export function stamp(ms) {
  if (ms == null) return 'No fix';
  const p = parts(ms);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** The row as it now reads: the server's row with the operator's edit over it. */
export function editedRow(row, edit) {
  if (!edit) return row;
  return {
    ...row,
    ...(edit.location !== undefined ? { location: edit.location.trim() || null } : {}),
    ...(edit.state !== undefined ? { state: edit.state } : {}),
  };
}

/** Does this typed location differ from the server's? Spaces at the ends do not count. */
export function locationChanged(row, typed) {
  return (String(typed ?? '').trim() || null) !== (row.location ?? null);
}

/** Has the operator changed anything on this row? */
export function isEdited(row, edit) {
  if (!edit) return false;
  return Boolean(edit.removed)
    || (edit.location !== undefined && locationChanged(row, edit.location))
    || (edit.state !== undefined && edit.state !== row.state);
}

/** The overview's figures from the rows kept, as the server counts them. */
export function countRows(groups) {
  const counts = { to: 0, from: 0, at: 0, moving: 0, stopped: 0, 'no-fix': 0, stale: 0, total: 0 };
  for (const g of groups) for (const r of g.rows) { counts[r.state] += 1; counts.total += 1; if (r.stale) counts.stale += 1; }
  return counts;
}

/**
 * The report with the edits applied and the left-out rows gone: what the PDF
 * is drawn from. Groups left empty are dropped.
 * @param {object} report  the server's answer
 * @param {Record<string, {location?: string, state?: string, removed?: boolean}>} edits  by vehicleId
 */
export function applyEdits(report, edits) {
  const groups = report.groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => !edits[r.vehicleId]?.removed).map((r) => editedRow(r, edits[r.vehicleId])) }))
    .filter((g) => g.rows.length);
  return { ...report, groups, counts: countRows(groups) };
}

/** How many rows the operator changed (location or direction) and left out: printed on the PDF. */
export function editCounts(report, edits) {
  let changed = 0;
  let removed = 0;
  for (const g of report.groups) {
    for (const r of g.rows) {
      const e = edits[r.vehicleId];
      if (e?.removed) removed += 1;
      else if (isEdited(r, e)) changed += 1;
    }
  }
  return { changed, removed };
}

/** What the server needs to draw the edited PDF, and nothing it would ignore. */
export function pdfRequest(report, edits) {
  const { hours, from, to, morl, groups } = applyEdits(report, edits);
  return { hours, from, to, morl, groups, edits: editCounts(report, edits) };
}

// ── windows and vehicle types (operator, 2026-11-02) ─────────────────────────

const HOUR = 3_600_000;
/** A range of days at most this long: one PDF of them stays under the server's body limit. */
export const MAX_MOVEMENT_DAYS = 7;
/** The last-hours windows, shortest first: the page opens on the first. */
export const LAST_HOURS = [1, 2, 4];

/**
 * The windows a choice covers, oldest first: the last `hours` up to now, or
 * the same hours on every day of a range ("07:00 to 08:00" each day; an end at
 * or before the start runs past midnight into the next day). A window still
 * running stops at now; one not yet begun is left out.
 * @param {{ mode: 'last', hours: number } | { mode: 'days', fromDay: string, toDay: string, start: number, end: number }} sel
 */
export function movementWindows(sel, now = Date.now()) {
  if (sel.mode === 'last') return [{ from: now - sel.hours * HOUR, to: now }];
  const out = [];
  for (let d = sel.fromDay; d <= sel.toDay && out.length < MAX_MOVEMENT_DAYS; d = nextDay(d)) {
    const from = dayStart(d) + sel.start * HOUR;
    const to = dayStart(d) + (sel.end > sel.start ? sel.end : sel.end + 24) * HOUR;
    if (from < now) out.push({ from, to: Math.min(to, now) });
  }
  return out;
}
const nextDay = (key) => new Date(Date.parse(`${key}T12:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10);

/** Why a days-and-hours choice cannot run, or null. */
export function windowsProblem(sel, now = Date.now()) {
  if (sel.mode === 'last') return null;
  if (!sel.fromDay || !sel.toDay) return 'Pick the first and last day';
  if (sel.toDay < sel.fromDay) return 'The last day is before the first';
  const days = Math.round((dayStart(sel.toDay) - dayStart(sel.fromDay)) / (24 * HOUR)) + 1;
  if (days > MAX_MOVEMENT_DAYS) return `${MAX_MOVEMENT_DAYS} days at most`;
  if (sel.start === sel.end % 24 && !(sel.start === 0 && sel.end === 24)) return 'The hours start and end at the same time';
  if (!movementWindows(sel, now).length) return 'These hours have not begun yet';
  return null;
}

/** The vehicle types the reports hold: their groupings ("CPO - Menengai"), CPO first. */
export function vehicleTypes(reports) {
  const names = new Set();
  for (const r of reports) for (const g of r.groups) names.add(g.name);
  return [...names].sort((a, b) => (/^CPO\b/i.test(a) ? 0 : 1) - (/^CPO\b/i.test(b) ? 0 : 1) || a.localeCompare(b));
}

/** The types picked when the page opens: the CPO groupings, or every one when there is none. */
export function defaultTypes(types) {
  const cpo = types.filter((t) => /^CPO\b/i.test(t));
  return cpo.length ? cpo : types;
}

/** The report with only the picked types, counted again. */
export function onlyTypes(report, types) {
  const keep = new Set(types);
  const groups = report.groups.filter((g) => keep.has(g.name));
  return { ...report, groups, counts: countRows(groups) };
}
