// How each report reads as a table: its columns, a row's cells, the figures
// at the top, and the total each group carries. One definition feeds the
// screen, the PDF and the CSV, so the three can never disagree.
//
// Pure: no React.

import { km1, km2, minutesWords, OVERSPEED_MIN_SEC, OVER_STANDARD } from './fleetReports';
import { statusWord } from './followUp';

const DAY = 86_400_000;
/** The day and second a unit reached its top speed: "Sat 07 Nov 2026 14:32:15", Nairobi. */
const peakDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export const peakWords = (ms) => (Number.isFinite(ms) ? peakDay.format(ms).replace(/,/g, '') : '-');
const peakClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/**
 * "Top speed at": the time alone, to the second, when the report covers one
 * day ("14:32:15"); the day too over longer periods, as Mufindi's week needs
 * (10 Nov 2026, the report may back a disciplinary case).
 */
export const peakTimeWords = (ms, ctx) => {
  if (!Number.isFinite(ms)) return '-';
  const oneDay = Number.isFinite(ctx?.from) && Number.isFinite(ctx?.to) && ctx.to - ctx.from <= DAY;
  return oneDay ? peakClock.format(ms) : peakWords(ms);
};
/** Where the top speed was: its place name, else its coordinates, else a dash. */
const peakPlaceWords = (r) => r.peakPlace
  ?? (Number.isFinite(r.peak?.lat) && Number.isFinite(r.peak?.lng) ? `${r.peak.lat.toFixed(5)}, ${r.peak.lng.toFixed(5)}` : '–');

/** "22:47", or "31 Oct 22:47" when the report covers more than one night. Nairobi. */
const clockOnly = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clockDated = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clockWords = (ms, dated) => (dated ? clockDated.format(ms).replace(/,/g, '') : clockOnly.format(ms));

/**
 * The night report's "Moving between": "22:30 – 23:40 Hrs" over one night.
 * Over several, the times carry their date and the nights it moved are
 * counted, so a range never reads backwards: "31 Oct 23:30 – 2 Nov 22:10 Hrs, 2 nights".
 */
export function movingRange(r) {
  const { firstMovingAt: first, latestMovingAt: last } = r;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return '-';
  const dated = (r.nights ?? 1) > 1;
  const span = first === last ? clockWords(first, dated) : `${clockWords(first, dated)} – ${clockWords(last, dated)}`;
  return `${span} Hrs${(r.movingNights ?? 1) > 1 ? `, ${r.movingNights} nights` : ''}`;
}

/** Words that say there is no value: shown blank, and a column of nothing else is left out. */
const NO_VALUE = new Set(['', '-', '–', 'unspecified', 'unknown', 'n/a', 'none']);
export const isBlank = (v) => NO_VALUE.has(String(v ?? '').trim().toLowerCase());
const clean = (v) => (isBlank(v) ? '' : String(v));
const typeOf = (r) => clean(r.unit.type);
const vehicleCell = (r) => r.unit.plate;

/** Below this a consumption figure means nothing (a few litres over 1 km). */
const MIN_RATE_KM = 10;

/**
 * The consumption units the reader can pick before running the report
 * (operator, 1 Nov 2026). Each is fuel used against distance, put three ways.
 */
export const RATES = {
  kmpl: { label: 'km per litre', unit: 'km/L', of: (l, km) => km / l, dp: 2 },
  l100: { label: 'Litres per 100 km', unit: 'L/100 km', of: (l, km) => (l / km) * 100, dp: 1 },
  lpkm: { label: 'Litres per km', unit: 'L/km', of: (l, km) => l / km, dp: 2 },
};
export const DEFAULT_RATE = 'kmpl';
const rateOf = (ctx) => RATES[ctx?.rate] ?? RATES[DEFAULT_RATE];
const fixed = (x, dp) => x.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * A fuel sensor that cannot be right: the unit covered real ground but its
 * tank hardly moved (operator, 1 Nov 2026: KCT 509W, 388.8 km and 0.0 L).
 * Under 2 L per 100 km over 50 km or more is beyond any truck or car here.
 */
export const fuelSuspect = (r) => (r.basis !== undefined ? Boolean(r.fuelSuspectRated)
  : r.fuelSeen && r.km >= 50 && r.usedL < 0.02 * r.km);

