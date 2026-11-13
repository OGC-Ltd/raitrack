// The Finished Goods template of the Deliveries report (operator, 11 Nov 2026:
// "leave the current report as a template for van sales and implement a new
// template 'Finished goods Template' for finished goods"), laid out as the
// operator's own sheet: one line per customer, yellow once the truck got there,
// red while it has not.
//
// Nothing is worked out again here: the lines are read off the same rows the
// Van Sales template shows (lib/deliveriesReport deliveryRow, lib/plannerReport
// sheetRow), so the two templates always agree on what was delivered.
//
// Pure: no React, no network.

import { customerName } from './customerName';
import { stamp, dayWords, notLeftWords, listDayWords } from './deliveriesReport';
import { spanWords } from './plannerActual';
import { reportNumber } from './reportLetterhead';

export const TEMPLATES = [
  { value: 'vanSales', label: 'Van Sales' },
  { value: 'finishedGoods', label: 'Finished Goods' },
];
export const DEFAULT_TEMPLATE = 'vanSales';

// The sheet's headings, the three longest shortened so the PDF prints them whole
export const FG_HEADS = ['Date', 'Reg No', 'Customer name', 'Destination', 'Current location', 'Departure date & time',
  'Arrived at customer', 'Left customer', 'Arrived at yard', 'TAT'];

/**
 * The sheet's own colours: green, a completed trip (got to the customer and
 * back at the yard); yellow, got there but not back yet; red, not yet there.
 */
export const FG_FILL = { done: '#00b050', ok: '#ffff00', miss: '#ff0000' };

/** Under the customer's name when the truck is back and no geofence saw the delivery. */
export const NOT_GEOFENCED = 'Customers Name Not Geofenced';

/** A line's state, as FG_FILL keys it. */
export const fgState = (l) => (l.completed ? 'done' : l.delivered ? 'ok' : 'miss');
/**
 * The colours an operator can give a line by hand, the sheet's own three (operator, 13 Nov 2026: "change the
 * colour of a row ... based on the options of colour being used"), in the sheet's order.
 */
export const FG_COLOURS = [
  { state: 'done', label: 'Green', means: 'completed' },
  { state: 'ok', label: 'Yellow', means: 'at the customer' },
  { state: 'miss', label: 'Red', means: 'not there yet' },
];
/** The line's colour: the one picked for it (`colours`, line key → FG_FILL key), else its state's. */
export const fgColour = (l, colours) => {
  const picked = colours instanceof Map ? colours.get(l.key) : null;
  return FG_FILL[picked] ? picked : fgState(l);
};
/** A line's fill. `colours` as fgColour; anything else (an index from .map) is ignored. */
export const fgFill = (l, colours) => FG_FILL[fgColour(l, colours)];

// The template picked, per organisation, kept in this browser
const keyOf = (orgCode) => `ft-deliveries-template:${String(orgCode ?? '').toUpperCase()}`;
export function loadTemplate(orgCode) {
  try {
    const v = localStorage.getItem(keyOf(orgCode));
    return TEMPLATES.some((t) => t.value === v) ? v : DEFAULT_TEMPLATE;
  } catch { return DEFAULT_TEMPLATE; }
}
export function saveTemplate(orgCode, value) {
  try { localStorage.setItem(keyOf(orgCode), value); } catch { /* full or blocked */ }
}

/** "KDE 268P" from "Menengai - KDE 268P" or "FG - Menengai - KDE268P": the plate alone, else as given. */
export function regOf(s) {
  const m = String(s ?? '').toUpperCase().match(/\bK[A-Z]{2}\s?\d{3}\s?[A-Z]?\b/);
  return m ? m[0].replace(/^(K[A-Z]{2})\s?(\d{3})\s?([A-Z]?)$/, (_, a, b, c) => `${a} ${b}${c}`) : String(s ?? '');
}

