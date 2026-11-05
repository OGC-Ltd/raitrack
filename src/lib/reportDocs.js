// Every report as a document the operator edits (operator, 4 Nov 2026: "make all
// pdf editable just like end of shift"): the same document End of Shift paints
// (lib/shiftDoc, ShiftDocument) and the server draws (POST reports/document.pdf).
//
// A report nobody edited keeps its own PDF. These are read only when Edit is
// pressed, so each one mirrors its own PDF: Dormant Assets, Geofences, TAT and
// Fuel and Speed mirror fleet-server reports/template-report.pdf; the letterhead
// reports (Driver Conduct, Night Driving, Overspeeding, Utilisation, Tankers) are
// read off the very flow their PDF is laid out from, so nothing is said twice.
//
// Deliveries mirrors the same file's renderDeliveriesPdf.
//
// Pure but for flowDoc's `parse`, which a browser's DOMParser fills in.

import { CONTACT_LINE, reportNumber } from './reportLetterhead';
import { textMm } from './shiftDoc';
import { SECTIONS, offlineCount, rowCells as dormantCells, sectionDays, asAtWords } from './offlineReport';
import { counts as geofenceCounts, endsNow, periodWords as geofencePeriod, rowCells as geofenceCells } from './geofenceReport';
import { dayWords, periodWords, rowCells as tatCells, sections as tatSections, summary as tatSummary } from './tatFuelReport';
import { PEAK_COLUMN, peakUrl, rowCells as speedCells, sections as speedSections, summary as speedSummary } from './speedReport';
import { RUN_FIGURES, RUN_HEADS, PLACE_COLUMN, UNIT_FIGURES, UNIT_HEADS, byUnit, mapUrl, runCells, summary as probeSummary, unitCells } from './probeReport';
import { COLUMNS as DELIVERY_HEADS, rowCells as deliveryCells, runWords, spansDays, stopWords } from './deliveriesReport';

