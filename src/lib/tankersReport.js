// The Tankers Report (operator, 2–3 Nov 2026): Menengai's tankers on the
// road from the Mombasa depot to MORL, and how far each went in the 4 hours up
// to the report time. The server makes the rows (fleet-server
// reports/tankers-report.service, since 4 Nov 2026: which tankers, when each
// left the depot, the distances and the status); this is their words, the
// table's cells, the CSV and the PDF.
//
//   Reg No                         the tanker
//   Time left storage facility     when it drove out of the Mombasa depot
//   Time period                    the 4 hours up to the report time
//   Location                       where it was at the report time (the
//                                  Movements report's place name)
//   Distance covered within 4 h    km driven in that window
//   Distance (km)                  km driven since it left the depot
//
// Rows, as the operator's sheet colours them:
//   white   in transit
//   green   trip completed: reached the MORL geofence in the last 24 hours
//   red     covered under half of what the middle tanker on the road covered
//           in the same 4 hours, or did not move at all
//
// Pure: no React, no network.

import { km2 } from './fleetReports';
import { renderLetterheadHtml, table, cells, esc } from './letterhead';
import { reportNumber } from './reportLetterhead';

/** Menengai's tanker group on the fleet list (data/fleetGroups). */
export const TANKER_GROUP = 'Tankers';
export const WINDOW_MS = 4 * 3600_000;
export const DEPOT_WORDS = 'Mombasa depot';

/** The row colours, on the PDF and the screen. */
export const ROW_TINT = { transit: null, completed: '#c6efce', still: '#ffc7ce' };
export const STATUS_WORDS = { transit: 'In transit', completed: 'Trip completed', still: 'Under half the others' };

/** "16.09.2026 15:54:53", fleet time. */
export function leftWords(ms) {
  const s = new Date(ms + 3 * 3600_000).toISOString();
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 19)}`;
}
const hm = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(11, 16);
/** "08:30-12:30". */
export const periodWords = (from, to) => `${hm(from)}-${hm(to)}`;
/** "16th September 2026". */
export function dayWords(day) {
  const d = Number(day.slice(8, 10));
  const th = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  const month = new Date(`${day}T12:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${d}${th} ${month} ${day.slice(0, 4)}`;
}

/** A row's cells, for the screen, the PDF and the CSV. */
export function rowCells(r, from, to) {
  const done = r.status === 'completed';
  return [r.unit.plate, leftWords(r.leftAt), periodWords(from, to), r.location || '-',
    done ? 'COMPLETED TRIP' : km2(r.windowKm), done ? '' : km2(r.tripKm)];
}
export const COLUMNS = ['Reg No', 'Time left storage facility', 'Time period', 'Location', 'Distance covered KM (4hrs)', 'Distance (km)'];

export function counts(rows) {
  const c = { all: rows.length, transit: 0, completed: 0, still: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

/** The CSV. */
export function csvTable(rows, from, to) {
  return { head: [...COLUMNS, 'Status'], body: rows.map((r) => [...rowCells(r, from, to), STATUS_WORDS[r.status]]) };
}

const dmy = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/');

/** The PDF, on the letterhead: the figures, then one table, coloured as the sheet is. */
export function tankersHtml(rows, { from, to, companyName, orgCode, logos, now = Date.now(), failed = 0, slowLine = null }) {
  const c = counts(rows);
  const tint = (r) => (ROW_TINT[r.status] ? `background:${ROW_TINT[r.status]}` : undefined);
  const flow = [
    `<h2>1. Overview <small>${esc(periodWords(from, to))}, ${esc(dmy(to))}</small></h2>`,
    cells([['Tankers from Mombasa', String(c.all)], ['In transit', String(c.transit + c.still)], ['Trip completed', String(c.completed)]]),
    `<h2>2. Tankers Movement <small>${esc(dmy(to))}</small></h2>`,
  ];
  if (!rows.length) flow.push('<div class="none">No tanker is on the road from the Mombasa depot.</div>');
  else {
    const cols = [{ h: 'Reg No', w: '20mm' }, { h: 'Time left storage facility', w: '34mm' }, { h: 'Time period', w: '20mm' },
      { h: 'Location', w: '54mm' }, { h: 'Distance covered KM (4hrs)', w: '34mm' }, { h: 'Distance (km)', w: '22mm' }];
    // Every column centred, as the operator's sheet is (operator, 3 Nov 2026)
    flow.push('<style>.lst th, .lst td { text-align: center } .lst td:first-child, .lst th:first-child { padding-left: 1.4mm }</style>');
    flow.push(table(cols, rows.map((r) => {
      const style = tint(r);
      const done = r.status === 'completed';
      return rowCells(r, from, to).map((v, i) => ({
        html: esc(v),
        cls: [i === 0 ? 'b' : '', i === 3 ? 'wrap' : '', done && i === 4 ? 'b' : ''].filter(Boolean).join(' '),
        style,
      }));
    })));
    flow.push(`<div class="note">Storage facility: the ${esc(DEPOT_WORDS)}. Green: trip completed, reached MORL in the last 24 hours. Red: covered under half of what the middle tanker covered in the 4 hours${slowLine != null ? ` (under ${km2(slowLine)} km)` : ''}.</div>`);
  }
  if (failed) flow.push(`<div class="note">${esc(`${failed} tanker${failed === 1 ? '' : 's'} could not be read and ${failed === 1 ? 'is' : 'are'} left out.`)}</div>`);
  // No "not tracked" note and no system-generated line on this report (operator, 3 Nov 2026)

  const html = renderLetterheadHtml({
    title: 'TANKERS REPORT',
    reportNo: reportNumber('TK', orgCode, now),
    date: dmy(to),
    companyName,
    info: [
      ['Fleet', esc(companyName)],
      ['Group', esc(TANKER_GROUP)],
      ['Storage facility', esc(DEPOT_WORDS)],
      ['Time period', esc(`${periodWords(from, to)} (4 hours)`)],
      ['Tankers', `${rows.length} in transit to HQ`],
      ['Generated', esc(leftWords(now).slice(0, 16))],
    ],
    flow,
    footNote: `${companyName} · Tankers Report · ${dmy(to)} · ${periodWords(from, to)}`,
    logos,
  });
  const d = new Date(to + 3 * 3600_000).toISOString().slice(0, 10);
  return { html, filename: `Tankers Report ${companyName} ${d} ${periodWords(from, to).replace(/:/g, '')}.pdf` };
}

