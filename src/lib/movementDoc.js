// The Movements PDF laid out here, as the sheet the server draws (operator,
// 4 Nov 2026: "take the drawing from the server to the front end for now"),
// so the page decides its colours: Menengai's Van Sales at the Nairobi depot
// are blue (lib/movementDepots), which the server's movements PDF cannot be
// told. The server still draws it, on its letterhead, from this document
// (POST reports/document.pdf, the same as the other edited reports), so the
// PDF looks as it did: the title, the details, the overview, a section per
// grouping, the rows' tints and the Location fills.
//
// It takes what the page sent before (lib/movementReport pdfRequests): one
// request a day, or outside Menengai one per vehicle type a day. Several make
// one PDF, a coloured bar over each.
//
// Pure: no React, no network.

import { MOMBASA_LOADING, MOVING_KMH, stamp, countRows, directionWords } from './movementReport';
import { depotAt } from './movementDepots';
import { pickedEvents, countByUnit, countCell, eventsFor, eventCells, EVENT_HEADS } from './movementEvents';

const TZ = 'Africa/Nairobi';
const DASH = '-';
/** The server's fills (fleet-server movement-report.pdf): Location cells, then the rows' tints. */
export const FILL = { loading: '#f8c08a', morl: '#fbe36b', moving: '#b5dfa6' };
export const TINT = { to: '#e3f1dc', from: '#fbe4d3', at: '#fdf3c9' };

const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).formatToParts(ms).map((p) => [p.type, p.value]));
const hm = (ms) => { const p = parts(ms); return `${p.hour}:${p.minute}hrs`; };
const dateOf = (ms) => { const p = parts(ms); return `${p.day}/${p.month}/${p.year}`; };
const longDay = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
const hoursWords = (h) => `${Number.isInteger(h) ? h : Number(h).toFixed(1)} hour${h === 1 ? '' : 's'}`;
const num = (n) => Number(n ?? 0).toLocaleString('en-GB');

/** "1 hour, 2 Nov 2026, 07:00hrs – 08:00hrs"; a window over midnight names both days. */
export function windowText(r) {
  const sameDay = longDay(r.from) === longDay(r.to - 1);
  return `${hoursWords(r.hours)}, ${longDay(r.from)}, ${hm(r.from)} – ${sameDay ? '' : `${longDay(r.to)}, `}${hm(r.to)}`;
}

const metres = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};
const loading = (row) => row.lastAt != null && !row.stale && row.lat != null && row.lng != null
  && metres(row, MOMBASA_LOADING) <= MOMBASA_LOADING.radiusM;
const moving = (row) => row.lastAt != null && !row.stale && row.state !== 'stopped' && row.state !== 'no-fix' && (row.speedKmh ?? 0) >= MOVING_KMH;

/** A row's Location fill, as the screen and the server order them: Mombasa, MORL, a depot, moving. */
export function locationFill(row, groupName, depots = []) {
  if (loading(row)) return FILL.loading;
  if (row.state === 'at') return FILL.morl;
  const d = depotAt(row, groupName, depots);
  if (d) return d.fill;
  return moving(row) ? FILL.moving : undefined;
}

const COLS = [{ w: 54 }, { w: 30 }, { w: 0, wrap: true }, { w: 15, align: 'right' }, { w: 20 }];
const HEAD = ['Grouping', 'Last coordinates', 'Location', 'Speed', 'Direction'];
const EVENT_COLS = [{ w: 30 }, { w: 30 }, { w: 36, wrap: true }, { w: 0, wrap: true }, { w: 26, wrap: true }, { w: 15 }];