/** Rated against the register (Mufindi): "18.0 L/h", "0.38 L/km". */
const rateText = (x, basis) => (x == null ? '-' : `${fixed(x, basis === 'HOURS' ? 1 : 2)} ${basis === 'HOURS' ? 'L/h' : 'L/km'}`);
/** "12% over", "6% under", "On standard". */
export function againstWords(over) {
  if (over == null) return '-';
  const pct = Math.round(Math.abs(over) * 100);
  return pct === 0 ? 'On standard' : `${pct}% ${over > 0 ? 'over' : 'under'}`;
}
/** More than 15% over the register's standard. */
export const overStandard = (r) => r.over != null && r.over > OVER_STANDARD;
const hoursText = (min) => (min > 0 ? fixed(min / 60, 1) : '0.0');

/** Fuel used, or why there is no figure. */
const fuelUsed = (r) => (fuelSuspect(r) ? 'Check sensor' : r.fuelSeen ? km1(r.usedL) : r.fuelSensor ? '-' : 'No sensor');
/** Consumption in the chosen unit, where the figure means something. */
function consumption(r, ctx) {
  if (!r.fuelSeen || fuelSuspect(r) || r.km < MIN_RATE_KM || !(r.usedL > 0)) return '-';
  const rate = rateOf(ctx);
  return fixed(rate.of(r.usedL, r.km), rate.dp);
}
const n = (x) => (Number.isFinite(x) ? x.toLocaleString('en-GB') : '-');

/**
 * The Driver Conduct Report's Follow-up section (Pending cases, Actions taken etc.).
 * Restored (operator, 9 Nov 2026: "restore back the pending things and feedback").
 */
export const SHOW_FOLLOW_UP = true;

/**
 * The Follow-up column in the main vehicles table (Overdue / Pending / No case / Action taken badges).
 * Restored (operator, 9 Nov 2026: show inline on each row; pending cases page removed).
 */
export const SHOW_FOLLOW_UP_COLUMN = true;

