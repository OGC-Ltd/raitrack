/*
 * Tankers Report (operator, 2–3 Nov 2026): Menengai's tankers on the road from
 * the Mombasa depot to MORL, where each is at the report time, how far it went
 * in the 4 hours before it, and how far since it left the depot. Rows coloured
 * as the operator's sheet is: white in transit, green trip completed (reached
 * MORL in the last 24 hours; the operator leaves out those already reported), red under half of what the middle tanker covered. The server makes the rows
 * (fleet-server reports/tankers-report.service); this is the page, its report
 * time, and the PDF, JPEG and CSV (lib/tankersReport).
 */

import { useEffect, useRef, useState } from 'react';
import { groupsFor, scopeUnits } from '../../lib/fleetGroups';
import { toLocalInput, fromLocalInput } from '../../lib/fleetReports';
import {
  TANKER_GROUP, WINDOW_MS, ROW_TINT, STATUS_WORDS, COLUMNS, DEPOT_WORDS,
  rowCells, counts, periodWords, csvTable, tankersHtml,
} from '../../lib/tankersReport';
import { loadTankersReport } from '../../api/reports';
import { saveLetterheadPdf, saveLetterheadJpeg, letterheadLogos } from '../../api/letterheadPdf';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import PdfPreview from '../shared/PdfPreview';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { useReportEditor } from './ReportEditor';
import { flowDoc } from '../../lib/reportDocs';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';