const OFFSET = 3 * 3600_000;
const PORTRAIT_MM = 184;
const LANDSCAPE_MM = 271;
const fmt = (n) => Number(n).toLocaleString('en-GB');
const dmyhm = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`; };
const dmy = (ms) => dmyhm(ms).slice(0, 10);
const plural = (n, one) => `${fmt(n)} ${one}${n === 1 ? '' : 's'}`;
const meta = (pairs) => pairs.map(([label, value]) => ({ label, value: String(value) }));
const textCell = (text, bold = false) => ({ text: String(text ?? ''), ...(bold ? { bold: true } : {}) });

/** Columns from the PDF's own widths, stretched to the sheet. */
function columns(widths, body, { figures = new Set(), wrap = new Set() } = {}) {
  const used = widths.reduce((a, x) => a + x, 0);
  return widths.map((x, i) => ({
    w: Math.round(((x * body) / used) * 10) / 10,
    ...(figures.has(i) ? { align: 'right' } : {}),
    ...(wrap.has(i) ? { wrap: true } : {}),
  }));
}

export function dormantDoc(rep, { fleet, now, orgCode }) {
  const n = offlineCount(rep);
  const asAt = asAtWords(now);
  const cols = [{ w: 52, wrap: true }, { w: 32 }, { w: 0, wrap: true }];
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: `as at ${asAt}` },
    { kind: 'figures', items: [
      ...SECTIONS.map((s) => ({ label: s.words, value: fmt(rep.sections[s.key].length) })),
      { label: 'Not updating', value: `${fmt(n)} of ${fmt(rep.total)}` },
    ] },
    { kind: 'h2', title: '2. Dormant Assets' },
  ];
  for (const s of SECTIONS) {
    const list = rep.sections[s.key];
    blocks.push({ kind: 'bar', title: s.title, aside: `${sectionDays(s, now)} · ${plural(list.length, 'vehicle')}` });
    if (!list.length) blocks.push({ kind: 'none', text: 'None.' });
    else blocks.push({ kind: 'table', cols, head: ['Registration', 'Last message', 'Location'], size: 7.8,
      rows: list.map((r) => dormantCells(r).map((t, i) => textCell(t, i === 0))) });
  }
  if (rep.never.length) blocks.push({ kind: 'note', text: `${plural(rep.never.length, 'vehicle')} ${rep.never.length === 1 ? 'has' : 'have'} never reported to the platform and ${rep.never.length === 1 ? 'is' : 'are'} not listed.` });
  blocks.push({ kind: 'note', text: 'A tracker that stopped sending on the day of the report is not listed yet: it shows the next day, as offline yesterday.' });
  return {
    title: 'DORMANT ASSETS REPORT', docName: `Dormant Assets Report ${fleet}`, pairs: true,
    filename: `Dormant Assets Report ${fleet} ${new Date(now + OFFSET).toISOString().slice(0, 10)}`,
    reportNo: reportNumber('NU', orgCode, now), date: dmy(now),
    meta: meta([['Fleet', fleet], ['As at', asAt], ['Vehicles', `${fmt(rep.total)} on the platform`], ['Not updating', fmt(n)]]),
    blocks,
    footer: `${fleet} · Dormant Assets Report · ${asAt}`,
  };
}

export function geofenceDoc(rows, { from, to, fleet, places = null, failed = 0, orgCode, now = Date.now() }) {
  const period = geofencePeriod({ from, to }, now);
  const c = geofenceCounts(rows);
  const live = endsNow(to, now);
  const cols = [{ w: 50, wrap: true }, { w: 0, wrap: true }, { w: 31 }, { w: 31 }, { w: 29, align: 'right' }];
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: period },
    { kind: 'figures', items: [
      { label: 'Visits', value: fmt(c.visits) }, { label: 'Vehicles', value: fmt(c.vehicles) }, { label: 'Geofences visited', value: fmt(c.places) },
      ...(live ? [{ label: 'Still inside', value: fmt(c.still) }] : []),
    ] },
    { kind: 'h2', title: '2. Geofence Visits', aside: plural(rows.length, 'visit') },
    rows.length
      ? { kind: 'table', cols, head: ['Registration', 'Geofence', 'Time in', 'Time out', 'Duration in geofence'], size: 7.8,
        rows: rows.map((r) => geofenceCells(r, { to, now }).map((t, i) => textCell(t, i === 0))) }
      : { kind: 'none', text: 'No vehicle was in a geofence in the period.' },
  ];
  if (failed) blocks.push({ kind: 'note', text: `${plural(failed, 'vehicle')} could not be read and ${failed === 1 ? 'is' : 'are'} left out.` });
  const first = new Date(from + OFFSET).toISOString().slice(0, 10);
  const last = new Date(Math.max(from, to - 1) + OFFSET).toISOString().slice(0, 10);
  return {
    title: 'GEOFENCE REPORT', docName: `Geofence Report ${fleet}`, pairs: true,
    filename: `Geofence Report ${fleet} ${first === last ? first : `${first} to ${last}`}`,
    reportNo: reportNumber('GF', orgCode, now), date: dmy(Math.max(from, to - 1)),
    meta: meta([
      ['Fleet', fleet], ['Period', period], ['Geofences', places == null ? 'All' : `${fmt(places.length)} picked`],
      ['Visits', `${fmt(rows.length)} by ${plural(c.vehicles, 'vehicle')}`], ['Generated', dmyhm(now)],
    ]),
    blocks,
    footer: `${fleet} · Geofence Report · ${period}`,
  };
}

const TAT_HEADS = ['Reg No', 'Trip Duration', 'Initial (L)', 'Top Ups (L)', 'Total (L)', 'Consumption', 'Theft (L)', 'Final (L)', 'Station', 'KM', 'KM/L', 'Tank (L)', 'Comment', 'Base'];
const TAT_WIDTHS = [20, 48, 14, 17, 14, 20, 15, 14, 25, 10, 11, 13, 30, 14];
const TAT_COLS = { figures: new Set([2, 3, 4, 5, 6, 7, 9, 10, 11]), wrap: new Set([0, 1, 8, 12, 13]) };

export function tatDoc(rows, { day, to = day, fleet, group = 'all', orgCode, now = Date.now() }) {
  const s = tatSummary(rows);
  const several = to !== day;
  const date = to.split('-').reverse().join('/');
  const words = periodWords(day, to);
  const cols = columns(TAT_WIDTHS, LANDSCAPE_MM, TAT_COLS);
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: words },
    { kind: 'figures', items: [
      { label: 'Trips', value: fmt(s.trips) }, { label: 'Units on trips', value: fmt(s.units) },
      { label: 'Fuel used, L', value: fmt(Math.round(s.litres)) }, { label: 'Distance, km', value: fmt(Math.round(s.km)) },
      { label: 'Rate, km/L', value: s.rate == null ? '-' : s.rate.toFixed(2) }, { label: 'Not updating', value: fmt(s.notUpdating) },
    ] },
  ];
  tatSections(rows).forEach((sec, i) => {
    blocks.push({ kind: 'h2', title: `${i + 2}. ${sec.group}`, aside: plural(sec.rows.length, 'row') });
    blocks.push({ kind: 'table', cols, head: TAT_HEADS, size: 6.8, rows: sec.rows.map((r) => tatCells(r).map((t, k) => textCell(t, k === 0))) });
  });
  blocks.push({ kind: 'note', text: CONTACT_LINE });
  return {
    title: 'TAT AND FUEL REPORT', docName: `TAT and Fuel Report ${fleet}`, pairs: true, landscape: true,
    filename: `TAT and Fuel Report ${fleet} ${day}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('TF', orgCode, now), date,
    meta: meta([['Fleet', fleet], ['Units', group === 'all' ? 'All units' : group], [several ? 'Days' : 'Day', words], ['Trips', `Finished ${several ? 'on these days' : 'on the day'} (${fmt(s.trips)})`]]),
    blocks,
    footer: `${fleet} · TAT and Fuel Report · ${several ? words : date}`,
  };
}

