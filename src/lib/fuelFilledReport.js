// Fuel filled (Movements › Fuel, 2026-11-27; Aquamist's sheet "Filling as per
// Fuel Probes"): each refuel, its day, the unit and the litres the fuel probe
// saw go in. Read off the fuel ledger (fleet-server fuel/fillings).
//
// The litres are Wialon's own figure for the fill (`filledMl`), which is what
// Aquamist's sheet carries: on 14 Oct 2026 all six of its rows matched it to
// within 0.5 L. The verifier's `observedRiseMl` is not used: on Aquamist it is
// 0 on fills it still judged REFILL (KAV 313M, KAZ 581G).
//
// One refuel can sit on the ledger as two or more rows, and summing them counts
// the fuel twice:
// - a unit with two tanks gets a row per tank and one for the total, all at the
//   same second (KCK 851Z, 14 Oct 2026: 96.5, 71.9 and 24.5 L);
// - Wialon splits a long ramp, and each part is measured over the whole rise
//   (EX-17, 23 Nov 2026: 579.6 L and 231.5 L for one 576 L issue).
// So rows of a unit within an hour of the one before are one stop at the pump
// (fleet-server fuel-balance STOP_GAP_MS). Inside a stop, rows at the same
// moment, or whose before-to-after levels overlap, are one fill and count once,
// at the largest; fills one after another (the level rose again from where the
// last left it) are added.
//
// Pure: no React, no network.

export { periodWords, yesterday } from './tatFuelReport';

export const MAX_DAYS = 31;
/** Fillings this close are one stop at the pump (fleet-server fuel-balance STOP_GAP_MS). */
export const STOP_GAP_MS = 60 * 60_000;
/** Verdicts the fuel balance counts as fuel in; the rest (level came back, sensor fault) are set aside. */
const COUNTED = new Set(['REFILL', 'PENDING']);
const OFFSET = 3 * 3600_000;
const DASH = '-';

const r1 = (v) => Math.round(v * 10) / 10;
const litresOf = (ml) => (ml != null && Number.isFinite(Number(ml)) ? Number(ml) / 1000 : null);

/** "14/10/2026", in Nairobi. */
export const dayOf = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };
/** "13:25", in Nairobi. */
export const timeOf = (ms) => new Date(ms + OFFSET).toISOString().slice(11, 16);

export const counts = (f) => f.verdict == null || COUNTED.has(String(f.verdict));

/** Rows this close in time are one fill seen by several sensors. */
export const SAME_FILL_MS = 2 * 60_000;

/**
 * One stop's rows (in time order) as the fills in it, each at its largest
 * row: { litres, before, after, at }, the levels those of that row.
 */
export function fillsOf(stop) {
  const fills = [];
  for (const f of stop) {
    const row = { at: Date.parse(f.filledAt), litres: litresOf(f.filledMl) ?? 0, before: litresOf(f.initialFuelLevelMl), after: litresOf(f.finalFuelLevelMl) };
    const overlaps = (g) => Math.abs(row.at - g.at) <= SAME_FILL_MS
      || (row.before != null && row.after != null && g.before != null && g.after != null && row.before < g.after && g.before < row.after);
    const same = fills.find(overlaps);
    if (!same) fills.push(row);
    else if (row.litres > same.litres) Object.assign(same, { litres: row.litres, before: row.before, after: row.after });
  }
  return fills;
}

/**
 * Ledger rows (as fuel/fillings returns them) as refuels, in time order. Each
 * refuel: { vehicleId, plate, name, at, lastAt, filledL, beforeL, afterL,
 * rows (ledger rows), fills (fills added up), pending, location }.
 */
export function refuelsOf(fills) {
  const byUnit = new Map();
  for (const f of fills) {
    if (!counts(f)) continue;
    const id = f.vehicleId ?? f.vehicle?.id;
    byUnit.set(id, [...(byUnit.get(id) ?? []), f]);
  }
  const out = [];
  for (const [vehicleId, list] of byUnit) {
    const stops = [];
    for (const f of [...list].sort((a, b) => Date.parse(a.filledAt) - Date.parse(b.filledAt))) {
      const last = stops.at(-1);
      if (last && Date.parse(f.filledAt) - Date.parse(last.at(-1).filledAt) <= STOP_GAP_MS) last.push(f);
      else stops.push([f]);
    }
    for (const stop of stops) {
      const fillsAt = fillsOf(stop);
      const first = stop[0];
      out.push({
        vehicleId,
        plate: first.vehicle?.registrationPlate ?? '',
        name: first.vehicle?.name ?? first.vehicle?.registrationPlate ?? '',
        at: Date.parse(first.filledAt),
        lastAt: Date.parse(stop.at(-1).filledAt),
        filledL: r1(fillsAt.reduce((n, f) => n + f.litres, 0)),
        beforeL: fillsAt[0].before == null ? null : r1(fillsAt[0].before),
        afterL: fillsAt.at(-1).after == null ? null : r1(fillsAt.at(-1).after),
        rows: stop.length,
        fills: fillsAt.length,
        pending: stop.some((f) => f.verdict === 'PENDING'),
        location: stop.find((f) => f.location)?.location ?? null,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.plate.localeCompare(b.plate));
}

/** Rows the verifier ruled were not fuel in, left out of the report. */
export const setAsideOf = (fills) => fills.filter((f) => !counts(f)).length;

/** The registration as the sheet writes it: the plate, else the unit's name. */
export const regOf = (r) => r.plate || r.name;

export const HEADS = ['Date', 'Time', 'Reg No', 'Filling as per Fuel Probes, L', 'Before, L', 'After, L', 'Location'];
/** The figures' columns, right-aligned. */
export const FIGURES = new Set([3, 4, 5]);

const fixed = (v) => (v == null ? DASH : v.toFixed(1));

export function rowCells(r) {
  return [
    dayOf(r.at), timeOf(r.at), regOf(r),
    `${fixed(r.filledL)}${r.pending ? ' *' : ''}`,
    fixed(r.beforeL), fixed(r.afterL), r.location ?? DASH,
  ];
}

/** The units on the report, A–Z, for the unit filter. */
export function unitsOf(rows) {
  const m = new Map();
  for (const r of rows) if (!m.has(r.vehicleId)) m.set(r.vehicleId, regOf(r));
  return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
}

export const summary = (rows) => ({
  units: new Set(rows.map((r) => r.vehicleId)).size,
  refuels: rows.length,
  litres: r1(rows.reduce((n, r) => n + r.filledL, 0)),
  joined: rows.reduce((n, r) => n + r.rows - r.fills, 0),
  pending: rows.filter((r) => r.pending).length,
});

/** "2026-10-14", the Nairobi day a refuel fell on. */
export const ymdOf = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);

/** "Wed 14 Oct 2026" for a "2026-10-14" day; "No date" for none. */
export function dayWords(ymd) {
  if (!ymd) return 'No date';
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  const part = (o) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  return `${part({ weekday: 'short' })} ${d.getUTCDate()} ${part({ month: 'short' })} ${d.getUTCFullYear()}`;
}

/** Rows under one heading per key, the keys in the order the rows first give them. */
export function groupsOf(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m].map(([key, items]) => ({ key, rows: items }));
}

const squash = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Does a plate hold what was typed, ignoring case and spaces ("kby767" finds "KBY 767G")? */
export const plateHas = (plate, typed) => squash(plate).includes(squash(typed));
