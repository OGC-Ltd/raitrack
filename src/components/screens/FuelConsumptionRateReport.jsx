/*
 * Fuel Consumption Rate Report — per-vehicle fuel efficiency over a custom
 * date range, for Menengai.
 *
 * Data: loadTatFuelReport (api/reports) called once per day in the range,
 * aggregated by vehicle: first initial level, last final level, sum of
 * amount filled (topUps), sum of distance (km).
 *
 * Target rates from the Excel file FUEL_RATES_FOR_FLEET_2.xlsx:
 *   Per-vehicle rates (Sheet 1) are tried first; if the vehicle is not
 *   listed, the model-based rates (Sheet 2) are used.
 *
 * Columns:
 *   Reg · Target Consumption (km/L) · Total Distance (km) ·
 *   Initial Level (L) · Amount Filled (L) · Final Level (L) ·
 *   Amnt Consumed (L) · Consumption Rate (km/L) · Comment
 */

import { useRef, useState } from 'react';
import './FuelConsumptionRateReport.css';
import { loadTatFuelReport, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { fcrDoc } from '../../lib/reportDocs';
import { useReportEditor } from './ReportEditor';
import DateRangePicker from '../layout/DateRangePicker';
import EmptyNote from '../shared/EmptyNote';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import PdfPreview from '../shared/PdfPreview';
import TableToolbar from '../body/TableToolbar';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';

// ── Embedded fuel rate lookup from FUEL_RATES_FOR_FLEET_2.xlsx ───────────────

/**
 * Per-vehicle target consumption rates (Sheet 1 of the Excel file).
 * km/L average track3 rate by registration number.
 */
const VEHICLE_RATES = {
  'KCA 917P': 1.789,
  'KCN 909F': 2.167,
  'KBG 389E': 3.78,
  'KDM 138L': 5.861,
  'KDE 142E': 6.183,
  'KCA 223M': 1.991,
  'KBT 112R': 1.716,
  'KCT 358W': 4.533,
  'KAX 536U': 5.4,
  'KDA 258J': 4.7,
  'KBZ 911V': 3.933,
};

/**
 * Model-based target consumption rates (Sheet 2 of the Excel file).
 * { loaded: km/L, empty: km/L }
 */
const MODEL_RATES = {
  'PICKUP HILUX':      { loaded: 8,   empty: 10  },
  'TATA':              { loaded: 7.2, empty: 8   },
  'HYUNDAI':           { loaded: 7,   empty: 7.5 },
  'HINO 500':          { loaded: 5.5, empty: 6.5 },
  'MITSUBISHI FH':     { loaded: 5.8, empty: 6.2 },
  'MITSUBISHI FN':     { loaded: 3.2, empty: 3.8 },
  'MAN CLA':           { loaded: 3,   empty: 3.2 },
  'TATA 2518':         { loaded: 3.5, empty: 4   },
  'FUSO':              { loaded: 6,   empty: 6.5 },
  'MERC ACTROS 3340':  { loaded: 1.8, empty: 2.1 },
  'MERC ACTROS 3350':  { loaded: 1.6, empty: 1.9 },
  'MAN':               { loaded: 1.9, empty: 2.5 },
};

/** Normalise a plate for lookup (remove spaces, upper-case). */
const normPlate = (p) => String(p ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Find the target consumption rate for a registration, as a string "X km/L".
 * Returns the per-vehicle rate if found, otherwise the model-range string.
 */
function targetRate(plate) {
  const key = normPlate(plate);
  // Try per-vehicle exact match
  const direct = Object.entries(VEHICLE_RATES).find(([k]) => normPlate(k) === key);
  if (direct) return direct[1].toFixed(2);
  // Try model match — look for model name in the plate (unlikely) or just show range
  // We show the loaded/empty range since we don't know load state from the API
  for (const [model, rates] of Object.entries(MODEL_RATES)) {
    if (key.includes(model.replace(/\s+/g, ''))) {
      return `${rates.loaded}–${rates.empty}`;
    }
  }
  // Fallback: no match
  return '—';
}

// ── Date helpers ─────────────────────────────────────────────────────────────

const MAX_DAYS = 31;

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayLocal() {
  const d = new Date(Date.now() - 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** List of YYYY-MM-DD strings from `from` to `to` inclusive. */
function dayRange(from, to) {
  const days = [];
  let cur = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(`${to}T00:00:00+03:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${d}`);
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return days;
}

// ── Aggregate API rows across days ───────────────────────────────────────────

/**
 * Merge daily TAT fuel rows into one row per vehicle.
 * Keeps: first initial level, last final level, sum of topUps and km,
 * last comment, most common base.
 */
function aggregateRows(dayRows) {
  // dayRows is an array of arrays, each from one day's loadTatFuelReport
  const byPlate = new Map();
  for (const rows of dayRows) {
    for (const r of rows) {
      const plate = normPlate(r.plate);
      if (!plate) continue;
      const f = r.fuel ?? {};
      if (!byPlate.has(plate)) {
        byPlate.set(plate, {
          plate: r.plate,
          initial:    f.initial  ?? 0,
          filled:     f.topUps   ?? 0,
          final:      f.final    ?? 0,
          km:         r.km       ?? 0,
          comment:    r.comment  ?? '',
          base:       r.base     ?? '',
          _days: 1,
        });
      } else {
        const agg = byPlate.get(plate);
        agg.filled  += f.topUps ?? 0;
        agg.km      += r.km     ?? 0;
        // Update final level to this day's (most recent)
        agg.final    = f.final  ?? agg.final;
        agg.comment  = r.comment || agg.comment;
        agg.base     = r.base   || agg.base;
        agg._days++;
      }
    }
  }
  return [...byPlate.values()];
}

/** Compute consumption: initial + filled − final. */
const consumed = (r) => r.initial + r.filled - r.final;

/** Compute rate: km / consumed. */
const computeRate = (r) => {
  const c = consumed(r);
  if (c <= 0 || r.km <= 0) return null;
  return r.km / c;
};

// ── CSV export ───────────────────────────────────────────────────────────────

function toCsv(rows, period) {
  const head = [
    'Registration', 'Target (km/L)', 'Total Distance (km)',
    'Initial Level (L)', 'Amount Filled (L)', 'Final Level (L)',
    'Amnt Consumed (L)', 'Consumption Rate (km/L)', 'Comment',
  ];
  const data = rows.map((r) => {
    const c = consumed(r);
    const rate = computeRate(r);
    return [
      r.plate,
      targetRate(r.plate),
      r.km.toFixed(1),
      r.initial.toFixed(1),
      r.filled.toFixed(1),
      r.final.toFixed(1),
      c.toFixed(1),
      rate != null ? rate.toFixed(2) : '—',
      r.comment,
    ];
  });
  return { head, rows: data, filenameSlug: `fuel-consumption-rate-${period.replace(/\s/g, '')}` };
}

// ── Formatters ────────────────────────────────────────────────────────────────

const litres = (n) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(1));
const kms    = (n) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(1));
const rate   = (n) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(2));

// ── Component ────────────────────────────────────────────────────────────────

export default function FuelConsumptionRateReport({ orgId, orgCode, companyName, active = true }) {
  const today = todayLocal();
  const [days, setDays] = useState({ from: yesterdayLocal(), to: yesterdayLocal() });
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);

  const fleet = companyName ?? orgCode ?? '';

  const execute = async () => {
    if (!orgId) return;
    const id = ++runId.current;
    setRun({ status: 'loading', done: 0 });
    try {
      const range = dayRange(days.from, days.to);
      const dayRows = [];
      for (let i = 0; i < range.length; i++) {
        if (id !== runId.current) return;
        setRun({ status: 'loading', done: i, of: range.length });
        const data = await loadTatFuelReport({ orgId, day: range[i] });
        // API returns { rows: [...], failed: n } — extract the rows array
        const rows = Array.isArray(data) ? data : (data?.rows ?? []);
        dayRows.push(rows);
      }
      if (id !== runId.current) return;
      const rows = aggregateRows(dayRows);
      rows.sort((a, b) => a.plate.localeCompare(b.plate));
      const period = days.from === days.to ? days.from : `${days.from} – ${days.to}`;
      setRun({ status: 'done', rows, period, from: days.from, to: days.to });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const done = run.status === 'done' ? run : null;
  const rows = done?.rows ?? [];

  const sheet = () => fcrDoc(rows, { from: done.from, to: done.to, fleet, orgCode });
  const editor = useReportEditor({ orgId, source: rows, build: sheet });

  const makePdf = (landscape = true) => (editor.edited ? editor.make(landscape) : makeReportDoc({ orgId, landscape, doc: sheet() }));
  const preview = usePdfPreview(makePdf);

  const save = async (as, landscape = true) => {
    if (!done || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makePdf(landscape);
      if (as === 'jpeg') await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };

  const saveCsv = () => {
    if (!done) return;
    const { head, rows: data, filenameSlug } = toCsv(rows, done.period);
    downloadTableCsv({ head, rows: data, filenameSlug });
  };

  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a date range' : null;

  // KPI summary values
  const totalKm      = rows.reduce((s, r) => s + (r.km || 0), 0);
  const totalFilled  = rows.reduce((s, r) => s + (r.filled || 0), 0);
  const totalConsumed = rows.reduce((s, r) => s + consumed(r), 0);
  const fleetRate    = totalConsumed > 0 ? totalKm / totalConsumed : null;

  return (
    <div className="frp-page">
      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker
          from={days.from} to={days.to} today={today}
          maxDays={MAX_DAYS} spans={[7, 14, 31]} label="Date range"
          onChange={(from, to) => setDays({ from, to: to ?? from })}
        />
        <button
          type="button" className="sp4-submit-btn frp-run rpt-run"
          onClick={execute}
          disabled={Boolean(problem) || run.status === 'loading'}
          title={problem ?? 'Make the report for this date range'}
        >
          {run.status === 'loading'
            ? (run.of > 1 ? `Loading day ${(run.done ?? 0) + 1} of ${run.of}…` : 'Loading…')
            : 'Run report'}
        </button>
      </div>

      {run.status === 'idle' && (
        <EmptyNote icon="ti-gas-station" title="Fuel Consumption Rate">
          Pick a date range and run the report to see per-vehicle fuel consumption rates.
        </EmptyNote>
      )}
      {run.status === 'loading' && (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Loading Fuel Data">
          {run.of > 1 ? `Reading day ${(run.done ?? 0) + 1} of ${run.of}…` : 'Reading fuel data…'}
        </EmptyNote>
      )}
      {run.status === 'error' && (
        <EmptyNote icon="ti-alert-circle" tone="warn" title="Could not load fuel data">
          {run.message}
        </EmptyNote>
      )}

      {done && rows.length === 0 && (
        <EmptyNote icon="ti-mood-happy" title="No Data">
          No fuel data was recorded in this period.
        </EmptyNote>
      )}

      {done && rows.length > 0 && (
        <>
          {/* KPI strip */}
          <div className="sp4-header rpt-header">
            <div className="sp4-header-kpis">
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{rows.length}</span>
                <span className="sp4-kpi-l">Vehicles</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{totalKm.toFixed(0).toLocaleString()}</span>
                <span className="sp4-kpi-l">Total km</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{totalFilled.toFixed(0).toLocaleString()}</span>
                <span className="sp4-kpi-l">Fuel Filled (L)</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{totalConsumed.toFixed(0).toLocaleString()}</span>
                <span className="sp4-kpi-l">Fuel Consumed (L)</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{fleetRate != null ? fleetRate.toFixed(2) : '—'}</span>
                <span className="sp4-kpi-l">Fleet Rate (km/L)</span>
              </div>
            </div>
          </div>

          {editor.overlay}

          <TableToolbar
            summary={<>
              Fuel Consumption Rate · <strong>{rows.length}</strong> vehicle{rows.length === 1 ? '' : 's'}
              <span className="rpt-sub"> · {fleet} · {done.period}</span>
            </>}
            onCsv={saveCsv}
            onPdf={file.busy ? undefined : (landscape) => save('pdf', landscape)} pdfWays
            actions={<>
              {editor.button}
              {file.busy
                ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                : file.error ? <span className="rpt-warn">{file.error}</span> : null}
              <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
              <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
            </>}
          />
          {preview.state && <PdfPreview state={preview.state} title="Fuel Consumption Rate report" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}

          <div className="sp4-table-scroll rpt-scroll">
            <table className="sp4-table rpt-table fcr-table">
              <thead>
                <tr>
                  <th className="fcr-reg">Registration</th>
                  <th className="fcr-num">Target (km/L)</th>
                  <th className="fcr-num">Distance (km)</th>
                  <th className="fcr-num">Initial Level (L)</th>
                  <th className="fcr-num">Amount Filled (L)</th>
                  <th className="fcr-num">Final Level (L)</th>
                  <th className="fcr-num fcr-consumed">Amnt Consumed (L)</th>
                  <th className="fcr-num fcr-rate">Rate (km/L)</th>
                  <th className="fcr-comment">Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = consumed(r);
                  const cr = computeRate(r);
                  const target = targetRate(r.plate);
                  const rateNum = cr != null ? parseFloat(target) : null;
                  const isBelow = cr != null && rateNum && cr < rateNum;
                  return (
                    <tr key={r.plate} className="sp4-tr">
                      <td className="fcr-reg fcr-plate">{r.plate}</td>
                      <td className="fcr-num">{target}</td>
                      <td className="fcr-num">{kms(r.km)}</td>
                      <td className="fcr-num">{litres(r.initial)}</td>
                      <td className="fcr-num">{litres(r.filled)}</td>
                      <td className="fcr-num">{litres(r.final)}</td>
                      <td className={`fcr-num fcr-consumed${c <= 0 ? ' fcr-zero' : ''}`}>{litres(c)}</td>
                      <td className={`fcr-num fcr-rate${cr == null ? ' fcr-zero' : isBelow ? ' fcr-below' : ' fcr-ok'}`}>
                        {rate(cr)}
                      </td>
                      <td className="fcr-comment">{r.comment || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="fcr-total-row">
                  <td className="fcr-reg">Total / Fleet</td>
                  <td className="fcr-num">—</td>
                  <td className="fcr-num">{kms(totalKm)}</td>
                  <td className="fcr-num">—</td>
                  <td className="fcr-num">{litres(totalFilled)}</td>
                  <td className="fcr-num">—</td>
                  <td className="fcr-num fcr-consumed">{litres(totalConsumed)}</td>
                  <td className="fcr-num fcr-rate">{rate(fleetRate)}</td>
                  <td className="fcr-comment" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
