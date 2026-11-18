// The Weighbridges PDFs as the sheets the server draws (operator, 18 Nov 2026: "let
// them use the ones we are using in the pages like movements"): Tickets, Coverage
// and Analytics are posted to reports/document.pdf like Fuel Consumption Rate and
// every edited report, so they come out on the same letterhead, either way up, as
// a JPEG and in the Preview, and open in Edit.
//
// The server prints a table's heads on one line and shrinks set widths to fit an
// upright page (fleet-server lib/pdf/letterhead table), so columns are sized here
// from their text at landscape width.
//
// Pure: no React, no network.

import { reportNumber } from './reportLetterhead';
import { textMm } from './shiftDoc';
import { FIELDS } from './weighbridgeBoard';

/** The server's limits on one document (fleet-server reports/report.schema reportDocSchema). */
export const MAX_TABLE_ROWS = 5000;
const MAX_BLOCKS = 300;

const SIZE = 7.2;
const HEAD_PT = 7.2;
const PAD_MM = 3.8;
const MIN_MM = 9;
const MAX_MM = 46;
const OFFSET = 3 * 3600_000;

const fmt = (n, d = 0) => Number(n ?? 0).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const t1 = (kg) => (kg == null ? '-' : fmt(kg / 1000, 1));
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const dmy = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };
const hm = (ms) => new Date(ms + OFFSET).toISOString().slice(11, 16);
const dmyhm = (ms) => `${dmy(ms).slice(0, 5)} ${hm(ms)}`;
const meta = (pairs) => pairs.filter(([, v]) => v != null && v !== '').slice(0, 8).map(([label, value]) => ({ label, value: String(value) }));

const LONG_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/** The days a report covers, in full: "17 Nov 2026", "10 Nov 2026 – 17 Nov 2026". */
export function spanWords(from, to = from) {
  const day = (k) => LONG_DAY.format(Date.parse(`${k}T12:00:00Z`));
  return from === to ? day(from) : `${day(from)} – ${day(to)}`;
}

