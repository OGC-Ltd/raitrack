// Reconcile a fuel sheet against the probes (operator, 2026-11-27: "feed in an
// excel sheet that shall pick the column named Qty per Aqmst Records, and will
// fill a column named Filling as per Fuel Probes then calculate the variance").
//
// Aquamist's "Fuel Recon-Aqmst vs Probes" sheet: Date, Reg No, Qty per Aqmst
// Records, Filling as per Fuel Probes, Variance, Comment. The probe column is
// filled from Wialon's own fill report for the unit (fleet-server
// fuel/probe-fills, each refuel counted once, so a two-tank unit's per-sensor
// rows are not added: KBY 767G, 22 Jan 2026, 253.72 L, not 368). Variance is
// records minus probe, as the sheet already has it (40 − 39.06 = 0.94).
//
// Where the figures come from: one request to fleet-server fuel/probe-fills for
// the whole sheet, which reads the fuel ledger (Wialon's fill report as the
// 15-minute sync stores it), so a year's sheet is seconds, not a Wialon report
// per unit. A row before the first day the ledger holds is "not checked" and
// keeps what the sheet had.
//
// Matching: a sheet row takes a refuel of its own unit on its own day, the
// nearest in litres, each refuel used once. A row whose unit had no refuel that
// day gets a blank probe figure and a blank variance (operator, 2026-11-27: "if
// it has no fill for that day let it be blank"). A row whose unit could not be
// read at all (not on the platform) keeps what the sheet had.
//
// Pure: no React, no network.

const OFFSET = 3 * 3600_000;
const DAY = 86_400_000;
/** The server reads at most this many days per call (fleet-server probe-fills MAX_DAYS). */
export const MAX_SPAN_DAYS = 400;