const SPEED_HEADS = ['Registration', 'Group', 'Mileage (km)', 'Max. Speed', 'Limit', 'Exceeded By', 'Over Distance (km)', 'Occurrences'];
const SPEED_WIDTHS = [50, 15, 20, 18, 15, 20, 28, 19];
const SPEED_FIGURES = new Set([2, 3, 4, 5, 6, 7]);

export function speedDoc(rows, { day, fleet, group = 'all', orgCode, now = Date.now() }) {
  const s = speedSummary(rows);
  const date = day.split('-').reverse().join('/');
  const words = dayWords(day);
  // The Registration column takes what is left, so the pages can be turned for the JPEG
  const cols = columns(SPEED_WIDTHS, PORTRAIT_MM, { figures: SPEED_FIGURES, wrap: new Set([0, 1]) }).map((c, i) => (i === 0 ? { ...c, w: 0 } : c));
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: words },
    { kind: 'figures', items: [
      { label: 'Units over the limit', value: fmt(s.units) }, { label: 'Occurrences', value: fmt(s.occurrences) },
      { label: 'Highest speed', value: s.fastest ? `${Math.round(s.fastest)} km/h` : '-' },
      { label: 'Distance over, km', value: s.overKm.toLocaleString('en-GB', { maximumFractionDigits: 1 }) }, { label: 'Mileage, km', value: fmt(Math.round(s.km)) },
    ] },
  ];
  speedSections(rows).forEach((sec, i) => {
    blocks.push({ kind: 'h2', title: `${i + 2}. ${sec.group}`, aside: plural(sec.rows.length, 'unit') });
    blocks.push({ kind: 'table', cols, head: SPEED_HEADS, size: 7.8, rows: sec.rows.map((r) => speedCells(r).map((t, k) => {
      const link = k === PEAK_COLUMN ? peakUrl(r) : null;
      return { ...textCell(t, k === 0), ...(link ? { link } : {}) };
    })) });
  });
  blocks.push({ kind: 'note', text: CONTACT_LINE });
  return {
    title: 'SPEED REPORT', docName: `Speed Report ${fleet}`, pairs: true,
    filename: `Speed Report ${fleet} ${day}`,
    reportNo: reportNumber('SP', orgCode, now), date,
    meta: meta([['Fleet', fleet], ['Units', group === 'all' ? 'All units' : group], ['Day', words], ['Over the limit', plural(s.units, 'unit')]]),
    blocks,
    footer: `${fleet} · Speed Report · ${date}`,
  };
}