/** "Chepseon, Kipkelion East" from "Chepseon, Kipkelion East, Kenya". */
const placeWords = (s) => String(s ?? '').replace(/,\s*Kenya\s*$/i, '').trim();

/** Where the truck is now: as the Van Sales table's Current location reads. */
const nowAt = (r) => (r.trip.arrivedAt != null && r.trip.arrivedTo && !r.trip.outAgain ? r.trip.arrivedTo.label : (r.place ?? ''));

/** When the truck left the customer: the stand's end, where the sheet has it. */
const leftCustomer = (c) => (c.leftAt != null ? c.leftAt : c.at != null && Number.isFinite(c.stayMs) ? c.at + c.stayMs : null);

/**
 * One line per customer of every row; a vehicle with no customers is one line
 * of its own, so it still shows. `at`: the report's "as at", for the Date of a
 * truck that has not left. `picks`: line key → a customer geofence the unit passed,
 * picked on the screen as this customer (operator, 12 Nov 2026): its arrival and
 * departure are the line's, the customer's name stays as listed.
 */
export function fgLines(rows, { at, picks = null }) {
  const out = [];
  for (const r of rows ?? []) {
    const departAt = r.trip?.leftAt ?? null;
    // Back at the yard, even when out again since (operator, 12 Nov 2026: KCA 226M); where it is now is Current location
    const yardAt = r.trip?.arrivedAt != null ? r.trip.arrivedAt : null;
    // Departure is a date and time only (operator, 12 Nov 2026): a truck not
    // seen leaving has it blank, and why ("At MORL") goes under Current location
    const base = {
      key: r.key ?? r.plate,
      rowKey: r.key ?? r.plate,
      plate: regOf(r.plate),
      place: nowAt(r) || (departAt == null ? notLeftWords(r.trip) : ''),
      departAt,
      yardAt,
      tatMs: departAt != null && yardAt != null && yardAt > departAt ? yardAt - departAt : null,
    };
    const list = r.customers?.length ? r.customers : [null];
    for (const c of list) {
      const arriveAt = c?.at ?? null;
      // Back at the yard with this customer not reached: delivered where no geofence says so (operator, 12 Nov 2026)
      const notGeofenced = arriveAt == null && base.departAt != null && base.yardAt != null;
      out.push({
        ...base,
        key: `${base.key}|${c?.name ?? '-'}`,
        // A hand-listed unit is on the day it was listed (operator, 12 Nov 2026: "we added it
        // 12/11/2026"), however early it set out; a sheet's, the day it left
        day: r.listDay ? listDayWords(r.listDay) : dayWords(departAt ?? arriveAt ?? at),
        customer: !c ? (notGeofenced ? NOT_GEOFENCED : 'No customers given')
          : notGeofenced ? `${customerName(c.stop?.name || c.label || c.name)} (${NOT_GEOFENCED})`
            : customerName(c.stop?.name || c.label || c.name),
        notGeofenced,
        destination: placeWords(c?.stop?.location ?? c?.location ?? ''),
        arriveAt,
        leftAt: c ? leftCustomer(c) : null,
        delivered: arriveAt != null,
        // Completed trip: left and back at the yard, whatever happened at the customer (operator, 12 Nov 2026:
        // "as long as it left and arrived back at the yard Menengai HQ then it should be highlighted as complete")
        completed: base.departAt != null && base.yardAt != null,
      });
      const pick = picks?.get(out[out.length - 1].key);
      // A picked customer is reached: its name plain again, never "Not Geofenced"
      if (pick) {
        Object.assign(out[out.length - 1], { arriveAt: pick.at, leftAt: pick.leftAt ?? null, delivered: true, picked: pick.label,
          notGeofenced: false, ...(c ? { customer: customerName(c.stop?.name || c.label || c.name) } : {}) });
      }
    }
  }
  return out;
}

const when = (ms) => (ms != null ? stamp(ms) : '');

