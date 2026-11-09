/*
 * Fuel Consumption Rate Report — per-vehicle fuel efficiency over a range of
 * fleet days, for Menengai.
 *
 * Worked out on the server (fleet-server reports/range-reports,
 * GET …/reports/fuel-consumption-rate): each unit's fuel balance over the
 * whole range (start and end tank, the ledger's refills and thefts) and the
 * distance it drove, against the target km/L from FUEL_RATES_FOR_FLEET_2.xlsx
 * (per registration, else per model). The page draws what comes back. It used
 * to stitch TAT trip rows together as if they were days, which lost the fuel
 * and the kilometres between trips.
 */

import { useRef, useState } from 'react';
import './FuelConsumptionRateReport.css';
import { loadFuelConsumptionRate, makeReportDoc } from '../../api/reports';
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

const MAX_DAYS = 31;
/** One empty list, so the editor (which resets when its rows change) sees the same one each render. */
const NONE = [];

/** A fleet day, YYYY-MM-DD in Nairobi, whatever the browser's own zone. */
const fleetDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

export const litres = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));
export const kms = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));
export const rate = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));

/** The comment a row shows: why a figure is missing, or how it stands against the target. */
export function comment(r) {
  if (r.note) return r.note;
  if (r.belowTarget === true) return 'Below target';
  if (r.belowTarget === false) return 'On target';
  return '';
}

function toCsv(rows, period) {
  const head = ['Registration', 'Target (km/L)', 'Distance (km)', 'Initial Level (L)', 'Amount Filled (L)',
    'Suspected Theft (L)', 'Final Level (L)', 'Amount Consumed (L)', 'Consumption Rate (km/L)', 'Comment'];
  const data = rows.map((r) => [r.plate, r.target?.words ?? '—', kms(r.distanceKm), litres(r.startL), litres(r.filledL),
    litres(r.theftL), litres(r.endL), litres(r.consumedL), rate(r.kmPerL), comment(r)]);
  return { head, rows: data, filenameSlug: `fuel-consumption-rate-${period.replace(/\s/g, '')}` };
}

export default function FuelConsumptionRateReport({ orgId, orgCode, companyName }) {
  const today = fleetDay(Date.now());
  const yesterday = fleetDay(Date.now() - 86_400_000);
  const [days, setDays] = useState({ from: yesterday, to: yesterday });
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);

  const fleet = companyName ?? orgCode ?? '';

  const execute = async () => {
    if (!orgId) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    try {
      const data = await loadFuelConsumptionRate({ orgId, from: days.from, to: days.to });
      if (id !== runId.current) return;
      const period = days.from === days.to ? days.from : `${days.from} – ${days.to}`;
      setRun({ status: 'done', rows: data.rows ?? [], totals: data.totals, period, from: days.from, to: days.to });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const done = run.status === 'done' ? run : null;
  const rows = done?.rows ?? NONE;
  const totals = done?.totals ?? null;

  const sheet = () => fcrDoc(rows, { from: done.from, to: done.to, fleet, orgCode, totals });
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
  const totalFilled = rows.reduce((s, r) => s + (r.filledL || 0), 0);

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
          {run.status === 'loading' ? 'Loading…' : 'Run report'}
        </button>
      </div>

      {run.status === 'idle' && (
        <EmptyNote icon="ti-gas-station" title="Fuel Consumption Rate">
          Pick a date range and run the report to see per-vehicle fuel consumption rates.
        </EmptyNote>
      )}
      {run.status === 'loading' && (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Working out the fuel">
          The server is balancing each unit&apos;s fuel over the range. A long range takes longer the first time.
        </EmptyNote>
      )}
      {run.status === 'error' && (
        <EmptyNote icon="ti-alert-circle" tone="warn" title="Could not load fuel data">
          {run.message}
        </EmptyNote>
      )}

      {done && rows.length === 0 && (
        <EmptyNote icon="ti-mood-happy" title="No Data">
          No units to report in this period.
        </EmptyNote>
      )}

      {done && rows.length > 0 && (
        <>
          <div className="sp4-header rpt-header">
            <div className="sp4-header-kpis">
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{rows.length}</span>
                <span className="sp4-kpi-l">Vehicles</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{Math.round(totals?.distanceKm ?? 0).toLocaleString('en-GB')}</span>
                <span className="sp4-kpi-l">Km, measured units</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{Math.round(totalFilled).toLocaleString('en-GB')}</span>
                <span className="sp4-kpi-l">Fuel Filled (L)</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{Math.round(totals?.consumedL ?? 0).toLocaleString('en-GB')}</span>
                <span className="sp4-kpi-l">Fuel Consumed (L)</span>
              </div>
              <div className="sp4-kpi">
                <span className="sp4-kpi-n">{rate(totals?.kmPerL)}</span>
                <span className="sp4-kpi-l">Fleet Rate (km/L)</span>
              </div>
            </div>
          </div>

          {editor.overlay}

          <TableToolbar
            summary={<>
              Fuel Consumption Rate · <strong>{rows.length}</strong> vehicle{rows.length === 1 ? '' : 's'}
              <span className="rpt-sub"> · {fleet} · {done.period} · fleet rate over the {totals?.measured ?? 0} units with a measured figure</span>
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
                  <th className="fcr-num">Suspected Theft (L)</th>
                  <th className="fcr-num">Final Level (L)</th>
                  <th className="fcr-num fcr-consumed">Amount Consumed (L)</th>
                  <th className="fcr-num fcr-rate">Rate (km/L)</th>
                  <th className="fcr-comment">Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vehicleId} className="sp4-tr">
                    <td className="fcr-reg fcr-plate">{r.plate}</td>
                    <td className="fcr-num">{r.target?.words ?? '—'}</td>
                    <td className="fcr-num">{kms(r.distanceKm)}</td>
                    <td className="fcr-num">{litres(r.startL)}</td>
                    <td className="fcr-num">{litres(r.filledL)}</td>
                    <td className="fcr-num">{r.theftL ? litres(r.theftL) : '—'}</td>
                    <td className="fcr-num">{litres(r.endL)}</td>
                    <td className={`fcr-num fcr-consumed${r.consumedL == null ? ' fcr-zero' : ''}`}>{litres(r.consumedL)}</td>
                    <td className={`fcr-num fcr-rate${r.kmPerL == null ? ' fcr-zero' : r.belowTarget ? ' fcr-below' : ' fcr-ok'}`}>
                      {rate(r.kmPerL)}
                    </td>
                    <td className="fcr-comment">{comment(r) || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fcr-total-row">
                  <td className="fcr-reg">Total / Fleet</td>
                  <td className="fcr-num">—</td>
                  <td className="fcr-num">{kms(totals?.distanceKm)}</td>
                  <td className="fcr-num">—</td>
                  <td className="fcr-num">{litres(totalFilled)}</td>
                  <td className="fcr-num">—</td>
                  <td className="fcr-num">—</td>
                  <td className="fcr-num fcr-consumed">{litres(totals?.consumedL)}</td>
                  <td className="fcr-num fcr-rate">{rate(totals?.kmPerL)}</td>
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