/** Not a mirror: this report has no PDF of its own, the server draws this document. */
export function probeDoc(rows, { from, to, fleet, orgCode, now = Date.now() }) {
  const s = probeSummary(rows);
  const several = from !== to;
  const words = periodWords(from, to);
  const align = (i, figures) => (figures.has(i) ? { align: 'right' } : {});
  const unitCols = [{ w: 0, wrap: true }, { w: 26 }, { w: 16 }, { w: 34 }, { w: 34 }].map((c, i) => ({ ...c, ...align(i, UNIT_FIGURES) }));
  const runCols = [{ w: 50, wrap: true }, { w: 32 }, { w: 32 }, { w: 14 }, { w: 16 }, { w: 0, wrap: true }].map((c, i) => ({ ...c, ...align(i, RUN_FIGURES) }));
  const blocks = [
    { kind: 'h2', title: '1. Overview', aside: words },
    { kind: 'figures', items: [
      { label: 'Units', value: fmt(s.units) }, { label: 'Disconnections', value: fmt(s.runs) }, { label: 'Alerts', value: fmt(s.alerts) },
    ] },
    { kind: 'h2', title: '2. By unit', aside: plural(s.units, 'unit') },
    { kind: 'table', cols: unitCols, head: UNIT_HEADS, size: 7.8, rows: byUnit(rows).map((u) => unitCells(u).map((t, k) => textCell(t, k === 0))) },
    { kind: 'h2', title: '3. Each disconnection', aside: plural(s.runs, 'disconnection') },
    { kind: 'table', cols: runCols, head: RUN_HEADS, size: 7.8, rows: rows.map((r) => runCells(r).map((t, k) => {
      const link = k === PLACE_COLUMN ? mapUrl(r) : '';
      return { ...textCell(t, k === 0), ...(link ? { link } : {}) };
    })) },
    { kind: 'note', text: CONTACT_LINE },
  ];
  return {
    title: 'PROBE DISCONNECTION REPORT', docName: `Probe Disconnection Report ${fleet}`, pairs: true,
    filename: `Probe Disconnection Report ${fleet} ${from}${several ? ` to ${to}` : ''}`,
    reportNo: reportNumber('PD', orgCode, now), date: dmy(now),
    meta: meta([['Fleet', fleet], [several ? 'Days' : 'Day', words], ['Units', plural(s.units, 'unit')], ['Disconnections', fmt(s.runs)]]),
    blocks,
    footer: `${fleet} · Probe Disconnection Report · ${words}`,
  };
}

const DELIVERY_WIDTHS = [22, 42, 24, 52, 44];