/** "KAX 536U: 5 of 14 stops marked for 11.11", for each sheet counted by its Planner marks. */
export function fgDueNotes(rows) {
  return (rows ?? []).filter((r) => r.sheet?.due).map((r) => {
    const d = r.sheet.due;
    const days = d.days.map((x) => { const [, mo, dd] = String(x).split('-'); return `${dd}.${mo}`; }).join(', ');
    return `${regOf(r.plate)}: ${d.count} of ${d.of} stops ${d.by === 'marked' ? `marked for ${days}` : 'left from other days'}`;
  });
}

/** The line's ten cells, as FG_HEADS. */
export function fgCells(l) {
  return [l.day, l.plate, l.customer, l.destination || '-', l.place || '-',
    when(l.departAt),
    when(l.arriveAt), when(l.leftAt), when(l.yardAt), l.tatMs != null ? spanWords(l.tatMs) : ''];
}

export function fgCsv(lines, colours = null) {
  return { head: [...FG_HEADS, 'Delivered'], body: lines.map((l) => [...fgCells(l), l.delivered ? 'Yes' : 'No']),
    // The rows' colours, picked ones included, for the Excel file (utils/xlsxExport); the CSV has none
    fills: lines.map((l) => fgFill(l, colours)) };
}

// The PDF, landscape: the server's document (POST reports/document.pdf), as an edited report is drawn
const OFFSET = 3 * 3600_000;
const LANDSCAPE_MM = 271;
const WIDTHS = [17, 19, 36, 24, 30, 25, 25, 25, 25, 17];
const dmyhm = (ms) => { const s = new Date(ms + OFFSET).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`; };
const dmy = (ms) => dmyhm(ms).slice(0, 10);
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** `dropped`: the keys of lines taken off with ✕ on the screen; they are left out everywhere. `colours`: as fgColour. */
export function finishedGoodsDoc(rows, { from, at, fleet, group = null, orgCode, now = Date.now(), dropped = null, picks = null, colours = null }) {
  const lines = fgLines(rows, { at, picks }).filter((l) => !dropped?.has(l.key));
  const got = lines.filter((l) => l.delivered).length;
  const used = WIDTHS.reduce((a, x) => a + x, 0);
  const cols = WIDTHS.map((w, i) => ({ w: Math.round(((w * LANDSCAPE_MM) / used) * 10) / 10, wrap: i !== 0 && i !== 9 }));
  const period = `${dmyhm(from)} to ${dmyhm(at)}`;
  const blocks = [
    { kind: 'bar', dark: true, title: dayWords(from) !== dayWords(at) ? `${dmy(from)} to ${dmy(at)}` : dmy(at), aside: `${got}/${lines.length} customers reached · ${plural(rows.length, 'vehicle')}` },
    lines.length
      ? { kind: 'table', cols, head: FG_HEADS, size: 6.8,
        rows: lines.map((l) => fgCells(l).map((text, i) => ({ text: String(text ?? ''), fill: fgFill(l, colours), ...(i === 1 || i === 2 ? { bold: true } : {}) }))) }
      : { kind: 'none', text: 'No vehicles in the report.' },
  ];
  return {
    title: 'DELIVERIES REPORT · FINISHED GOODS', docName: `Deliveries Report Finished Goods ${fleet}`, pairs: true, landscape: true,
    filename: `Deliveries Report Finished Goods ${fleet} ${new Date(at + OFFSET).toISOString().slice(0, 10)}`,
    reportNo: reportNumber('DL', orgCode, now), date: dmy(at),
    meta: [['Fleet', fleet], ['Window', period], ['Units', group ?? 'All groups'], ['Vehicles', String(rows.length)],
      ['As at', dmyhm(at)], ['Customers reached', `${got}/${lines.length}`]].map(([label, value]) => ({ label, value: String(value) })),
    blocks,
    footer: `${fleet} · Deliveries Report · Finished Goods · ${dmyhm(at)}`,
  };
}
