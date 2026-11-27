/*
 * Reconcile a sheet (Movements › Fuel › Fuel Filled; operator, 2026-11-27): the
 * user picks an Excel or CSV sheet with "Qty per Aqmst Records", the app fills
 * "Filling as per Fuel Probes" from each unit's Wialon fill report, works out
 * the Variance (records − probe) and saves the filled copy, in the same format.
 * A row whose unit had no refuel on its date is left blank in both columns.
 * lib/probeRecon does the reading, matching and writing; this is the button.
 *
 * An .xlsx is filled in place, so its other sheets, formatting and formulas
 * stay (a Variance written as a formula is left to recalculate on opening).
 */

import { useRef, useState } from 'react';
import { loadProbeFills } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import {
  HEAD_PROBE, HEAD_VARIANCE, applyToRows, findColumns, fillPlan, matchRows, outName, parseCsv, requestsFor, sheetItems, toCsv, unitsByKey,
} from '../../lib/probeRecon';

const fmt = (n) => n.toLocaleString('en-GB');

/** A cell as the sheet means it: a date stays a Date, a formula is its result. */
function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date || typeof v !== 'object') return v;
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('result' in v) return cellValue(v.result);
  if ('text' in v) return String(v.text);
  return '';
}

async function readSheet(file) {
  if (/\.csv$/i.test(file.name)) {
    const rows = parseCsv(await file.text());
    const cols = findColumns(rows);
    return cols ? { kind: 'csv', rows, cols } : null;
  }
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { cells[c - 1] = cellValue(cell.value); });
      rows[n - 1] = Array.from(cells, (v) => v ?? '');
    });
    const all = Array.from(rows, (r) => r ?? []);
    const cols = findColumns(all);
    if (cols) return { kind: 'xlsx', wb, ws, rows: all, cols };
  }
  return null;
}

async function writeSheet(sheet, writes) {
  if (sheet.kind === 'csv') return new Blob([toCsv(applyToRows(sheet.rows, sheet.cols, writes))], { type: 'text/csv;charset=utf-8' });
  const { ws, wb, cols } = sheet;
  const head = ws.getRow(cols.head + 1);
  if (cols.added.includes(HEAD_PROBE)) head.getCell(cols.probe + 1).value = HEAD_PROBE;
  if (cols.added.includes(HEAD_VARIANCE)) head.getCell(cols.variance + 1).value = HEAD_VARIANCE;
  for (const w of writes) {
    const row = ws.getRow(w.row + 1);
    row.getCell(cols.probe + 1).value = w.probe === '' ? null : w.probe;
    const v = row.getCell(cols.variance + 1);
    // A Variance formula stays to recalculate, unless the row has no fill: then blank
    if (w.probe === '' || !(v.value && typeof v.value === 'object' && 'formula' in v.value)) v.value = w.variance === '' ? null : w.variance;
  }
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export default function ProbeReconUpload({ orgId }) {
  const input = useRef(null);
  const [state, setState] = useState({ status: 'idle' });

  const run = async (file) => {
    if (!file || !orgId) return;
    setState({ status: 'reading', text: `Reading ${file.name}…` });
    try {
      const sheet = await readSheet(file);
      if (!sheet) throw new Error('No sheet has the columns Date, Reg No and Qty per Aqmst Records');
      const items = sheetItems(sheet.rows, sheet.cols);
      if (!items.length) throw new Error('No rows with a date, a unit and a quantity');
      const requests = requestsFor(items);
      const units = new Set(items.map((it) => it.key)).size;
      setState({ status: 'reading', text: `Reading the probe fills for ${fmt(units)} units…` });
      const answers = [];
      for (const r of requests) answers.push(await loadProbeFills({ orgId, ...r }));
      const coveredFrom = answers.map((x) => x?.coveredFrom).filter(Boolean).sort()[0] ?? null;
      const { writes, tally } = fillPlan(items, matchRows(items, unitsByKey(answers), coveredFrom));
      setState({ status: 'reading', text: 'Writing the filled sheet…' });
      const ext = sheet.kind === 'csv' ? 'csv' : 'xlsx';
      saveFile(await writeSheet(sheet, writes), outName(file.name, ext));
      setState({ status: 'done', tally, units, coveredFrom, name: file.name });
    } catch (err) {
      setState({ status: 'error', text: err?.message ?? String(err) });
    }
  };

  const busy = state.status === 'reading';
  const t = state.tally;
  return (
    <>
      <button type="button" className="sp4-ghost-btn" disabled={!orgId || busy} onClick={() => input.current?.click()}
              title={`Pick an Excel or CSV sheet with "Qty per Aqmst Records": ${HEAD_PROBE} is filled from the probes and the Variance worked out`}>
        <i className="ti ti-file-upload" aria-hidden="true" /> Reconcile a sheet
      </button>
      <input ref={input} type="file" accept=".xlsx,.csv" hidden tabIndex={-1}
             onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; run(f); }} />
      {busy && <span className="rpt-sub" role="status">{state.text}</span>}
      {state.status === 'error' && <span className="rpt-warn" role="alert">The sheet could not be filled: {state.text}</span>}
      {state.status === 'done' && (
        <span className="rpt-sub" role="status"
              title={`${state.name}: ${fmt(t.rows)} rows, ${fmt(state.units)} units. A row whose unit had no refuel on its date is blank${t.blanked ? ` (${fmt(t.blanked)} of them had a figure before)` : ''}; rows on units not on the platform keep what the sheet had.`}>
          Filled {fmt(t.matched)} of {fmt(t.rows)} rows ({fmt(t.changed)} changed)
          {t.noFill > 0 && <> · {fmt(t.noFill)} blank, no fill that day</>}
          {t.notOnPlatform > 0 && <> · {fmt(t.notOnPlatform)} on units not on the platform</>}
          {t.notChecked > 0 && <> · {fmt(t.notChecked)} before {state.coveredFrom ?? 'the records'}, not checked</>}
        </span>
      )}
    </>
  );
}