export const REPORTS = {
  behaviour: {
    key: 'behaviour',
    /** Columns from this index on are figures: right-aligned. */
    num: 3,
    // Driver conduct, was Driver behaviour (operator, 2 Nov: "rename it to driver conduct")
    label: 'Driver conduct',
    title: 'Driver Conduct Report',
    preset: 'today',
    maxDays: 7,
    /** The dashcam keeps its alarms 7 days, so a period must start within them. */
    reachDays: 7,
    columns: () => ['Vehicle', 'Type', 'Driver', 'Harsh acceleration', 'Harsh braking', 'Harsh cornering', 'No seatbelt', 'On phone', 'Camera covered', 'Total', ...(SHOW_FOLLOW_UP_COLUMN ? ['Follow-up'] : [])],
    /** Columns of words after the figures: left-aligned. */
    text: SHOW_FOLLOW_UP_COLUMN ? ['Follow-up'] : [],
    cells: (r, ctx) => {
      // A unit without a dashcam cannot report these itself: a dash, not a
      // zero, unless an operator logged one.
      const cam = (k) => (r.dashcam || r.manual?.[k] ? String(r[k]) : '–');
      return [vehicleCell(r) + (r.suspect ? ' (check sensor)' : ''), typeOf(r), clean(r.driver),
        String(r.accel), String(r.brake), String(r.corner ?? 0), cam('seatbelt'), cam('phone'), cam('covered'), String(r.total),
        ...(SHOW_FOLLOW_UP_COLUMN ? [statusWord(ctx?.followUp?.get(r.unit.key), ctx?.now)] : [])];
    },
    sum: (r) => r.total,
    sumWords: (t) => `${n(t)} incident${t === 1 ? '' : 's'}`,
    kpis: (rows) => {
      const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
      const suspect = rows.filter((r) => r.suspect).length;
      return [
        { label: 'Vehicles', value: n(rows.length) },
        { label: 'Harsh acceleration', value: n(sum('accel')) },
        { label: 'Harsh braking', value: n(sum('brake')) },
        { label: 'Harsh cornering', value: n(sum('corner')) },
        { label: 'No seatbelt', value: n(sum('seatbelt')) },
        { label: 'On phone', value: n(sum('phone')) },
        { label: 'Camera covered', value: n(sum('covered')) },
        ...(suspect ? [{ label: 'Check sensor', value: n(suspect), tone: 'speed' }] : []),
        { label: 'Total incidents', value: n(rows.reduce((s, r) => s + r.total, 0)) },
      ];
    },
    empty: 'No harsh driving or cornering, seatbelt, phone or camera-covered incidents in this period.',
  },

  night: {
    key: 'night',
    /** Columns from this index on are figures: right-aligned. */
    num: 2,
    /** Words, not a figure: left-aligned though it sits past num. */
    text: ['Moving between'],
    label: 'Night driving',
    title: 'Night Driving Report',
    preset: 'lastNight',
    maxDays: 7,
    columns: () => ['Vehicle', 'Type', 'Night distance, km', 'Time moving', 'Moving between'],
    cells: (r) => [vehicleCell(r), typeOf(r), km1(r.km), minutesWords(r.movingMin), movingRange(r)],
    sum: (r) => r.km,
    sumWords: (t) => `${km1(t)} km`,
    kpis: (rows) => [
      { label: 'Vehicles', value: n(rows.length) },
      { label: 'Farthest', value: rows[0] ? `${km1(rows[0].km)} km` : '-' },
      { label: 'Night distance', value: `${km1(rows.reduce((s, r) => s + r.km, 0))} km` },
    ],
    empty: 'No vehicle drove during the night hours in this period.',
  },

  overspeed: {
    key: 'overspeed',
    /** Columns from this index on are figures: right-aligned. */
    num: 3,
    label: 'Overspeeding',
    title: 'Overspeeding Report',
    preset: 'today',
    // Mufindi reads it weekly (10 Nov 2026): its daily figures are on the end of shift sheet
    presetFor: { KASULU: 'lastWeek' },
    spans: [7, 31],
    maxDays: 31,
    columns: () => ['Vehicle', 'Type', 'Driver', 'Overspeeds', 'Time over', 'Distance, km', 'Top / limit', 'Top speed at', 'Location'],
    /** Not figures, though after `num`: left as words. */
    text: ['Top speed at', 'Location'],
    cells: (r, ctx) => [
      vehicleCell(r), typeOf(r), clean(r.driver), String(r.count), minutesWords(r.seconds / 60),
      km2(r.km), Number.isFinite(r.peakKmh) ? `${Math.round(r.peakKmh)} / ${Math.round(r.limitKmh)} km/h` : '',
      peakTimeWords(r.peakAt, ctx),
      peakPlaceWords(r),
    ],
    sum: (r) => r.km,
    sumWords: (t) => `${km2(t)} km`,
    kpis: (rows) => [
      { label: 'Vehicles', value: n(rows.length) },
      { label: `Overspeeds over ${OVERSPEED_MIN_SEC} s`, value: n(rows.reduce((s, r) => s + r.count, 0)) },
      { label: 'Time over', value: minutesWords(rows.reduce((s, r) => s + r.seconds, 0) / 60) },
      { label: 'Distance overspeeding', value: `${km2(rows.reduce((s, r) => s + r.km, 0))} km` },
    ],
    empty: `No overspeeding longer than ${OVERSPEED_MIN_SEC} seconds in this period.`,
  },

  utilisation: {
    key: 'utilisation',
    /** Columns from this index on are figures: right-aligned. */
    num: 2,
    label: 'Vehicle utilization',
    title: 'Vehicle Utilization Report',
    preset: 'today',
    maxDays: 7,
    // Mufindi (ctx.rated): each unit against the register, in its own basis.
    columns: (ctx) => (ctx?.rated
      ? ['Vehicle', 'Type', 'Distance, km', 'Engine hours', 'Fuel used, L', 'Standard', 'Consumption', 'Against standard']
      : ['Vehicle', 'Type', 'Distance, km', 'Moving', 'Fuel used, L', `Consumption, ${rateOf(ctx).unit}`]),
    cells: (r, ctx) => {
      if (ctx?.rated) {
        return r.noData
          ? [vehicleCell(r), typeOf(r), 'No data', '', '', rateText(r.std, r.basis), '', '']
          : [vehicleCell(r), typeOf(r), km1(r.km), hoursText(r.engineOnMin), fuelUsed(r),
            r.basis ? rateText(r.std, r.basis) : 'No standard', r.basis ? rateText(r.actual, r.basis) : '-', againstWords(r.over)];
      }
      return r.noData
        ? [vehicleCell(r), typeOf(r), 'No data', '', '', '']
        : [vehicleCell(r), typeOf(r), km1(r.km), minutesWords(r.movingMin), fuelUsed(r), consumption(r, ctx)];
    },
    sum: (r) => r.km,
    sumWords: (t) => `${km1(t)} km`,
    kpis: (rows) => {
      const moved = rows.filter((r) => r.km >= 1).length;
      const noData = rows.filter((r) => r.noData).length;
      const still = rows.length - moved - noData;
      return [
        { label: 'Vehicles', value: n(rows.length) },
        { label: 'Moved', value: n(moved) },
        { label: 'Remained stationary', value: n(still), tone: still ? 'fuel' : undefined },
        ...(noData ? [{ label: 'No data', value: n(noData) }] : []),
        ...(rows.some(fuelSuspect) ? [{ label: 'Check fuel sensor', value: n(rows.filter(fuelSuspect).length), tone: 'speed' }] : []),
        ...(rows.some((r) => r.basis) ? (() => {
          // Fuel above standard: what the over-standard units used beyond what the register allows.
          const above = rows.filter((r) => r.over > 0).reduce((s, r) => s + r.usedL - r.usedL / (1 + r.over), 0);
          return [
            { label: 'Over standard', value: n(rows.filter(overStandard).length), tone: rows.some(overStandard) ? 'speed' : undefined },
            { label: 'Fuel above standard', value: `${km1(above)} L` },
          ];
        })() : []),
        { label: 'Total distance', value: `${km1(rows.reduce((s, r) => s + r.km, 0))} km` },
      ];
    },
    empty: 'No vehicles to report.',
  },

  // Excavators and dozers, a row per machine per hour, or per day (Mufindi,
  // operator 16 Nov 2026: "an hourly report"): engine hours and fuel, current
  // to the hour. Area worked was taken out the same day: it is measured
  // overnight, and held the report to yesterday.
  machinery: {
    key: 'machinery',
    /** Columns from this index on are figures: right-aligned. */
    num: 3,
    label: 'Machinery',
    title: 'Machinery Report',
    preset: 'today',
    maxDays: 7,
    columns: (ctx) => ['Machine', 'Type', ctx?.byDay ? 'Day' : 'Hour', 'Engine hours', 'Fuel used, L', 'Burn rate, L/h', 'Actual, L/h'],
    cells: (r, ctx) => [
      vehicleCell(r), typeOf(r), machineWhen(r, ctx),
      fixed(r.hours, 1) + (r.hoursFrom === 'ignition' ? '*' : ''),
      r.fuelSeen ? km1(r.usedL) : r.fuelSensor ? '-' : 'No sensor',
      r.std != null ? fixed(r.std, 1) : '-',
      r.actual != null ? fixed(r.actual, 1) : '-',
    ],
    /** The row, against the burn rate: green at or below it, red above (operator, 16 Nov 2026: "the whole row"). */
    rowTone: (r) => (r.vsStd === 'within' ? 'good' : r.vsStd === 'above' ? 'bad' : null),
    /**
     * How deep the row's colour: the further under the burn rate, the darker the
     * green; the further over, the darker the red (operator, 16 Nov 2026). 0 is on
     * the rate, 1 is no fuel at all, or double the rate and more.
     */
    rowDepth: (r) => (!r.vsStd || !(r.std > 0) ? 0
      : Math.min(1, Math.max(0, r.vsStd === 'within' ? 1 - r.actual / r.std : r.actual / r.std - 1))),
    sum: (r) => r.hours,
    sumWords: (t) => `${fixed(t, 1)} engine hours`,
    // The machines that ran, not the rows: a period across an hour mark gives a machine
    // two rows, and "42 machine-hours" read as hours worked (operator, 16 Nov 2026)
    countWords: (rows) => {
      const m = new Set(rows.map((r) => r.unit.key)).size;
      return `${n(m)} machine${m === 1 ? '' : 's'}`;
    },
    kpis: (rows) => {
      const hours = rows.reduce((s, r) => s + r.hours, 0);
      // Litres over the hours of the rows with a fuel reading, as they are
      const fuelled = rows.filter((r) => r.fuelSeen);
      const fH = fuelled.reduce((s, r) => s + r.hours, 0);
      const fL = fuelled.reduce((s, r) => s + r.usedL, 0);
      return [
        { label: 'Machines', value: n(new Set(rows.map((r) => r.unit.key)).size) },
        { label: 'Engine hours', value: `${fixed(hours, 1)} h` },
        { label: 'Fuel used', value: `${km1(fL)} L` },
        { label: 'Average burn', value: fH > 0 ? `${fixed(fL / fH, 1)} L/h` : '-' },
        { label: 'Within burn rate', value: n(rows.filter((r) => r.vsStd === 'within').length) },
        { label: 'Above burn rate', value: n(rows.filter((r) => r.vsStd === 'above').length), tone: rows.some((r) => r.vsStd === 'above') ? 'speed' : undefined },
      ];
    },
    empty: 'No excavator or dozer ran in this period.',
  },
};

const machineDayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' });
/** "Sun 15 Nov", from a fleet day key. */
const machineDay = (key) => machineDayFmt.format(Date.parse(`${key}T12:00:00Z`)).replace(/,/g, '');
/**
 * The Hour (or Day) cell, saying no more than the period at the top does not
 * (operator, 16 Nov 2026): blank over a single hour or day, so the column is
 * left out; the hour alone within one day; the day and hour across several.
 */
function machineWhen(r, ctx) {
  if (ctx?.oneWindow) return '';
  if (r.hour == null) return machineDay(r.day);
  return ctx?.oneDay ? machineHour(r) : `${machineDay(r.day)} ${machineHour(r)}`;
}
/** "14:00–15:00", Nairobi; an hour cut short by the period ends where it does ("14:00–14:37"). */
const machineHour = (r) => `${clockOnly.format(r.from)}–${r.to % 3_600_000 === 0 ? clockOnly.format(r.to).replace(/^00:/, '24:') : clockOnly.format(r.to)}`;

/** Columns left out when no vehicle in the report has a value in them (operator, 1 Nov 2026). */
const OPTIONAL = ['Type', 'Driver', 'Location', 'Hour', 'Day'];

/**
 * The indexes of the columns to show for these rows: every column, less a
 * Type or Driver column that is blank (or "UNSPECIFIED") for every vehicle.
 */