function Kpi({ value, label, tone }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ''}`}>
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

const dmy = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('/');

export default function TankersReport({ orgId, vehicles, orgCode, companyName, active = true }) {
  const [at, setAt] = useState(null);                       // the report time; null = now
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  // Rows the operator leaves out of this report, by unit (operator, 3 Nov 2026): a new run starts with none
  const [out, setOut] = useState(() => new Set());
  const toggleOut = (key) => setOut((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const runId = useRef(0);

  const now = Date.now();
  const problem = !orgId ? 'Waiting for the organisation to load'
    : at != null && at > now ? 'The report time is in the future'
      : null;

  const execute = async () => {
    if (problem) return;
    const id = ++runId.current;
    const live = () => id === runId.current;
    const to = at ?? Date.now();
    const from = to - WINDOW_MS;
    const ctx = { from, to };
    setOut(new Set());
    try {
      const { units, missing } = scopeUnits(vehicles, groupsFor('MENENGAI'), TANKER_GROUP);
      if (!units.length) { setRun({ status: 'done', rows: [], ctx, missing, failed: 0, tankers: 0 }); return; }
      // The server finds each tanker's trip from the depot (fleet-server reports/tankers-report.service)
      setRun({ status: 'loading', words: `Finding when tankers left the ${DEPOT_WORDS}` });
      const r = await loadTankersReport({
        orgId, to,
        units: units.map((u) => ({ key: u.key, plate: u.plate, vehicleIds: u.vehicles.map((v) => v.vehicleId) })),
      });
      if (!live()) return;
      setRun({ status: 'done', rows: r.rows, ctx, missing, failed: r.failed, tankers: r.tankers, noMorl: !r.morl, slow: r.slow });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // Made on opening the tab (operator, 3 Nov 2026: "run it by default"), once the fleet has loaded
  useEffect(() => {
    if (active && orgId && vehicles?.length && run.status === 'idle') execute();
  }, [active, orgId, vehicles?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = run.status === 'done' ? run : null;
  // What the PDF, JPEG, CSV and the figures hold: the rows not left out
  const kept = done ? done.rows.filter((r) => !out.has(r.unit.key)) : [];
  const c = done ? counts(kept) : null;
  const kpis = [
    { label: 'From Mombasa', value: c?.all },
    { label: 'In transit', value: c ? c.transit + c.still : undefined },
    { label: 'Trip completed', value: c?.completed, tone: c?.completed ? 'live' : undefined },
  ];

  const sheet = (landscape = false) => tankersHtml(kept, {
    ...done.ctx, companyName: companyName ?? 'Menengai', orgCode, logos: letterheadLogos(),
    failed: done.failed, slowLine: done.slow?.line ?? null, landscape,
  });
  const editor = useReportEditor({ orgId, source: `${done ? run.ctx?.to ?? '' : ''}|${[...out].join()}|${Boolean(done)}`, build: () => flowDoc(sheet()) });
  const save = async (as, landscape = false) => {
    if (!done || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      if (editor.edited) {
        const made = await editor.make(landscape);
        if (as === 'jpeg') await savePdfAsJpeg(made.blob, made.filename);
        else saveFile(made.blob, made.filename);
        setFile({ busy: false, error: null });
        return;
      }
      const { html, filename } = sheet(landscape);
      if (as === 'jpeg') {
        await saveLetterheadJpeg(html, { filename, landscape });
      } else {
        await saveLetterheadPdf(html, { filename, landscape });
      }
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };
  // The PDF on screen before it is saved (operator, 4 Nov 2026), as the other reports have it
  const preview = usePdfPreview(async (landscape) => {
    if (editor.edited) return editor.make(landscape);
    const { html, filename } = sheet(landscape);
    return saveLetterheadPdf(html, { filename, landscape, keep: true });
  });
  const saveCsv = () => {
    if (!done) return;
    downloadTableCsv({ ...csvTable(kept, done.ctx.from, done.ctx.to), filenameSlug: `tankers-${new Date(done.ctx.to + 3 * 3600_000).toISOString().slice(0, 10)}` });
  };

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone}
                 value={c ? k.value.toLocaleString('en-GB') : <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="rpt-field tkr-time" role="group" aria-label="Report time">
          <span className="rpt-field__l">Report time</span>
          <button type="button" aria-pressed={at == null}
                  className={`sp4-filter-chip${at == null ? ' sp4-filter-chip--on' : ''}`}
                  onClick={() => setAt(null)}>Now</button>
          <input type="datetime-local" className="rpt-select tkr-when" aria-label="Pick the report time"
                 value={toLocalInput(at ?? now)} max={toLocalInput(now)}
                 onChange={(e) => { const t = fromLocalInput(e.target.value); if (Number.isFinite(t)) setAt(t); }} />
        </div>
        <span className="rpt-sub tkr-window">4 hours: {periodWords((at ?? now) - WINDOW_MS, at ?? now)}</span>
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => editor.guard('Make the report again', execute)}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      {editor.overlay}

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name="tankers" />} title="Tankers">
            The {TANKER_GROUP} on the road from the {DEPOT_WORDS} to MORL, and the 4 hours up to the report time.
            Pick the report time, or leave it at Now, then press Run report.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report" progress={run.total ? run.done / run.total : null}>
            {run.total ? `${run.words}: ${Math.min(run.done + 1, run.total)} of ${run.total}.` : `${run.words}…`}
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}

        {done && (
          <>
            <TableToolbar
              summary={<>
                Tankers Movement · <strong>{kept.length}</strong> of {done.tankers} tankers from Mombasa
                {out.size > 0 && (
                  <span className="rpt-sub"> · {out.size} left out <button type="button" className="tkr-putback" onClick={() => editor.guard('Change the tankers listed', () => setOut(new Set()))}>Put all back</button></span>
                )}
                <span className="rpt-sub"> · {dmy(done.ctx.to)} · {periodWords(done.ctx.from, done.ctx.to)}</span>
                {done.failed > 0 && <span className="rpt-warn"> · {done.failed} could not be read</span>}
                {done.noMorl && <span className="rpt-warn"> · MORL’s geofence could not be read, so no trip shows as completed</span>}
              </>}
              onCsv={kept.length ? saveCsv : undefined}
              onPdf={file.busy ? undefined : (landscape) => save('pdf', landscape)} pdfWays
              actions={<>
                {editor.button}
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
                <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy) || preview.state?.status === 'loading'} />
              </>}
            />
            {preview.state && (
              <PdfPreview state={preview.state} title="Tankers report" onRetry={preview.retry} onClose={preview.close}
                          caption={`${dmy(done.ctx.to)} · ${periodWords(done.ctx.from, done.ctx.to)} · ${kept.length} tanker${kept.length === 1 ? '' : 's'}`} />
            )}
            {!done.rows.length ? (
              <EmptyNote icon="ti-circle-check" title="Nothing to Report">
                No tanker is on the road from the {DEPOT_WORDS} at the report time.
              </EmptyNote>
            ) : (
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className="sp4-table rpt-table tkr-table">
                  <thead>
                    <tr>
                      {COLUMNS.map((h, i) => <th key={h} scope="col" className={i >= 4 ? 'rpt-num' : undefined}>{h}</th>)}
                      <th scope="col" className="mvr-keep"><span className="sr-only">Keep or leave out</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {done.rows.map((r) => {
                      const cellsOf = rowCells(r, done.ctx.from, done.ctx.to);
                      const left = out.has(r.unit.key);
                      const tint = left ? null : ROW_TINT[r.status];
                      return (
                        <tr key={r.unit.key} className={`sp4-tr${tint ? ' tkr-row--tinted' : ''}${left ? ' mvr-row--out' : ''}`}
                            style={tint ? { background: tint } : undefined} title={left ? 'Left out of this report' : STATUS_WORDS[r.status]}>
                          {cellsOf.map((v, i) => (
                            <td key={i} className={i === 0 ? 'rpt-unit' : i >= 4 ? 'rpt-num' : undefined}>
                              {r.status === 'completed' && i === 4 ? <b>{v}</b> : v}
                            </td>
                          ))}
                          <td className="mvr-keep">
                            <button type="button" className="mvr-keep__btn" onClick={() => editor.guard('Change the tankers listed', () => toggleOut(r.unit.key))}
                                    title={left ? 'Put this tanker back in the report' : 'Leave this tanker out of the PDF, JPEG and CSV'}
                                    aria-label={left ? `Put ${r.unit.plate} back` : `Leave ${r.unit.plate} out`}>
                              <i className={`ti ${left ? 'ti-arrow-back-up' : 'ti-x'}`} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="tkr-key">
                  <span className="tkr-key__sw" /> In transit
                  <span className="tkr-key__sw" style={{ background: ROW_TINT.completed }} /> Trip completed (reached MORL in the last 24 hours)
                  <span className="tkr-key__sw" style={{ background: ROW_TINT.still }} /> Under half of what the middle tanker covered{done.slow ? ` (under ${done.slow.line.toFixed(1)} km of ${done.slow.median.toFixed(1)} km)` : ''}
                </p>
                {done.missing.length > 0 && (
                  <details className="rpt-missing">
                    <summary>{done.missing.length} tanker{done.missing.length === 1 ? '' : 's'} on the list {done.missing.length === 1 ? 'is' : 'are'} not tracked on the platform</summary>
                    <p>{done.missing.map((m) => m.plate).join(', ')}</p>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