/** "3h 24m", "18m". */
export function gapWords(ms) {
  if (ms == null) return '-';
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

// A figure: grouped, or short; a long run of digits is a token or a number to read, not to add
const NUMERIC = /^[-+]?(\d{1,3}(,\d{3})+|\d{1,6})(\.\d+)?( ?(t|kg|km))?$/;
/** A cell's words, whether it came as text or as a cell. */
const words = (c) => (c && typeof c === 'object' ? String(c.text ?? '') : String(c ?? ''));

/**
 * Columns from what they hold: each as wide as its heading and most of its cells (the
 * 95th widest, so one long name does not set the column), between MIN_MM and MAX_MM.
 * `flex` takes the room left and wraps; a column of figures is set right.
 */
export function fitCols(head, rows, { flex = -1, wrap = [], size = SIZE } = {}) {
  return head.map((h, i) => {
    const cells = rows.map((r) => words(r[i])).filter(Boolean);
    const right = cells.length > 0 && cells.every((c) => NUMERIC.test(c) || c === '-');
    if (i === flex) return { w: 0, wrap: true, ...(right ? { align: 'right' } : {}) };
    const widths = cells.map((c) => textMm(c, size, i === 0)).sort((a, b) => a - b);
    const body = widths.length ? widths[Math.min(widths.length - 1, Math.floor(widths.length * 0.95))] : 0;
    const w = Math.min(MAX_MM, Math.max(MIN_MM, textMm(h, HEAD_PT, true), body) + PAD_MM);
    return { w: Math.round(w * 10) / 10, ...(right ? { align: 'right' } : {}), ...(wrap.includes(i) || w >= MAX_MM ? { wrap: true } : {}) };
  });
}

const cellOf = (text, bold = false) => ({ text: String(text ?? '').slice(0, 600), ...(bold ? { bold: true } : {}) });

/** A table, cut into the server's largest; the first column bold. */
function tables(head, rows, opts = {}) {
  const cols = opts.cols ?? fitCols(head, rows, opts);
  const out = [];
  for (let i = 0; i < rows.length; i += MAX_TABLE_ROWS) {
    out.push({
      kind: 'table', cols, head, size: SIZE,
      rows: rows.slice(i, i + MAX_TABLE_ROWS).map((r) => r.map((c, k) => (typeof c === 'object' && c ? c : cellOf(c, k === 0)))),
    });
  }
  return out;
}

/**
 * A weighbridge report: the letterhead's facts, an overview of figures, then each
 * section's heading and table, numbered.
 */
export function weighbridgeDoc({ title, filename, fleet, orgCode, prefix = 'WB', now = Date.now(), facts = [], figures = [], sections = [], note = '', footer, landscape = true }) {
  const blocks = [];
  let n = 1;
  if (figures.length) {
    blocks.push({ kind: 'h2', title: `${n}. Overview`, aside: footer });
    blocks.push({ kind: 'figures', items: figures.slice(0, 12).map(({ label, value }) => ({ label, value: String(value) })) });
    n += 1;
  }
  for (const s of sections) {
    blocks.push({ kind: 'h2', title: `${n}. ${s.title}`, ...(s.aside ? { aside: s.aside } : {}) });
    if (s.rows.length) blocks.push(...tables(s.head, s.rows, s));
    else blocks.push({ kind: 'none', text: s.none ?? 'Nothing to show.' });
    n += 1;
  }
  if (note) blocks.push({ kind: 'note', text: note });
  return {
    title: title.toUpperCase(),
    docName: `${title} ${fleet}`.trim(),
    pairs: true,
    filename: filename.slice(0, 200),
    reportNo: reportNumber(prefix, orgCode, now),
    date: dmy(now),
    meta: meta([['Fleet', fleet], ...facts]),
    blocks: blocks.slice(0, MAX_BLOCKS),
    footer: `${fleet} · ${title} · ${footer}`,
    landscape,
  };
}

/** The Tickets columns an upright page keeps: what a clerk checks a ticket by. */
export const TICKET_UPRIGHT = ['Time', 'Vehicle', 'Driver', 'Type', 'Token', 'Centre', 'Tare (kg)', 'Tare at', 'Gross (kg)', 'Gross at', 'Net (kg)', 'Load time'];
const TICKET_NO = 'Ticket no. today';
const TICKETS_TODAY = 'Tickets today';
/** The page's heads, short so the Driver column keeps its room; the file's stay as they are. */
const SHORT_HEAD = {
  'Tare (kg)': 'Tare, kg', 'Gross (kg)': 'Gross, kg', 'Net (kg)': 'Net, kg', 'Payload (t)': 'Payload, t',
  [TICKET_NO]: 'Today', 'Since previous': 'Since last',
};

/**
 * Weighbridges › Tickets: the export's rows (WeighbridgesScreen exportBody, the date
 * first), a section a day in the order they are on screen, the date in its heading.
 * Upright pages keep TICKET_UPRIGHT; landscape ones every column.
 */
export function ticketsDoc({ head, body, fleet, orgCode, bridge, span, search = '', netKg, landscape = true, now = Date.now() }) {
  // With one bridge picked, its name is in the facts and Centre would say it on every row
  const keep = head.map((h, i) => (i > 0 && (landscape || TICKET_UPRIGHT.includes(h)) && h !== TICKETS_TODAY && !(bridge && h === 'Centre') ? i : -1))
    .filter((i) => i >= 0);
  const no = head.indexOf(TICKET_NO);
  const of = head.indexOf(TICKETS_TODAY);
  const stamps = new Set(['Tare at', 'Gross at'].map((h) => head.indexOf(h)));
  const days = new Map();
  for (const r of body) {
    const d = r[0] || 'No date';
    // A weighing on the section's own day by its clock alone; one the day before keeps its date
    const sameDay = `${String(d).slice(0, 5)} `;
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(keep.map((i) => {
      if (i === no) return of >= 0 && r[of] !== '' && r[of] != null ? `${r[no]} of ${r[of]}` : r[no];
      if (stamps.has(i) && String(r[i]).startsWith(sameDay)) return String(r[i]).slice(sameDay.length);
      return r[i];
    }));
  }
  const cut = head.filter((_, i) => keep.includes(i)).map((h) => SHORT_HEAD[h] ?? h);
  const flex = cut.indexOf('Driver');
  const all = [...days.values()].flat();
  // One set of widths for every day, so the days' columns line up page to page
  const cols = fitCols(cut, all, { flex, wrap: [cut.indexOf('Centre')] });
  const sections = [...days].map(([day, rows]) => ({ title: day, aside: plural(rows.length, 'ticket'), head: cut, rows, cols }));
  const where = bridge || 'All weighbridges';
  return weighbridgeDoc({
    title: `Weighbridge Tickets${bridge ? `: ${bridge}` : ''}`,
    filename: `Weighbridge Tickets ${fleet} ${where} ${span}`,
    fleet, orgCode, now, landscape,
    facts: [['Weighbridge', where], ['Period', span], ['Tickets', fmt(body.length)], ['Net weighed', `${fmt(netKg / 1000, 2)} t`], ['Matching', search.trim()]],
    figures: [
      { label: 'Tickets', value: fmt(body.length) },
      { label: 'Net weighed, t', value: fmt(netKg / 1000, 2) },
      { label: 'Days', value: fmt(days.size) },
    ],
    sections,
    footer: span,
  });
}

/** Weighbridges › Tickets › Coverage, as the table is on screen (WeighbridgeCoverage head/body). */
export function coverageDoc({ title, head, body, figures, fleet, orgCode, bridge, span, search = '', consolidated = false, landscape = true, now = Date.now() }) {
  const flex = head.indexOf('Driver') >= 0 ? head.indexOf('Driver') : head.indexOf('Weighbridges');
  return weighbridgeDoc({
    title, fleet, orgCode, now, landscape,
    filename: `${title} ${fleet} ${span}`,
    facts: [['Weighbridge', bridge || 'All weighbridges'], ['Period', span], ['Rows', consolidated ? 'One a unit' : 'One a unit a day'], ['Units matching', search.trim()]],
    figures,
    sections: [{ title: head[0] === 'Unit' ? 'By unit' : 'By unit and day', aside: plural(body.length, 'row'), head, rows: body, flex, none: 'No unit crossed a weighbridge.' }],
    note: 'A trip is a ticket weighed loaded. Km per trip is measured from the odometer when the unit left empty to when it came back loaded. Distance is the unit\'s whole day from its tracker, and where a trip left the evening before or came back the morning after, the part of it driven outside the day too, so a trip is never longer than its row\'s distance. Blank where a unit has no tracker or no reading.',
    footer: span,
  });
}

/** The yards' rows of vehicles out, the mill left out, farm runs as "Fields" (WeighbridgeBoard). */
export function roadByYard(sites, units) {
  const out = sites.filter((s) => !s.factory).map((s) => {
    const list = units.filter((u) => u.code === s.code);
    return { code: s.code, name: s.name, units: list, kg: list.reduce((n, x) => n + (x.netKg ?? 0), 0) };
  });
  const fields = units.filter((u) => u.code === FIELDS || !sites.some((s) => s.code === u.code && !s.factory));
  if (fields.length) out.push({ code: FIELDS, name: 'Fields', units: fields, kg: 0 });
  return out;
}

const TYPE = { TRUCK: 'Truck', TRACTOR: 'Tractor' };

/**
 * Weighbridges › Analytics: the board (lib/weighbridgeBoard buildBoard) and the units out
 * (roadUnits). The strip's figures, a row a weighbridge, the vehicles on the road, and
 * the cane flow as running totals: hourly over a day, at each day's end over a span.
 */
export function boardDoc(board, units, { fleet, orgCode, span, landscape = true, now = Date.now() }) {
  const { totals, sites, flow, spanDays, closed } = board;
  const several = spanDays > 1;
  const avgLoad = totals.receivedTrips > 0 ? totals.receivedKg / totals.receivedTrips : null;
  const expected = avgLoad == null ? null : totals.openTickets * avgLoad;
  const arrivedKg = sites.reduce((n, s) => n + (s.arrivedKg ?? 0), 0);

  // Short labels: ten figures share one row on the page; the note says what each is
  const figures = [
    { label: 'Received, t', value: t1(totals.receivedKg) },
    { label: 'Field trips', value: fmt(totals.receivedTrips) },
    { label: 'Dispatched, t', value: t1(totals.dispatchedKg) },
    { label: 'Transfer runs', value: fmt(totals.dispatchedRuns) },
    { label: 'At the mill, t', value: t1(arrivedKg) },
    { label: 'On the road', value: `${fmt(totals.onRoadRuns)}, ${t1(totals.onRoadKg)} t` },
    { label: 'Expected, t', value: expected == null ? '-' : t1(expected) },
    { label: 'Book move, t', value: `${totals.bookMoveKg > 0 ? '+' : ''}${t1(totals.bookMoveKg)}` },
    { label: 'Lorries', value: fmt(totals.lorries) },
    { label: 'Bridges', value: `${fmt(totals.bridgesReporting)} of ${fmt(totals.bridges)}` },
  ];

  const siteHead = ['Weighbridge', 'Kind', 'Last weighing', 'Received, t', 'Loads in', 'Sent or weighed in, t', 'Runs', 'Book, t', 'Out empty', 'On the road', 'Lorries'];
  const siteRows = sites.map((s) => {
    const mill = s.factory;
    return [
      s.name, mill ? 'Mill' : 'Yard',
      s.lastAt == null ? 'Nothing weighed' : several ? dmyhm(s.lastAt) : hm(s.lastAt),
      t1(s.receivedKg), fmt(s.receivedTrips),
      t1(mill ? s.arrivedKg : s.dispatchedKg), fmt(mill ? s.arrivedRuns : s.dispatchedRuns),
      t1(mill ? s.receivedKg + s.arrivedKg : s.bookMoveKg),
      fmt(s.openTickets), fmt(mill ? totals.onRoadRuns : s.onRoadRuns),
      fmt(s.lorries),
    ];
  });

  const yards = roadByYard(sites, units);
  const yardRows = yards.map((y) => [y.name, y.units.length ? fmt(y.units.length) : 'None out', y.kg > 0 ? t1(y.kg) : '-']);
  const yardName = new Map(yards.map((y) => [y.code, y.name]));
  const unitHead = ['Vehicle', 'Type', 'From', 'Destination', 'State', 'Out for', 'Usual run', 'Past its run'];
  const unitRows = units.map((u) => [
    u.plate, TYPE[u.type] ?? 'Other', yardName.get(u.code) ?? 'Fields', u.destination ?? '-',
    u.loaded ? `Loaded${u.netKg ? `, ${t1(u.netKg)} t` : ''}` : 'Signed out',
    gapWords(u.elapsedMs), u.typicalMs == null ? '-' : gapWords(u.typicalMs),
    u.overdue ? { text: 'Yes', bold: true, tone: 'flag' } : '',
  ]);

  // Running totals: each hour's end over one day, each day's end over more
  const points = several
    ? flow.filter((p, i) => i === flow.length - 1 || flow[i + 1].label !== p.label)
    : flow.filter((p, i) => i % 2 === 1 || i === flow.length - 1);
  const flowRows = points.map((p) => [p.label, t1(p.receivedKg), t1(p.dispatchedKg), t1(p.arrivedKg)]);
  const late = units.filter((u) => u.overdue).length;

  return weighbridgeDoc({
    title: 'Weighbridge Analytics',
    filename: `Weighbridge Analytics ${fleet} ${span}`,
    fleet, orgCode, now, landscape,
    facts: [['Period', span], ['Weighbridges', `${fmt(totals.bridgesReporting)} of ${fmt(totals.bridges)} reporting`], ['As of', closed ? 'Closed' : `${dmy(now)} ${hm(now)}`], ['Lorries', fmt(totals.lorries)]],
    figures,
    sections: [
      { title: 'By weighbridge', aside: plural(sites.length, 'weighbridge'), head: siteHead, rows: siteRows },
      { title: 'Vehicles on the road to the mill', aside: `${fmt(units.length)} out${late ? `, ${fmt(late)} past the usual run` : ''}`, head: ['Yard', 'Vehicles', 'Loaded, t'], rows: yardRows },
      ...(units.length ? [{ title: 'Each vehicle out', aside: plural(units.length, 'vehicle'), head: unitHead, rows: unitRows, flex: 3 }] : []),
      { title: several ? `Cane flow over ${spanDays} days` : closed ? 'Cane flow' : 'Cane flow so far', aside: 'running totals', head: [several ? 'Day' : 'Time', 'Received, t', 'Dispatched, t', 'Weighed in at the mill, t'], rows: flowRows, none: 'Nothing weighed yet.' },
    ],
    note: 'Received is cane weighed in off the fields; Dispatched, transfers weighed loaded at a yard for the mill; At the mill, those transfers weighed in at the factory. Every figure is a weighing except Expected: the machines weighed empty and not yet back, priced at the average load weighed. No physical yard count is in this feed, so a yard\'s Book figure is cane in less cane sent, a movement and not a heap. A lorry past its run has been out longer than the usual run to its destination, or was loaded at a yard and not weighed at the mill within four hours.',
    footer: span,
  });
}