/** One request's overview and sections, numbered from `n`. */
function partBlocks(q, n, depots, events) {
  const site = q.site || 'MORL';
  const words = directionWords(site);
  const c = countRows(q.groups);
  const silent = c.stale + c['no-fix'];
  const kinds = pickedEvents(events?.kinds);
  const rowsAll = q.groups.flatMap((g) => g.rows);
  const inWindow = (events?.list ?? []).filter((e) => e.at >= q.from && e.at <= q.to);
  const listed = kinds.length ? eventsFor(inWindow, rowsAll, events.kinds) : [];
  const counts = countByUnit(listed);
  const blocks = [
    { kind: 'h2', title: `${n}. Overview`, aside: windowText(q) },
    { kind: 'figures', items: [
      { label: 'Vehicles', value: num(c.total) },
      { label: `Heading to ${site}`, value: num(c.to) },
      { label: `Leaving ${site}`, value: num(c.from) },
      { label: `At ${site}`, value: num(c.at) },
      { label: 'Stopped elsewhere', value: num(c.stopped) },
      { label: 'Not reporting', value: num(silent), flag: silent > 0 },
    ] },
  ];
  q.groups.forEach((g, i) => {
    const tally = (s) => g.rows.filter((x) => x.state === s).length;
    const aside = [`${g.rows.length} vehicle${g.rows.length === 1 ? '' : 's'}`,
      tally('to') ? `${tally('to')} to ${site}` : null, tally('from') ? `${tally('from')} from ${site}` : null,
      tally('at') ? `${tally('at')} at ${site}` : null,
      tally('sto-at') ? `${tally('sto-at')} at STO` : null].filter(Boolean).join(' · ');
    blocks.push({ kind: 'h2', title: `${n + 1 + i}. ${g.name}`, aside });
    blocks.push({
      kind: 'table', size: 7.6, cols: COLS, head: HEAD,
      rows: g.rows.map((row) => {
        const tint = TINT[row.state];
        const silentRow = row.stale || row.state === 'no-fix';
        const cell = (text, extra = {}) => ({ text: String(text ?? DASH), ...(tint ? { fill: tint } : {}), ...extra });
        const place = locationFill(row, g.name, depots);
        return [
          cell(row.grouping ?? row.plate, { bold: true, ...(silentRow ? { tone: 'flag' } : {}) }),
          cell(row.lastAt != null ? stamp(row.lastAt) : DASH, row.stale ? { tone: 'flag' } : {}),
          cell(row.location ?? (row.state === 'at' ? q.morl ?? site : DASH), place ? { fill: place } : {}),
          cell(row.speedKmh != null ? `${row.speedKmh} km/h` : DASH),
          cell(words[row.state] ?? row.state, row.state === 'to' || row.state === 'from' ? { bold: true } : {}),
        ];
      }),
    });
  });
  const after = n + 1 + q.groups.length;
  if (!kinds.length) return { blocks, next: after };
  blocks.push({ kind: 'h2', title: `${after}. Events`, aside: `${listed.length} event${listed.length === 1 ? '' : 's'}` });
  if (!listed.length) {
    blocks.push({ kind: 'none', text: 'None of the events picked in this window.' });
    return { blocks, next: after + 1 };
  }
  // The counts have a table of their own: beside the sheet's columns the headings would not fit whole
  blocks.push({
    kind: 'table', size: 7.6,
    cols: [{ w: 0, wrap: true }, ...kinds.map((k) => ({ w: k.w, align: 'right' }))],
    head: ['Unit', ...kinds.map((k) => k.label)],
    rows: rowsAll.filter((row) => counts.has(row.vehicleId)).map((row) => [
      { text: String(row.grouping ?? row.plate ?? DASH), bold: true },
      ...kinds.map((k) => ({ text: String(countCell(counts, row.vehicleId, k.key)) })),
    ]),
  });
  blocks.push({ kind: 'h3', title: 'Each event' });
  blocks.push({ kind: 'table', size: 7.6, cols: EVENT_COLS, head: EVENT_HEADS, rows: listed.map((e) => eventCells(e).map((text, i) => ({ text: String(text), ...(i === 0 ? { bold: true } : {}) }))) });
  return { blocks, next: after + 1 };
}

/**
 * The document the server draws (reports/document.pdf).
 * @param {object[]} requests  lib/movementReport pdfRequests
 * @param {{ organisation: string, orgCode: string, depots?: object[], events?: { kinds: string[], list: object[] } }} o
 */
export function movementDoc(requests, { organisation, orgCode, depots = [], notes = [], events = null }) {
  const list = requests.filter((q) => q.groups?.some((g) => g.rows.length));
  const all = list.length ? list : requests.slice(0, 1);
  const first = all[0];
  const last = all[all.length - 1];
  const fleet = organisation || orgCode || 'Fleet';
  const p = parts(last.to);
  const reportNo = `MV-${String(orgCode || 'ORG').toUpperCase()}-${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
  const groupNames = [...new Set(all.flatMap((q) => q.groups.map((g) => g.name)))];
  const total = all.reduce((s, q) => s + countRows(q.groups).total, 0);
  const many = all.length > 1;

  const blocks = [];
  if (!list.length) blocks.push({ kind: 'none', text: 'No units in the report.' });
  else if (!many) blocks.push(...partBlocks(first, 1, depots, events).blocks);
  else {
    all.forEach((q) => {
      blocks.push({ kind: 'bar', title: q.groups.length === 1 ? `${q.groups[0].name} · ${longDay(q.from)}` : longDay(q.from), aside: `${hm(q.from)} – ${hm(q.to)}` });
      blocks.push(...partBlocks(q, 1, depots, events).blocks);
    });
  }
  const marked = depots.filter((d) => all.some((q) => q.groups.some((g) => g.rows.some((r) => depotAt(r, g.name, [d])))));
  for (const d of marked) blocks.push({ kind: 'note', text: `Blue: ${d.who ?? 'units'} at the ${d.label}, inside its geofence or within ${d.radiusM / 1000} km of it.` });
  for (const text of notes) if (text) blocks.push({ kind: 'note', text });

  const window = many
    ? `${all.length} parts, ${longDay(first.from)} – ${longDay(last.from)}, ${hm(first.from)} – ${hm(first.to)}`
    : windowText(first);
  const day = (ms) => { const x = parts(ms); return `${x.year}${x.month}${x.day}`; };
  const at = (ms) => { const x = parts(ms); return `${x.hour}${x.minute}`; };
  return {
    title: 'MOVEMENT REPORT',
    reportNo,
    date: dateOf(last.to),
    meta: [
      { label: 'Fleet', value: fleet },
      { label: 'Window', value: window },
      { label: 'Groups', value: `${groupNames.length} (${groupNames.slice(0, 3).join(', ')}${groupNames.length > 3 ? ', …' : ''})` },
      { label: 'Vehicles', value: `${num(total)} listed` },
      { label: 'As at', value: `${longDay(last.to)}, ${hm(last.to)}` },
      { label: 'Reference', value: first.morl ? `${first.morl} geofence` : DASH },
    ],
    blocks,
    footer: `${fleet} · Movement Report · ${window}`,
    docName: `Movement Report ${reportNo}`,
    filename: many
      ? `Movement Report ${fleet} ${day(first.from)} to ${day(last.from)} ${at(first.from)}-${at(first.to)}`
      : `Movement Report ${fleet} ${p.year}${p.month}${p.day}-${p.hour}${p.minute} ${hoursWords(first.hours)}`,
  };
}
