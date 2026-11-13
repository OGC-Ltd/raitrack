// Menengai's Fuel Consumption Rate sheet, as their own (operator, 13 Nov 2026: "can we make the template
// look exactly like this for Menengai? even the colours"): Reg to Comment in their columns, the "With
// Thefts" pair under an orange head, the "Minus Thefts" pair under a green one, the rest light blue; the
// last rate shaded green (best) to yellow (worst) as Excel's colour scale does; best rate first.
//
// Read off the server's rows (reports/fuel-consumption-rate): the tank at the start and end, the refills
// and the thefts the ledger holds, the distance. Missed fillings, fuel MORL recorded but the tracker did
// not, and return pipe theft are MORL's own figures, not the tracker's: blank here, typed in with Edit.
//
// Pure: no React, no network.

import { reportNumber } from './reportLetterhead';

export const MORL_ORG = 'MENENGAI';
/** Menengai's own template, for its organisation only. */
export const isMorlFcr = (orgCode) => String(orgCode ?? '').toUpperCase() === MORL_ORG;

const BLUE = '#9dc3e6';
const ORANGE = '#ffc000';
const GREEN = '#00b050';

/** Their heads, in their order, with each head's fill. */
export const MORL_FCR_COLUMNS = [
  { head: 'Reg', fill: BLUE },
  { head: 'Target Consumption', fill: BLUE },
  { head: 'Missed Fillings', fill: BLUE },
  { head: 'Missing (Recorded by MORL, Missing on Track3)', fill: BLUE },
  { head: 'Actual Theft', fill: BLUE },
  { head: 'Return Pipe Theft', fill: BLUE },
  { head: 'Total Distance Covered', fill: BLUE },
  { head: 'Initial Level', fill: BLUE },
  { head: 'Amount Filled', fill: BLUE },
  { head: 'Final Level', fill: BLUE },
  { head: 'Amnt Consumed (With Thefts)', fill: ORANGE },
  { head: 'Consumption Rate (With Thefts)', fill: ORANGE },
  { head: 'Amnt Consumed (Minus Thefts)', fill: GREEN },
  { head: 'Consumption Rate (Minus Thefts)', fill: GREEN },
  { head: 'Comment', fill: null },
];
export const MORL_FCR_HEADS = MORL_FCR_COLUMNS.map((c) => c.head);
export const MORL_FCR_HEAD_FILLS = MORL_FCR_COLUMNS.map((c) => c.fill);
/** The column the colour scale runs down. */
export const RATE_COL = 13;

const num = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Number(n));
const r2 = (n) => Math.round(n * 100) / 100;
/** 57.57, 125, 0: as their sheet writes figures. */
export const fig = (n) => (num(n) == null ? '' : String(r2(num(n))));

/** Each row with their figures; best rate (minus thefts) first, those without one last. */
export function morlFcrRows(rows) {
  return (rows ?? []).map((r) => {
    const theftL = num(r.theftL) ?? 0;
    const minusL = num(r.consumedL);
    const withL = minusL != null ? minusL + theftL : null;
    const km = num(r.distanceKm);
    const rateOf = (l) => (l != null && l > 0 && km != null && km >= 1 ? km / l : null);
    const minusRate = num(r.kmPerL) ?? rateOf(minusL);
    return {
      ...r,
      targetKmPerL: num(r.target?.kmPerL),
      theftL,
      withL,
      withRate: rateOf(withL),
      minusL,
      minusRate,
      words: r.note || (minusRate != null ? 'PROBE OK' : ''),
    };
  }).sort((a, b) => (b.minusRate ?? -Infinity) - (a.minusRate ?? -Infinity) || String(a.plate).localeCompare(String(b.plate)));
}

/** A row's fifteen cells, as MORL_FCR_HEADS. */
export function morlFcrCells(r) {
  return [
    r.plate ?? '',
    r.targetKmPerL != null ? fig(r.targetKmPerL) : (r.target?.words ?? ''),
    '', '',                                  // Missed fillings, Missing: MORL's figures
    fig(r.theftL),
    '',                                      // Return pipe theft: MORL's figure
    fig(r.distanceKm), fig(r.startL), fig(r.filledL), fig(r.endL),
    fig(r.withL), r.withRate != null ? r.withRate.toFixed(2) : '',
    fig(r.minusL), r.minusRate != null ? r.minusRate.toFixed(2) : '',
    r.words,
  ];
}

