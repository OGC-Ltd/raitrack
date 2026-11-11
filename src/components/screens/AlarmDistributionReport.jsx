/*
 * AI Alarm Distribution Report — per-vehicle breakdown of dashcam alarm types
 * over a range of up to 7 fleet days (the dashcams keep a week).
 *
 * Worked out on the server (fleet-server reports/range-reports,
 * GET …/reports/alarm-distribution) from the same VSS search as the Alarms
 * inbox. It says when the dashcam server gave only part of the alarms, so a
 * short count is never read as the whole.
 */

import { useEffect, useRef, useState } from 'react';
import { loadAlarmDistribution, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { alarmDistDoc, withoutOther } from '../../lib/reportDocs';
import { useReportEditor } from './ReportEditor';
import DateRangePicker from '../layout/DateRangePicker';
import EmptyNote from '../shared/EmptyNote';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import PdfPreview from '../shared/PdfPreview';
import TableToolbar from '../body/TableToolbar';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';

/** The kinds the server counts, in its order. Its Other is left out (operator, 11 Nov 2026), lib/reportDocs withoutOther. */
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

const periodWords = (from, to) => (from === to ? `on ${from}` : `from ${from} to ${to}`);
const fmt = (n) => n.toLocaleString('en-GB');

/** The figures over the table, as on the other Movements reports. */
const KPI_KINDS = ['fatigue', 'phone', 'distracted'];
const KPI_LABELS = ['Units', 'Alarms', 'Fatigue driving', 'Phone call', 'Distracted driving'];

function Kpi({ value, label }) {
  return (
    <div className="sp4-kpi">
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

/** Said under the table and on the PDF when the counts are short. */
export const PARTIAL_WORDS = 'The dashcam server returned only part of the alarms for this period, so the counts are lower than the true figures. Run the report again later.';

// ── CSV export ───────────────────────────────────────────────────────────────

function toCsv(rows, period) {
  const head = ['Device Name', 'Total', ...ALARM_COLS.map((c) => c.label)];
  const data = rows.map((r) => [r.plate, r.total, ...ALARM_COLS.map((c) => r[c.key])]);
  return { head, rows: data, filenameSlug: `alarm-distribution-${period.replace(/\s/g, '')}` };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AlarmDistributionReport({ orgId, orgCode, companyName, active = true }) {
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
      setRun({ status: 'done', rows: withoutOther(data.rows), partial: Boolean(data.partial || data.stale), period: periodLabel(days.from, days.to), from: days.from, to: days.to });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  // A tab under Movements: it runs when first opened, not with the page.
  useEffect(() => { if (active && orgId && run.status === 'idle') execute(); }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const total = rows.reduce((n, r) => n + r.total, 0);
  const values = done
    ? [fmt(rows.length), fmt(total), ...KPI_KINDS.map((k) => fmt(rows.reduce((n, r) => n + r[k], 0)))]
    : KPI_LABELS.map((label) => <span key={label} className="frp-kpi-none">-</span>);

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {KPI_LABELS.map((label, i) => <Kpi key={label} label={label} value={values[i]} />)}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker
          from={days.from} to={days.to} today={today}
          maxDays={MAX_DAYS} spans={[]} label="Days"
          onChange={(from, to) => setDays({ from, to: to ?? from })}
        />
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => editor.guard('Make the report again', execute)}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report for these days'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      {editor.overlay}

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon="ti-chart-bar" title="AI Alarm Distribution">
            Each unit&apos;s dashcam alarms over the days picked, by kind. The dashcams keep {MAX_DAYS} days.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">Reading the dashcam alarms…</EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}
        {done && rows.length === 0 && (
          <EmptyNote icon="ti-chart-bar" title="No Alarms">
            {done.partial ? PARTIAL_WORDS : `No dashcam alarms were recorded ${periodWords(done.from, done.to)}.`}
          </EmptyNote>
        )}
        {done && rows.length > 0 && (
          <>
            <TableToolbar
              summary={<>
                AI Alarm Distribution · <strong>{fmt(total)}</strong> alarm{total === 1 ? '' : 's'} by {fmt(rows.length)} unit{rows.length === 1 ? '' : 's'}
                <span className="rpt-sub"> · {fleet} · {done.period}</span>
                {done.partial && <span className="rpt-warn"> · counts are short</span>}
              </>}
              onCsv={saveCsv}
              onPdf={file.busy ? undefined : (landscape) => save('pdf', landscape)} pdfWays
              actions={<>
                {editor.button}
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
                <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
              </>}
            />
            {done.partial && <p className="rpt-missing rpt-warn" role="status">{PARTIAL_WORDS}</p>}
            {preview.state && <PdfPreview state={preview.state} title="AI Alarm Distribution report" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table">
                <thead>
                  <tr>
                    <th scope="col">Device Name</th>
                    <th scope="col" className="rpt-num">Total</th>
                    {ALARM_COLS.map((c) => <th key={c.key} scope="col" className="rpt-num">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.plate} className="sp4-tr">
                      <td className="rpt-unit">{r.plate}</td>
                      <td className="rpt-num rpt-strong">{fmt(r.total)}</td>
                      {ALARM_COLS.map((c) => <td key={c.key} className={`rpt-num${r[c.key] ? '' : ' rpt-nil'}`}>{r[c.key] || 0}</td>)}
                    </tr>
                  ))}
                  <tr className="sp4-tr rpt-total">
                    <td className="rpt-unit">Total</td>
                    <td className="rpt-num">{fmt(total)}</td>
                    {ALARM_COLS.map((c) => <td key={c.key} className="rpt-num">{fmt(rows.reduce((n, r) => n + r[c.key], 0))}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