/** The Deliveries Report. `stops: false` is the sheet's table alone, as its PDF. */
export function deliveriesDoc(rows, { from, at, fleet, group = null, stops = true, orgCode, now = Date.now() }) {
  const withDay = spansDays(from, at);
  const orders = `${fmt(rows.reduce((n, r) => n + r.fulfilled, 0))}/${fmt(rows.reduce((n, r) => n + r.planned, 0))}`;
  const period = `${dmyhm(from)} to ${dmyhm(at)}`;
  // Current location takes what is left, so the pages can be turned for the JPEG
  const cols = columns(DELIVERY_WIDTHS, PORTRAIT_MM, { figures: new Set([2]), wrap: new Set([0, 1, 3, 4]) }).map((c, i) => (i === 3 ? { ...c, w: 0 } : c));
  const sheet = rows.length
    ? { kind: 'table', cols, head: DELIVERY_HEADS, size: 7.8, rows: rows.map((r) => deliveryCells(r).map((t, i) => textCell(t, i === 0))) }
    : { kind: 'none', text: 'No vehicles in the report.' };
  const blocks = [];
  if (!stops) {
    blocks.push({ kind: 'bar', title: withDay ? `${dmy(from)} to ${dmy(at)}` : dmy(at), aside: plural(rows.length, 'vehicle') }, sheet);
  } else {
    blocks.push(
      { kind: 'h2', title: '1. Overview', aside: `as at ${dmyhm(at)}` },
      { kind: 'figures', items: [
        { label: 'Vehicles', value: fmt(rows.length) },
        { label: 'Out on delivery', value: fmt(rows.filter((r) => r.trip.leftAt != null && r.trip.arrivedAt == null).length) },
        { label: 'Back at storage', value: fmt(rows.filter((r) => r.trip.arrivedAt != null).length) },
        { label: 'Orders fulfilled', value: orders },
      ] },
      { kind: 'h2', title: '2. Deliveries', aside: period },
      sheet,
      { kind: 'h2', title: '3. Customers by vehicle' },
    );
    for (const r of rows) {
      blocks.push({ kind: 'h3', title: r.plate, aside: runWords(r, withDay) });
      if (!r.customers.length) { blocks.push({ kind: 'none', text: 'No customers given.' }); continue; }
      blocks.push({ kind: 'table', cols: [{ w: 0, wrap: true }, { w: 68, wrap: true }], head: ['Stop', 'Result'], size: 7.8,
        rows: r.customers.map((c) => [textCell(c.label),
          { text: stopWords(c, withDay), ...(c.at != null ? { bold: true } : c.missing ? { tone: 'mut' } : { tone: 'flag' }) }]) });
    }
  }
  blocks.push({ kind: 'note', text: CONTACT_LINE });
  return {
    title: 'DELIVERIES REPORT', docName: `Deliveries Report ${fleet}`, pairs: true,
    filename: `Deliveries Report ${fleet} ${new Date(at + OFFSET).toISOString().slice(0, 10)}`,
    reportNo: reportNumber('DL', orgCode, now), date: dmy(at),
    meta: meta([['Fleet', fleet], ['Window', period], ['Units', group ?? 'All groups'], ['Vehicles', fmt(rows.length)], ['As at', dmyhm(at)], ['Orders fulfilled', orders]]),
    blocks,
    footer: `${fleet} · Deliveries Report · ${dmyhm(at)}`,
  };
}

// ── the letterhead reports: read off the flow their PDF is laid out from ─────

const HEX = /#[0-9a-f]{6}/i;

/** A cell's words, with any tag beside them set off: "KCS 082M · Check sensor". */
function wordsOf(el) {
  const out = [];
  el.childNodes.forEach((n) => {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  });
  return out.join(' · ');
}

/** The PDF prints a heading on one line, in 7.2 pt bold, in the room its column has. */
const HEAD_PT = 7.2;
const HEAD_PAD_MM = 3.8;

/** Columns wide enough for their headings, the room taken from those whose text wraps. */
export function roomForHeads(cols, head) {
  const out = cols.map((c) => ({ ...c }));
  out.forEach((c, i) => {
    if (!c.w) return;
    const short = textMm(head[i], HEAD_PT, true) + HEAD_PAD_MM - c.w;
    if (short <= 0) return;
    const giver = out.reduce((best, g, k) => (k !== i && g.wrap && g.w > (best?.w ?? 0) ? g : best), null);
    const need = (t) => textMm(head[out.indexOf(t)], HEAD_PT, true) + HEAD_PAD_MM;
    const spare = giver ? Math.max(0, giver.w - need(giver)) : 0;
    const moved = Math.min(short, spare);
    if (!moved) return;
    c.w = Math.round((c.w + moved) * 10) / 10;
    giver.w = Math.round((giver.w - moved) * 10) / 10;
  });
  return out;
}