const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const SCALE_TOP = [0x63, 0xbe, 0x7b];     // Excel's green
const SCALE_LOW = [0xff, 0xeb, 0x84];     // Excel's yellow
/** The colour scale over these rates: the best green, the worst yellow, between in step; null for no rate. */
export function rateScale(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return (x) => {
    if (x == null || !Number.isFinite(x) || !v.length) return null;
    const t = hi > lo ? (x - lo) / (hi - lo) : 1;
    return hex(SCALE_LOW.map((c, i) => c + (SCALE_TOP[i] - c) * t));
  };
}

/** The table as cells with their fills: their head row first, then the rows. */
export function morlFcrTable(rows) {
  const list = morlFcrRows(rows);
  const shade = rateScale(list.map((r) => r.minusRate));
  const body = list.map((r) => morlFcrCells(r).map((text, i) => ({
    text,
    ...(i === RATE_COL && shade(r.minusRate) ? { fill: shade(r.minusRate) } : {}),
  })));
  return { list, body };
}

const OFFSET = 3 * 3_600_000;
const dmy = (day) => { const [y, m, d] = String(day).split('-'); return `${Number(d)}.${m}.${y}`; };
const dmyOf = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };

/** Widths in mm on a landscape page (271 mm), their columns' proportions. */
const WIDTHS = [26, 13, 13, 22, 12, 12, 15, 13, 14, 13, 16, 16, 16, 18, 30];

/**
 * The PDF (POST reports/document.pdf). Its table heads cannot be coloured there, so their head row is
 * the table's first row, each cell filled as theirs.
 */
export function fcrMorlDoc(rows, { from, to, fleet, orgCode, now = Date.now() }) {
  const { list, body } = morlFcrTable(rows);
  const used = WIDTHS.reduce((a, x) => a + x, 0);
  const cols = WIDTHS.map((w, i) => ({ w: Math.round(((w * 271) / used) * 10) / 10, wrap: true, ...(i > 0 && i < 14 ? { align: 'right' } : {}) }));
  const headRow = MORL_FCR_COLUMNS.map((c) => ({ text: c.head, bold: true, ...(c.fill ? { fill: c.fill } : {}) }));
  const range = `${dmy(from)} TO ${dmy(to)}`;
  return {
    title: 'FUEL CONSUMPTION RATE REPORT',
    docName: `Fuel Consumption Rate Report ${fleet}`,
    filename: `Fuel Consumption Rate Report ${fleet} ${from}${from !== to ? ` to ${to}` : ''}`,
    reportNo: reportNumber('FC', orgCode, now),
    date: dmyOf(now),
    meta: [['Fleet', fleet], [from !== to ? 'Days' : 'Day', from !== to ? `${from} – ${to}` : from], ['Vehicles', String(list.length)]]
      .map(([label, value]) => ({ label, value: String(value) })),
    blocks: [
      { kind: 'bar', title: range, aside: `${list.length} vehicle${list.length === 1 ? '' : 's'}` },
      list.length ? { kind: 'table', cols, head: [], size: 6.6, rows: [headRow, ...body] } : { kind: 'none', text: 'No units to report in this period.' },
      { kind: 'note', text: 'Missed Fillings, Missing (Recorded by MORL, Missing on Track3) and Return Pipe Theft are MORL\'s own figures: type them in with Edit. Actual Theft is the thefts the platform recorded. Consumption Rate is km per litre; shaded green (best) to yellow (lowest).' },
    ],
    footer: `${fleet} · Fuel Consumption Rate · ${range}`,
    landscape: true,
  };
}

/** For the CSV and the Excel file: their heads with their fills, the rows with the scale. */
export function morlFcrSheet(rows) {
  const { body } = morlFcrTable(rows);
  return { head: MORL_FCR_HEADS, headFills: MORL_FCR_HEAD_FILLS, body };
}
