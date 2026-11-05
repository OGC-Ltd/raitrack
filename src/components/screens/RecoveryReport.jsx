/*
 * Recovery, a daily tab under Movements for Sukari and West Kenya (fleet-server
 * reports/recovery): the configured mechanical and puncture recovery vehicles,
 * their measured distance, GPS route, fuel and stops.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadRecoveryReport, loadRecoveryReport } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { downloadTableCsv } from '../../utils/tableExport';
import { recoveryDoc } from '../../lib/reportDocs';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import PdfPreview from '../shared/PdfPreview';
import JpegButton from '../shared/JpegButton';
import DateRangePicker from '../layout/DateRangePicker';
import { dayWords, yesterday } from '../../lib/tatFuelReport';
import { useReportEditor } from './ReportEditor';

const COLUMNS = ['Registration', 'Recovery type', 'Distance (km)', 'Fuel consumed (L)', 'Stops'];
const RECOVERY_VEHICLES = ['KDX 130Y', 'KCS 969P', 'KDC 099U', 'KDX 131Y'];
const EMPTY_VEHICLES = [];
const fmt = (n, digits = 0) => n == null ? '–' : n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false });
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

function Kpi({ value, label }) {
  return <div className="sp4-kpi"><span className="sp4-kpi-n">{value}</span><span className="sp4-kpi-l">{label}</span></div>;
}

function routePolyline(points) {
  if (!points?.length) return '';
  const stride = Math.max(1, Math.ceil(points.length / 500));
  const sampled = points.filter((_, i) => i % stride === 0);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
  const lats = sampled.map((p) => p[0]), lngs = sampled.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 0.00001, spanLng = maxLng - minLng || 0.00001;
  const scale = Math.min(640 / spanLng, 170 / spanLat);
  const midLat = (minLat + maxLat) / 2, midLng = (minLng + maxLng) / 2;
  return sampled.map(([lat, lng]) =>
    `${(340 + (lng - midLng) * scale).toFixed(1)},${(100 - (lat - midLat) * scale).toFixed(1)}`).join(' ');
}

function RouteTrace({ vehicle }) {
  const points = vehicle.route ?? [];
  if (!points.length) return <p className="rpt-sub">No GPS route was recorded.</p>;
  const line = routePolyline(points);
  const first = line.split(' ')[0];
  const last = line.split(' ').at(-1);
  return (
    <div className="recovery-route">
      <svg viewBox="0 0 680 200" role="img" aria-label={`${vehicle.plate} GPS route from start to end`}>
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={first.split(',')[0]} cy={first.split(',')[1]} r="5" className="recovery-route__start" />
        <circle cx={last.split(',')[0]} cy={last.split(',')[1]} r="5" className="recovery-route__end" />
      </svg>
      <div className="recovery-route__ends">
        <span>Start: {points[0][0].toFixed(5)}, {points[0][1].toFixed(5)}</span>
        <span>End: {points.at(-1)[0].toFixed(5)}, {points.at(-1)[1].toFixed(5)}</span>
      </div>
    </div>
  );
}

export default function RecoveryReport({ orgId, orgCode, companyName, active = true }) {
  const [day, setDay] = useState(() => yesterday());
  const [vehicle, setVehicle] = useState('');
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);
  const today = yesterday(Date.now() + 86_400_000);
  const problem = !orgId ? 'Waiting for the organisation to load' : !day ? 'Pick a day' : day > today ? 'That day has not happened yet' : null;

  const execute = async () => {
    if (problem) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    try {
      const report = await loadRecoveryReport({ orgId, day, vehicle });
      if (id === runId.current) setRun({ status: 'done', report, vehicle });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  useEffect(() => {
    if (active && orgId && run.status === 'idle') execute();
  }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = run.status === 'done' ? run.report : null;
  const reportVehicle = run.status === 'done' ? run.vehicle : vehicle;
  const vehicles = report?.vehicles ?? EMPTY_VEHICLES;
  const measured = useMemo(() => vehicles.filter((v) => v.available && v.hasTelemetry), [vehicles]);
  const distance = measured.some((v) => v.distanceKm != null) ? measured.reduce((n, v) => n + (v.distanceKm ?? 0), 0) : null;
  const fuel = measured.some((v) => v.fuelConsumedL != null) ? measured.reduce((n, v) => n + (v.fuelConsumedL ?? 0), 0) : null;
  const stops = measured.some((v) => v.stopsTotal != null) ? measured.reduce((n, v) => n + (v.stopsTotal ?? 0), 0) : null;
  const rows = vehicles.map((v) => [
    v.plate, v.recoveryType === 'puncture' ? 'Puncture recovery' : 'Mechanical recovery',
    v.distanceKm == null ? '–' : fmt(v.distanceKm, 1),
    v.fuelConsumedL == null ? '–' : fmt(v.fuelConsumedL, 1),
    fmt(v.stopsTotal),
  ]);
  const downloadCsv = () => report && downloadTableCsv({
    head: COLUMNS, body: rows, filenameSlug: `recovery-report-${reportVehicle || 'all-vehicles'}-${report.day}`,
  });

  const editorSource = useMemo(() => report ? { report, companyName, orgCode } : null, [report, companyName, orgCode]);
  const editor = useReportEditor({
    orgId, source: editorSource,
    build: () => recoveryDoc(report, { fleet: companyName ?? orgCode ?? 'Fleet', orgCode }),
  });
  const makePdf = (landscape = false) => editor.edited
    ? editor.make(landscape)
    : downloadRecoveryReport({ orgId, day: report.day, vehicle: reportVehicle, landscape });
  const save = async (as, landscape = false) => {
    if (!report || file.busy) return;
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
  const [preview, setPreview] = useState(null);
  const previewId = useRef(0);
  const previewPdf = async () => {
    if (!report) return;
    const id = ++previewId.current;
    setPreview({ status: 'loading' });
    try {
      const made = await makePdf();
      if (id === previewId.current) setPreview({ status: 'done', ...made });
    } catch (err) {
      if (id === previewId.current) setPreview({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  const closePreview = () => { previewId.current++; setPreview(null); };

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          <Kpi label="Vehicles with GPS" value={report ? fmt(measured.length) : '–'} />
          <Kpi label="Distance, km" value={fmt(distance, 1)} />
          <Kpi label="Fuel consumed, L" value={fmt(fuel, 1)} />
          <Kpi label="Stops over 5 min" value={fmt(stops)} />
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker from={day} to={day} today={today} maxDays={1} spans={[]} label="Day" on
                        onChange={(next) => editor.guard('Change the report day', () => setDay(next))} />
        <label className="rpt-field">
          <span className="rpt-field__l">Vehicle</span>
          <select className="rpt-select" value={vehicle} aria-label="Recovery vehicle"
                  onChange={(event) => editor.guard('Change the recovery vehicle', () => setVehicle(event.target.value))}>
            <option value="">All recovery vehicles</option>
            {RECOVERY_VEHICLES.map((plate) => <option key={plate} value={plate}>{plate}</option>)}
          </select>
        </label>
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => editor.guard('Run this report again', execute)}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report for this day'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && <EmptyNote icon={<ReportIcon name="recovery" />} title="Recovery Report">Daily distance, route, fuel consumption and stops for the mechanical and puncture recovery vehicles.</EmptyNote>}
        {run.status === 'loading' && <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">Reading the recovery vehicles’ GPS and fuel data…</EmptyNote>}
        {run.status === 'error' && <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>{run.message}</EmptyNote>}
        {report && (
          <>
            <TableToolbar
              summary={<>Recovery Report · <strong>{plural(measured.length, 'vehicle')}</strong> with GPS<span className="rpt-sub"> · {companyName ?? orgCode ?? ''} · {dayWords(report.day)}</span></>}
              onCsv={downloadCsv}
              actions={<>
                {editor.button}
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
                <JpegButton word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save('pdf', landscape)} disabled={Boolean(file.busy)} title="The report as a PDF" />
                <button type="button" className="sp4-ghost-btn" onClick={previewPdf} disabled={Boolean(file.busy)} title="See the PDF before saving it">
                  <i className="ti ti-eye" aria-hidden="true" /> Preview
                </button>
              </>}
            />
            {preview && <PdfPreview state={preview} title="Recovery vehicle report" caption={dayWords(report.day)} edited={editor.edited ? 1 : 0} onRetry={previewPdf} onClose={closePreview} />}
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table recovery-table">
                <thead><tr>{COLUMNS.map((column, i) => <th key={column} scope="col" className={i > 1 ? 'rpt-num' : undefined}>{column}</th>)}</tr></thead>
                <tbody>
                  {vehicles.map((vehicle) => (
                    <tr key={vehicle.plate} className="sp4-tr">
                      <td className="rpt-unit">{vehicle.plate}</td>
                      <td>{vehicle.recoveryType === 'puncture' ? 'Puncture recovery' : 'Mechanical recovery'}</td>
                      <td className="rpt-num">{vehicle.distanceKm == null ? '–' : fmt(vehicle.distanceKm, 1)}</td>
                      <td className="rpt-num">{vehicle.fuelConsumedL == null ? '–' : fmt(vehicle.fuelConsumedL, 1)}</td>
                      <td className="rpt-num">{fmt(vehicle.stopsTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rpt-sub recovery-note">Stops are GPS stands of at least five minutes. Fuel is shown only when the day’s readings support a measurement. The route trace joins GPS fixes and is not a road map.</p>
            {vehicles.map((vehicle) => (
              <details key={`${vehicle.plate}-detail`} className="recovery-detail">
                <summary>{vehicle.plate} · {vehicle.recoveryType === 'puncture' ? 'Puncture' : 'Mechanical'} recovery · Route and stops</summary>
                {!vehicle.available
                  ? <p className="rpt-sub">This vehicle is not registered in this organisation or is outside your vehicle access scope.</p>
                  : !vehicle.hasTelemetry
                    ? <p className="rpt-sub">No GPS telemetry was recorded on {dayWords(report.day)}.</p>
                    : <>
                      <RouteTrace vehicle={vehicle} />
                      <h3 className="recovery-detail__heading">Stops over 5 minutes <span className="rpt-sub">· {fmt(vehicle.stopsTotal)}</span></h3>
                      {vehicle.stops.length ? (
                        <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                          <table className="sp4-table rpt-table">
                            <thead><tr><th>Location</th><th>Arrived</th><th>Left</th><th className="rpt-num">Duration</th><th>Remark</th></tr></thead>
                            <tbody>{vehicle.stops.map((stop, i) => (
                              <tr key={`${vehicle.plate}-${stop.arrivedAt}-${i}`} className="sp4-tr">
                                <td>{stop.location ?? (stop.lat != null && stop.lng != null ? `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}` : '–')}</td>
                                <td>{TIME.format(stop.arrivedAt)}</td>
                                <td>{TIME.format(stop.leftAt)}</td>
                                <td className="rpt-num">{Math.round(stop.durationMs / 60_000)} min</td>
                                <td>{stop.remark}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                      ) : <p className="rpt-sub">No stops over five minutes.</p>}
                    </>}
              </details>
            ))}
          </>
        )}
      </div>
    </>
  );
}