export const HEAD_QTY = 'Qty per Aqmst Records';
export const HEAD_PROBE = 'Filling as per Fuel Probes';
export const HEAD_VARIANCE = 'Variance';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export const plateKey = (s) => String(s ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const r2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (y, m, d) => {
  if (!(y >= 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = Date.UTC(y, m - 1, d);
  return new Date(t).getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
/** "2026-01-22" from a fill's time, in Nairobi. */
export const dayOfMs = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * A sheet's date as a day. Excel keeps a real date as a Date (midnight UTC) or a
 * serial number; typed text is month first ("11/20/2025", the sheet's own
 * format) unless the first part cannot be a month ("13/1/2026" is 13 Jan).
 */
export function parseDay(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoDay(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') return v > 20000 && v < 80000 ? dayOfMs(Date.UTC(1899, 11, 30) + Math.round(v) * DAY - OFFSET) : null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return isoDay(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const a = +m[1], b = +m[2];
  return a > 12 ? isoDay(y, b, a) : isoDay(y, a, b);
}

/**
 * Every day a date cell could mean: one for a real date or "11/20/2025", two
 * for typed "9/2/2026" (2 Sep month first, 9 Feb day first).
 */
export function dayCandidates(v) {
  const first = parseDay(v);
  if (!first || typeof v !== 'string') return first ? [first] : [];
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v.trim());
  if (!m || +m[1] > 12 || +m[1] === +m[2]) return [first];
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const other = isoDay(y, +m[2], +m[1]);
  return other ? [first, other] : [first];
}

/** Proven neighbours each side a two-way date is judged by. */
export const NEIGHBOURS = 4;

/**
 * Which way round the cell itself proves it is: 'md' ("1/29/2026"), 'dm'
 * ("29/01/2026"), 'date' (a real date, which says nothing of what was typed),
 * or null when it cannot tell ("9/2/2026", "3/3/2026").
 */
function provenFormat(v) {
  if (v instanceof Date || typeof v === 'number') return 'date';
  const s = String(v ?? '').trim();
  if (/^\d{4}-/.test(s)) return 'date';
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]/.exec(s);
  if (!m) return null;
  return +m[1] > 12 ? 'dm' : +m[2] > 12 ? 'md' : null;
}

/**
 * Each date cell's day, and for one that reads both ways the other reading:
 * [{ day, alt }]. A sheet can change format part-way: Aquamist's is month first
 * ("1/29/2026") but rows 1,150–1,320 are day first ("7/2/2026", "10/2/2026"
 * among 26/1 and 2/14, so February), and it is not in date order (January 2026
 * rows sit in its November 2025 block).
 *
 * So the proven dates around a two-way one vote on the format, NEIGHBOURS each
 * side, the nearer rows weighing more; a tie goes to the reading nearer the
 * median of their dates; with none, month first. Dates that prove nothing
 * ("3/3/2026") do not vote. `alt` lets the fills have the last word: a row whose
 * unit refuelled its quantity on the other reading's day was meant that way
 * (see matchRows).
 */
export function resolveDayChoices(cells) {
  const cands = cells.map(dayCandidates);
  const anchors = [];
  cands.forEach((c, i) => { const fmt = c.length === 1 ? provenFormat(cells[i]) : null; if (fmt) anchors.push({ i, fmt, t: Date.parse(c[0]) }); });
  let k = 0; // the first anchor after the current row
  return cands.map((c, i) => {
    while (k < anchors.length && anchors[k].i <= i) k += 1;
    if (c.length < 2) return { day: c[0] ?? null, alt: null };
    const near = [...anchors.slice(Math.max(0, k - NEIGHBOURS), k), ...anchors.slice(k, k + NEIGHBOURS)];
    if (!near.length) return { day: c[0], alt: c[1] };
    let md = 0, dm = 0;
    for (const a of near) { const w = 1 / Math.abs(a.i - i); if (a.fmt === 'md') md += w; else if (a.fmt === 'dm') dm += w; }
    let pick;
    if (Math.abs(md - dm) > 1e-9) pick = md > dm ? 0 : 1; // c[0] is month first
    else {
      const ts = near.map((a) => a.t).sort((a, b) => a - b);
      const mid = ts.length % 2 ? ts[(ts.length - 1) / 2] : (ts[ts.length / 2 - 1] + ts[ts.length / 2]) / 2;
      pick = Math.abs(Date.parse(c[1]) - mid) < Math.abs(Date.parse(c[0]) - mid) ? 1 : 0;
    }
    return { day: c[pick], alt: c[1 - pick] };
  });
}

/** The days of a column of dates (resolveDayChoices, without the other readings). */
export const resolveDays = (cells) => resolveDayChoices(cells).map((c) => c.day);

/** A cell's number: 70, "70.03", "1,234.5". Text such as "No FLS" is not one. */
export function numberOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/**
 * Where the columns are: the first row (of the first 20) holding the quantity
 * heading, with Date and Reg No beside it. The probe and variance columns are
 * found by name, or are new columns after the last heading.
 * @returns {{ head, date, reg, qty, probe, variance, added: string[] } | null}
 */
export function findColumns(rows) {
  for (let head = 0; head < Math.min(rows.length, 20); head++) {
    const h = (rows[head] ?? []).map(norm);
    const qty = h.findIndex((c) => c === norm(HEAD_QTY) || /^qty .*records?$/.test(c));
    if (qty < 0) continue;
    const date = h.indexOf('date');
    const reg = h.findIndex((c) => c === 'reg no' || c === 'reg no.' || c === 'registration' || c === 'plate' || c === 'unit');
    if (date < 0 || reg < 0) return null;
    let last = h.length - 1;
    while (last >= 0 && !h[last]) last -= 1;
    const added = [];
    let probe = h.findIndex((c) => c === norm(HEAD_PROBE));
    if (probe < 0) { probe = ++last; added.push(HEAD_PROBE); }
    let variance = h.indexOf('variance');
    if (variance < 0) { variance = ++last; added.push(HEAD_VARIANCE); }
    return { head, date, reg, qty, probe, variance, added };
  }
  return null;
}

/** The sheet's fuel rows: those with a day, a plate and a quantity. */
export function sheetItems(rows, cols) {
  const items = [];
  const days = resolveDayChoices(rows.slice(cols.head + 1).map((r) => (r ?? [])[cols.date]));
  for (let i = cols.head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const { day, alt } = days[i - cols.head - 1];
    const plate = String(r[cols.reg] ?? '').replace(/\s+/g, ' ').trim();
    const qty = numberOf(r[cols.qty]);
    if (!day || !plateKey(plate) || qty == null) continue;
    items.push({ row: i, day, alt, plate, key: plateKey(plate), qty, was: r[cols.probe] ?? '' });
  }
  return items;
}

/** A refuel this near the quantity (litres, or share of it) settles a two-way date. */
export const DATE_FIT_L = 5;
export const DATE_FIT_SHARE = 0.15;

/** Units in one request, at most (fleet-server probe-fills MAX_PLATES). */
export const MAX_PLATES = 500;

/**
 * The requests for a sheet: [{ plates, from, to }], its units in batches of
 * MAX_PLATES over stretches of at most MAX_SPAN_DAYS. A year's sheet is one.
 */
export function requestsFor(items) {
  // Both readings of a two-way date, so the fills can settle it (matchRows)
  const days = [...new Set(items.flatMap((it) => (it.alt ? [it.day, it.alt] : [it.day])))].sort();
  const plates = [...new Map(items.map((it) => [it.key, it.plate])).values()];
  const spans = [];
  for (const d of days) {
    const last = spans.at(-1);
    if (last && (Date.parse(d) - Date.parse(last.from)) / DAY + 1 <= MAX_SPAN_DAYS) last.to = d;
    else spans.push({ from: d, to: d });
  }
  const out = [];
  for (const span of spans) for (let i = 0; i < plates.length; i += MAX_PLATES) out.push({ plates: plates.slice(i, i + MAX_PLATES), ...span });
  return out;
}

/** The units of the server's answers, by plate key: { fills, note }. */
export function unitsByKey(answers) {
  const byKey = new Map();
  for (const a of answers) for (const u of a?.units ?? []) {
    const key = plateKey(u.plate);
    const had = byKey.get(key);
    const got = { fills: u.fills ?? [], note: u.vehicle ? null : (u.note ?? 'Not on the platform') };
    byKey.set(key, had && !had.note ? { fills: [...had.fills, ...got.fills], note: null } : got);
  }
  return byKey;
}

/**
 * Each sheet row's refuel. `fillsByKey`: plate key → { fills: [{ at, litres }], note }.
 * `coveredFrom`: the first day the records hold; a row before it is not checked.
 * A row whose date reads both ways takes the other reading when only that day
 * has a refuel of its quantity (`day` on the match says so).
 * @returns {Map<number, { litres, at, day? } | { note }>} by sheet row
 */
export function matchRows(items, fillsByKey, coveredFrom = null) {
  const out = new Map();
  const byUnit = new Map();
  for (const it of items) byUnit.set(it.key, [...(byUnit.get(it.key) ?? []), it]);
  for (const [key, unitRows] of byUnit) {
    let rows = unitRows;
    const got = fillsByKey.get(key);
    if (!got || got.note) { for (const it of rows) out.set(it.row, { note: got?.note ?? 'Not read' }); continue; }
    const fills = got.fills.map((f) => ({ ...f, day: dayOfMs(f.at), used: false }));
    // A two-way date the unit's refuels settle: only the other reading has one of its quantity
    const fits = (it, day) => fills.some((f) => f.day === day && Math.abs(f.litres - it.qty) <= Math.max(DATE_FIT_L, it.qty * DATE_FIT_SHARE));
    rows = rows.map((it) => (it.alt && !fits(it, it.day) && fits(it, it.alt) ? { ...it, day: it.alt, alt: it.day, flipped: true } : it));
    for (const it of rows) if (!coveredFrom || it.day < coveredFrom) out.set(it.row, { note: NOT_CHECKED });
    // Pairs of a row and a refuel on its day, nearest in litres first
    const pairs = rows.flatMap((it) => fills.filter((f) => f.day === it.day).map((f) => ({ it, f, gap: Math.abs(f.litres - it.qty) })));
    pairs.sort((a, b) => a.gap - b.gap || a.f.at - b.f.at);
    for (const { it, f } of pairs) {
      if (f.used || out.has(it.row)) continue;
      f.used = true;
      out.set(it.row, { litres: f.litres, at: f.at, ...(it.flipped ? { day: it.day } : {}) });
    }
    for (const it of rows) if (!out.has(it.row)) out.set(it.row, { note: NO_FILL });
  }
  return out;
}

/** The note of a row whose unit had no refuel on its day: written blank. */
export const NO_FILL = 'No probe fill';
/** The note of a row before the records begin: left as the sheet had it. */
export const NOT_CHECKED = 'Before the records';

/** Records minus probe, to the hundredth (the sheet's 40 − 39.06 = 0.94). */
export const varianceOf = (qty, probe) => r2(qty - probe);

/**
 * What to write: per sheet row { probe, variance }: the refuel's litres, or
 * blanks where the unit had none that day. Rows whose unit was not read are
 * left as they are.
 */
export function fillPlan(items, matches) {
  const writes = [];
  const tally = { rows: items.length, matched: 0, changed: 0, noFill: 0, blanked: 0, notOnPlatform: 0, notChecked: 0, notRead: 0, dateFlipped: 0 };
  for (const it of items) {
    const m = matches.get(it.row);
    if (m?.note === NO_FILL) {
      tally.noFill += 1;
      if (String(it.was).trim()) tally.blanked += 1;
      writes.push({ row: it.row, probe: '', variance: '' });
      continue;
    }
    if (!m || m.note) {
      if (m?.note === 'Not on the platform') tally.notOnPlatform += 1;
      else if (m?.note === NOT_CHECKED) tally.notChecked += 1;
      else tally.notRead += 1;
      continue;
    }
    const probe = r2(m.litres);
    tally.matched += 1;
    if (m.day) tally.dateFlipped += 1;
    const was = numberOf(it.was);
    if (was == null || Math.abs(was - probe) > 0.5) tally.changed += 1;
    writes.push({ row: it.row, probe, variance: varianceOf(it.qty, probe), at: m.at });
  }
  return { writes, tally };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Rows of a CSV file's text (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** The sheet's rows with the plan written in (a copy). */
export function applyToRows(rows, cols, writes) {
  const out = rows.map((r) => [...(r ?? [])]);
  const put = (r, c, v) => { while (out[r].length < c) out[r].push(''); out[r][c] = v; };
  if (cols.added.includes(HEAD_PROBE)) put(cols.head, cols.probe, HEAD_PROBE);
  if (cols.added.includes(HEAD_VARIANCE)) put(cols.head, cols.variance, HEAD_VARIANCE);
  for (const w of writes) { put(w.row, cols.probe, w.probe); put(w.row, cols.variance, w.variance); }
  return out;
}

/** "Fuel Recon (probes).xlsx" from "Fuel Recon.xlsx". */
export const outName = (name, ext) => `${String(name ?? 'sheet').replace(/\.[^.]+$/, '')} (probes).${ext}`;
