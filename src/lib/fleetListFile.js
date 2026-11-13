// The client's fleet list as an Excel file, uploaded on the Probe & Sensor Health page before the
// report is made (operator, 13 Nov 2026: "make it able for the user to upload this file before
// generating the report so new details can be captured if there have been changes"). Read here, in
// the browser; what it read is kept by the server for the organisation, for every user, each upload
// on record (api/fleetList). Without one, the list built into the app (data/morlFleet) is used.
//
// Every sheet laid out as MORL_FLEET.xlsx is read: a heading row with TRUCK NO and DRIVER NAME, the
// status under STATUS in the row above it (else the column after NTSA). Only plate, driver and status
// are kept, and the TYPE (make or model) for the fuel targets; ID and phone numbers never leave the file.
// "GARAGE" as the driver is blank. A row whose TRUCK NO has no digit (a heading, a list of names) is not a unit.

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const title = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const plateKey = (s) => norm(s).replace(/[^A-Z0-9]/g, '');

/**
 * The list from the file's sheets: `sheets` = [{ name, rows: [[cell, …], …] }].
 * @returns {{ entries: Record<string, {driver, status, type, list}>, sheets: {name, count}[], conflicts: {plate, kept, also}[] }}
 */
export function readFleetSheets(sheets) {
  const byKey = new Map();
  const conflicts = [];
  const read = [];
  for (const { name, rows } of sheets ?? []) {
    const at = rows.findIndex((r) => { const h = (r ?? []).map(norm); return h.includes('TRUCK NO') && h.includes('DRIVER NAME'); });
    if (at < 0) continue;
    const head = rows[at].map(norm);
    const above = at > 0 ? (rows[at - 1] ?? []).map(norm) : [];
    const plateCol = head.indexOf('TRUCK NO');
    const driverCol = head.indexOf('DRIVER NAME');
    const typeCol = head.indexOf('TYPE');
    const statusCol = above.indexOf('STATUS') >= 0 ? above.indexOf('STATUS') : head.indexOf('NTSA') >= 0 ? head.indexOf('NTSA') + 1 : -1;
    let count = 0;
    for (const r of rows.slice(at + 1)) {
      const plate = norm(r?.[plateCol]);
      if (!plate || !/[A-Z]/.test(plate) || !/\d/.test(plate)) continue;
      const type = typeCol >= 0 ? norm(r?.[typeCol]) : '';
      const d = norm(r?.[driverCol]);
      const driver = d === 'GARAGE' ? '' : title(d);
      const status = statusCol >= 0 ? title(r?.[statusCol]) : '';
      const key = plateKey(plate);
      const had = byKey.get(key);
      if (had) {
        // The same unit again on its sheet: another driver for it (a forklift's shifts)
        if (had.list === name) { if (driver && !had.driver.split(' / ').includes(driver)) had.driver = had.driver ? `${had.driver} / ${driver}` : driver; continue; }
        conflicts.push({ plate, kept: had.list, also: name });
        continue;
      }
      byKey.set(key, { plate, driver, status, type, list: name });
      count += 1;
    }
    read.push({ name, count });
  }
  const entries = {};
  for (const e of byKey.values()) entries[e.plate] = { driver: e.driver, status: e.status, type: e.type, list: e.list };
  return { entries, sheets: read, conflicts };
}

/** A cell's text, however Excel keeps it (rich text, formula, number). */
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

/** The list from an uploaded .xlsx file (a File, or its bytes). */
export async function readFleetWorkbook(file) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(typeof file?.arrayBuffer === 'function' ? await file.arrayBuffer() : file);
  const sheets = wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells = [];
      // A merged heading ("WHATSAPP GROUP TEAM" across columns) counts once, in its first cell
      row.eachCell({ includeEmpty: true }, (cell, c) => { cells[c - 1] = cell.isMerged && cell.master !== cell ? '' : cellText(cell.value); });
      rows[n - 1] = Array.from(cells, (v) => v ?? '');
    });
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
  });
  return readFleetSheets(sheets);
}

import { MORL_FLEET } from '../data/morlFleet';

/** The list built into the app: Menengai's (MORL_FLEET.xlsx) alone. */
export const builtInFleetList = (orgCode) => (String(orgCode ?? '').toUpperCase() === 'MENENGAI' ? MORL_FLEET : null);
/** The list a report reads: the one uploaded for the organisation (the server's), else the one built in, else null. */
export const fleetEntriesFor = (orgCode, uploaded = null) => uploaded ?? builtInFleetList(orgCode);