export function shownColumns(def, rows, ctx) {
  const heads = def.columns(ctx);
  const all = rows.map((r) => def.cells(r, ctx));
  return heads.map((h, i) => i).filter((i) => !OPTIONAL.includes(heads[i]) || all.some((c) => !isBlank(c[i])));
}

/** Is column i a figure (right-aligned)? */
export const isFigure = (def, heads, i) => i >= def.num && !def.text?.includes(heads[i]);

// Machinery is not here: it is a tab under Movements (operator, 16 Nov 2026), not a node of its own
export const REPORT_ORDER = ['behaviour', 'night', 'overspeed', 'utilisation'];

/** The CSV: one flat table, the group as its first column. */
export function csvTable(def, secs, ctx) {
  const grouped = secs.some((s) => s.name);
  const keep = shownColumns(def, secs.flatMap((s) => s.rows), ctx);
  const pick = (list) => keep.map((i) => list[i]);
  return {
    head: [...(grouped ? ['Group'] : []), ...pick(def.columns(ctx))],
    body: secs.flatMap((s) => s.rows.map((r) => [...(grouped ? [s.name] : []), ...pick(def.cells(r, ctx))])),
  };
}

// ── One unit's overspeeds, each on its own row ────────────────────────────────

const eventDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const eventClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const fmt = (f, ms) => (Number.isFinite(ms) ? f.format(ms).replace(',', '') : '-');
/** 45 s, 1 min 05 s */
export function secondsWords(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
const kmh = (x) => (Number.isFinite(x) ? `${Math.round(x)}` : '-');

/**
 * The events table of a report made for one unit (lib/fleetReports
 * overspeedEvents): on the page, the PDF and the CSV. Driver is left out
 * when no event names one.
 */
export function overspeedEventTable(events) {
  const driver = events.some((e) => e.driver);
  const head = ['#', 'Started', 'Ended', 'Peak at', 'Duration', 'Peak / limit km/h', 'Avg km/h', 'Distance, km', ...(driver ? ['Driver'] : []), 'Where (at the peak)'];
  const rows = events.map((e, i) => [
    String(i + 1), fmt(eventDay, e.startedAt), fmt(eventClock, e.endedAt), fmt(eventClock, e.peakAt), secondsWords(e.durationSec),
    `${kmh(e.peakKmh)} / ${kmh(e.limitKmh)}`, kmh(e.avgKmh), e.km == null ? '-' : km2(e.km),
    ...(driver ? [e.driver ?? '-'] : []),
    e.lat == null || e.lng == null ? '-' : `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`,
  ]);
  /** Figures (right-aligned): Duration to Distance */
  const num = (i) => i >= 4 && i <= 7;
  return { head, rows, num, driver };
}
