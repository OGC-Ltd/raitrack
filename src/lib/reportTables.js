// How each report reads as a table: its columns, a row's cells, the figures
// at the top, and the total each group carries. One definition feeds the
// screen, the PDF and the CSV, so the three can never disagree.
//
// Pure: no React.

import { km1, km2, minutesWords, OVERSPEED_MIN_SEC, OVER_STANDARD } from './fleetReports';
import { statusWord } from './followUp';

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

export const REPORTS = {
  behaviour: {
    key: 'behaviour',
    /** Columns from this index on are figures: right-aligned. */
    num: 3,
    label: 'Driver behaviour',
    title: 'Driver Behaviour Report',
    icon: 'ti-steering-wheel',
    preset: 'today',
    maxDays: 7,
    /** The dashcam keeps its alarms 7 days, so a period must start within them. */
    reachDays: 7,
    blurb: 'Each vehicle’s harsh acceleration and braking, and its no-seatbelt, on-phone and camera-covered incidents: from the dashcams and from what operators logged.',
    columns: () => ['Vehicle', 'Type', 'Driver', 'Harsh acceleration', 'Harsh braking', 'No seatbelt', 'On phone', 'Camera covered', 'Total', 'Follow-up'],
    /** Columns of words after the figures: left-aligned. */
    text: ['Follow-up'],
    cells: (r, ctx) => {
      // A unit without a dashcam cannot report these itself: a dash, not a
      // zero, unless an operator logged one.
      const cam = (k) => (r.dashcam || r.manual?.[k] ? String(r[k]) : '–');
      return [vehicleCell(r) + (r.suspect ? ' (check sensor)' : ''), typeOf(r), clean(r.driver),
        String(r.accel), String(r.brake), cam('seatbelt'), cam('phone'), cam('covered'), String(r.total),
        statusWord(ctx?.followUp?.get(r.unit.key), ctx?.now)];
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
        { label: 'No seatbelt', value: n(sum('seatbelt')) },
        { label: 'On phone', value: n(sum('phone')) },
        { label: 'Camera covered', value: n(sum('covered')) },
        ...(suspect ? [{ label: 'Check sensor', value: n(suspect), tone: 'speed' }] : []),
        { label: 'Total incidents', value: n(rows.reduce((s, r) => s + r.total, 0)) },
      ];
    },
    empty: 'No harsh driving, seatbelt, phone or camera-covered incidents in this period.',
  },

  night: {
    key: 'night',
    /** Columns from this index on are figures: right-aligned. */
    num: 2,
    label: 'Night driving',
    title: 'Night Driving Report',
    icon: 'ti-moon',
    preset: 'lastNight',
    maxDays: 7,
    blurb: 'Each vehicle that drove during the night hours, and how far.',
    columns: () => ['Vehicle', 'Type', 'Night distance, km', 'Time moving'],
    cells: (r) => [vehicleCell(r), typeOf(r), km1(r.km), minutesWords(r.movingMin)],
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
    icon: 'ti-dashboard',
    preset: 'yesterday',
    maxDays: 31,
    blurb: `Overspeeding that lasted more than ${OVERSPEED_MIN_SEC / 60} minutes without a break, and the distance covered while overspeeding.`,
    columns: () => ['Vehicle', 'Type', 'Driver', 'Overspeeds', 'Time over', 'Distance, km', 'Top / limit'],
    cells: (r) => [
      vehicleCell(r), typeOf(r), clean(r.driver), String(r.count), minutesWords(r.seconds / 60),
      km2(r.km), Number.isFinite(r.peakKmh) ? `${Math.round(r.peakKmh)} / ${Math.round(r.limitKmh)} km/h` : '',
    ],
    sum: (r) => r.km,
    sumWords: (t) => `${km2(t)} km`,
    kpis: (rows) => [
      { label: 'Vehicles', value: n(rows.length) },
      { label: `Overspeeds over ${OVERSPEED_MIN_SEC / 60} min`, value: n(rows.reduce((s, r) => s + r.count, 0)) },
      { label: 'Time over', value: minutesWords(rows.reduce((s, r) => s + r.seconds, 0) / 60) },
      { label: 'Distance overspeeding', value: `${km2(rows.reduce((s, r) => s + r.km, 0))} km` },
    ],
    empty: `No overspeeding longer than ${OVERSPEED_MIN_SEC / 60} minutes in this period.`,
  },

  utilisation: {
    key: 'utilisation',
    /** Columns from this index on are figures: right-aligned. */
    num: 2,
    label: 'Vehicle utilization',
    title: 'Vehicle Utilization Report',
    icon: 'ti-road',
    preset: 'yesterday',
    maxDays: 7,
    blurb: 'Every vehicle, the distance it covered and the fuel it used, stationary vehicles included.',
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
};

/** Columns left out when no vehicle in the report has a value in them (operator, 1 Nov 2026). */
const OPTIONAL = ['Type', 'Driver'];

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