/** One `table.lst` as a document table. */
function tableOf(el, inner) {
  const widths = [...el.querySelectorAll('col')].map((c) => {
    const m = /width:\s*([\d.]+)mm/.exec(c.getAttribute('style') ?? '');
    return m ? Number(m[1]) : 0;
  });
  const heads = [...el.querySelectorAll('th')];
  const trs = [...el.querySelectorAll('tbody tr')];
  const wraps = new Set();
  const rows = trs.map((tr) => [...tr.querySelectorAll('td')].map((td, i) => {
    if (td.classList.contains('wrap')) wraps.add(i);
    const fill = HEX.exec(td.getAttribute('style') ?? '')?.[0];
    return {
      text: wordsOf(td),
      ...(td.classList.contains('b') ? { bold: true } : {}),
      ...(td.classList.contains('m') ? { tone: 'mut' } : {}),
      ...(fill ? { fill } : {}),
    };
  }));
  const used = widths.reduce((a, x) => a + x, 0);
  const head = heads.map((h) => h.textContent.trim());
  return {
    kind: 'table',
    // Scaled only when they would not fit; a report with room keeps its own widths
    cols: roomForHeads(widths.map((w, i) => ({
      w: used > inner ? Math.round(((w * inner) / used) * 10) / 10 : w,
      ...(heads[i]?.classList.contains('r') ? { align: 'right' } : {}),
      ...(wraps.has(i) ? { wrap: true } : {}),
    })), head),
    head,
    rows,
    size: 7.8,
  };
}

/** The flow's blocks: headings, figures, tables and notes. */
export function flowBlocks(flow, inner, parse) {
  const root = parse(flow.join(''));
  const blocks = [];
  for (const el of [...root.children]) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'style' || tag === 'script') continue;
    if (tag === 'h2') {
      const small = el.querySelector('small');
      const aside = small?.textContent.trim();
      small?.remove();
      blocks.push({ kind: 'h2', title: el.textContent.trim(), ...(aside ? { aside } : {}) });
    } else if (el.matches('table.cells')) {
      blocks.push({ kind: 'figures', items: [...el.querySelectorAll('td')].map((td) => {
        const label = td.querySelector('span');
        const name = label?.textContent.trim() ?? '';
        label?.remove();
        return { label: name, value: td.textContent.trim() };
      }) });
    } else if (el.matches('table.lst')) {
      blocks.push(tableOf(el, inner));
    } else if (el.classList.contains('none')) {
      blocks.push({ kind: 'none', text: el.textContent.trim() });
    } else {
      const text = el.textContent.trim();
      if (text) blocks.push({ kind: 'note', text });
    }
  }
  return blocks;
}

const browserParse = (html) => new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body;

/** A letterhead report's parts (reportHtml, tankersHtml) as a document. */
export function flowDoc({ parts, landscape, filename }, parse = browserParse) {
  const strip = (html) => parse(`<div>${html}</div>`).textContent.trim();
  return {
    title: parts.title,
    docName: filename.replace(/\.pdf$/, ''),
    pairs: true,
    ...(landscape ? { landscape: true } : {}),
    filename: filename.replace(/\.pdf$/, ''),
    reportNo: parts.reportNo,
    date: parts.date,
    meta: parts.info.slice(0, 8).map(([label, value]) => ({ label, value: strip(value) })),
    blocks: flowBlocks(parts.flow, landscape ? LANDSCAPE_MM : PORTRAIT_MM, parse),
    footer: parts.footNote,
  };
}
