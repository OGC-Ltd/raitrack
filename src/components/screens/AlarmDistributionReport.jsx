/*
 * AI Alarm Distribution Report — per-vehicle breakdown of dashcam alarm types
 * over a range of up to 7 fleet days (the dashcams keep a week).
 *
 * Worked out on the server (fleet-server reports/range-reports,
 * GET …/reports/alarm-distribution) from the same VSS search as the Alarms
 * inbox. It says when the dashcam server gave only part of the alarms, so a
 * short count is never read as the whole.
 */

import { useRef, useState } from 'react';
import './AlarmDistributionReport.css';
import { loadAlarmDistribution, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { alarmDistDoc } from '../../lib/reportDocs';
import { useReportEditor } from './ReportEditor';
import DateRangePicker from '../layout/DateRangePicker';
import EmptyNote from '../shared/EmptyNote';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import PdfPreview from '../shared/PdfPreview';
import TableToolbar from '../body/TableToolbar';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';

/** The kinds the server counts, in its order; Other is drawn last. */
const ALARM_COLS = [
  { key: 'fatigue', label: 'Fatigue Driving' },
  { key: 'phone', label: 'Phone Call' },
  { key: 'smoking', label: 'Smoking' },
  { key: 'covered', label: 'Camera Covered' },
  { key: 'distracted', label: 'Distracted Driving' },
  { key: 'seatbelt', label: 'No Seat Belt' },
];

const MAX_DAYS = 7; // VSS only keeps 7 days
/** One empty list, so the editor (which resets when its rows change) sees the same one each render. */
const NONE = [];

/** A fleet day, YYYY-MM-DD in Nairobi, whatever the browser's own zone. */
const fleetDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

function periodLabel(from, to) {
  if (from === to) return from;
  return `${from} – ${to}`;
}

/** Said under the table and on the PDF when the counts are short. */
export const PARTIAL_WORDS = 'The dashcam server returned only part of the alarms for this period, so the counts are lower than the true figures. Run the report again later.';

// ── CSV export ───────────────────────────────────────────────────────────────

function toCsv(rows, period) {
  const head = ['Device Name', 'Total', ...ALARM_COLS.map((c) => c.label), 'Other'];
  const data = rows.map((r) => [r.plate, r.total, ...ALARM_COLS.map((c) => r[c.key]), r.other]);
  return { head, rows: data, filenameSlug: `alarm-distribution-${period.replace(/\s/g, '')}` };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AlarmDistributionReport({ orgId, orgCode, companyName }) {
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
      const data = await loadAlarmDistribution({ orgId, from: days.from, to: days.to });
      if (id !== runId.current) return;
      setRun({ status: 'done', rows: data.rows ?? [], partial: Boolean(data.partial || data.stale), period: periodLabel(days.from, days.to), from: days.from, to: days.to });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const done = run.status === 'done' ? run : null;
  const rows = done?.rows ?? NONE;

  const sheet = () => alarmDistDoc(rows, { from: done.from, to: done.to, fleet, orgCode, partial: done.partial });
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

  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a day' : null;

  return (
    <div className="frp-page">
      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker
          from={days.from} to={days.to} today={today}
          maxDays={MAX_DAYS} spans={[]} label="Days"
          onChange={(from, to) => setDays({ from, to: to ?? from })}
        />
        <button
          type="button" className="sp4-submit-btn frp-run rpt-run"
          onClick={execute}
          disabled={Boolean(problem) || run.status === 'loading'}
          title={problem ?? 'Make the report for these days'}
        >
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
      </div>

      {run.status === 'idle' && (
        <EmptyNote icon="ti-chart-bar" title="Alarm Distribution">
          Pick a date range and run the report to see how alarms are distributed across vehicles.
        </EmptyNote>
      )}
      {run.status === 'loading' && (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Loading Alarms">
          Reading dashcam alarms…
        </EmptyNote>
      )}
      {run.status === 'error' && (
        <EmptyNote icon="ti-alert-circle" tone="warn" title="Could not load alarms">
          {run.message}
        </EmptyNote>
      )}

      {done && rows.length === 0 && (
        <EmptyNote icon="ti-mood-happy" title="No Alarms">
          {done.partial ? PARTIAL_WORDS : 'No dashcam alarms were recorded in this period.'}
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
                <span className="sp4-kpi-n">{rows.reduce((s, r) => s + r.total, 0).toLocaleString()}</span>
                <span className="sp4-kpi-l">Total Alarms</span>
              </div>
              {ALARM_COLS.map((c) => (
                <div key={c.key} className="sp4-kpi">
                  <span className="sp4-kpi-n">{rows.reduce((s, r) => s + r[c.key], 0).toLocaleString()}</span>
                  <span className="sp4-kpi-l">{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          {editor.overlay}

          <TableToolbar
            summary={<>
              Alarm Distribution · <strong>{rows.reduce((s, r) => s + r.total, 0).toLocaleString()}</strong> alarms across {rows.length} vehicle{rows.length === 1 ? '' : 's'}
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
          {done.partial && <p className="rpt-warn adr-partial" role="status">{PARTIAL_WORDS}</p>}
          {preview.state && <PdfPreview state={preview.state} title="Alarm Distribution report" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}

          <div className="sp4-table-scroll rpt-scroll">
            <table className="sp4-table rpt-table adr-table">
              <thead>
                <tr>
                  <th className="adr-name">Device Name</th>
                  <th className="adr-num">Total</th>
                  {ALARM_COLS.map((c) => <th key={c.key} className="adr-num">{c.label}</th>)}
                  <th className="adr-num">Other</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.plate} className="sp4-tr">
                    <td className="adr-name adr-plate">{r.plate}</td>
                    <td className="adr-num adr-total">{r.total}</td>
                    {ALARM_COLS.map((c) => (
                      <td key={c.key} className={`adr-num${r[c.key] ? '' : ' adr-zero'}`}>
                        {r[c.key] || 0}
                      </td>
                    ))}
                    <td className={`adr-num${r.other ? '' : ' adr-zero'}`}>{r.other || 0}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="adr-total-row">
                  <td className="adr-name">Total</td>
                  <td className="adr-num adr-total">{rows.reduce((s, r) => s + r.total, 0)}</td>
                  {ALARM_COLS.map((c) => (
                    <td key={c.key} className="adr-num">{rows.reduce((s, r) => s + r[c.key], 0)}</td>
                  ))}
                  <td className="adr-num">{rows.reduce((s, r) => s + r.other, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
