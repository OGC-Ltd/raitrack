/*
 * Probe Disconnection Report, a tab under Movements (operator, 5 Nov 2026; West
 * Kenya's Wialon sheet, Sukari and Kabras too): each time a unit's fuel probe
 * was disconnected. A template (lib/reportTemplates): each organisation makes
 * its own, and West Kenya's may be made together. The server reads and joins the
 * alerts; lib/probeReport lays out the rows; this is the page, and the PDF, JPEG
 * and CSV, all from the one document (lib/reportDocs).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useReportOrgs } from '../../hooks/useReportOrgs';
import { loadProbeReport, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { MAX_DAYS, PLACE_COLUMN, RUN_FIGURES, RUN_HEADS, UNIT_FIGURES, UNIT_HEADS, byUnit, mapUrl, mergeRows, periodWords, runCells, summary, unitCells, yesterday } from '../../lib/probeReport';
import { probeDoc } from '../../lib/reportDocs';
import { docCsv, docSlug } from '../../lib/docCsv';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import PdfPreview from '../shared/PdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import CheckPicker from './CheckPicker';
import { useReportEditor } from './ReportEditor';
import DateRangePicker from '../layout/DateRangePicker';

function Kpi({ value, label }) {
  return (
    <div className="sp4-kpi">
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

const fmt = (n) => n.toLocaleString('en-GB');
const KPI_LABELS = ['Units', 'Disconnections', 'Alerts'];
const plural = (n, one) => `${fmt(n)} ${one}${n === 1 ? '' : 's'}`;

export default function ProbeReport({ orgId, orgCode, companyName, active = true }) {
  const { picked, several, orgIdOf, nameOf, keepUnit, pickedWords, picker } = useReportOrgs('probeReport', { orgId, orgCode, companyName });
  const [days, setDays] = useState(() => ({ from: yesterday(), to: yesterday() }));
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);
  const today = yesterday(Date.now() + 86_400_000);
  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a day' : days.to > today ? 'That day has not happened yet' : null;

  const execute = async () => {
    if (problem) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    try {
      const reports = [];
      const unread = [];
      for (const c of picked) {
        const oid = await orgIdOf(c);
        if (!oid) { unread.push(nameOf(c)); continue; }
        const rep = await loadProbeReport({ orgId: oid, from: days.from, to: days.to });
        reports.push({ ...rep, rows: rep.rows.filter((r) => keepUnit(c, r.name)) });
      }
      if (id !== runId.current) return;
      setRun({
        status: 'done', ...days, fleet: pickedWords, unread,
        failed: reports.reduce((n, r) => n + r.failed, 0),
        eventsSeen: reports.reduce((n, r) => n + r.eventsSeen, 0),
        rows: mergeRows(reports.map((r) => r.rows)),
      });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // A tab under Movements: it runs when first opened, not with the page.
  useEffect(() => { if (active && orgId && run.status === 'idle') execute(); }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = run.status === 'done' ? run : null;
  const rows = useMemo(() => done?.rows ?? [], [done]);
  const units = useMemo(() => byUnit(rows), [rows]);
  const s = useMemo(() => (done ? summary(rows) : null), [done, rows]);
  const fleet = done ? done.fleet : (companyName ?? orgCode ?? '');
  const words = done ? periodWords(done.from, done.to) : '';

  const values = s
    ? [fmt(s.units), fmt(s.runs), fmt(s.alerts)]
    : KPI_LABELS.map((label) => <span key={label} className="frp-kpi-none">-</span>);

  const sheet = () => probeDoc(rows, { from: done.from, to: done.to, fleet, orgCode });
  const editor = useReportEditor({ orgId, source: rows, build: sheet });

  // The file the PDF, the JPEG and the Preview share, the way up asked
  const makePdf = (landscape) => (editor.edited ? editor.make(landscape) : makeReportDoc({ orgId, landscape, doc: sheet() }));
  const preview = usePdfPreview(makePdf);
  const save = async (as, landscape = false) => {
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
  const saveCsv = () => { if (done) { const d = sheet(); downloadTableCsv({ ...docCsv(d), filenameSlug: docSlug(d) }); } };

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {KPI_LABELS.map((label, i) => <Kpi key={label} label={label} value={values[i]} />)}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker from={days.from} to={days.to} today={today} maxDays={MAX_DAYS} spans={[]} label="Days" on onChange={(from, to) => setDays({ from, to: to ?? from })} />
        {picker && <CheckPicker {...picker} />}
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => editor.guard('Make the report again', execute)}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report for these days'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      {editor.overlay}

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name="probeReport" />} title="Probe Disconnection Report">
            Each time a truck’s fuel probe was disconnected.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">{several ? `${picked.length} organisations. ` : ''}Reading each unit’s alerts from Wialon; this can take up to a minute…</EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}
        {done && !rows.length && (
          <EmptyNote icon={<ReportIcon name="probeReport" />} title="No Probe Disconnections">
            {done.eventsSeen === 0
              // Not a clean result: nothing was recorded, of any rule, so nothing shows the probes were connected
              ? `Wialon recorded no alerts of any kind for ${done.fleet} on ${words}, so this does not show the probes stayed connected.`
              : `Wialon has no probe disconnection alert for ${done.fleet} on ${words}.`}
            {done.failed > 0 ? ` ${plural(done.failed, 'unit')} could not be read.` : ''}
            {done.unread.length > 0 ? ` ${done.unread.join(', ')} could not be opened.` : ''}
          </EmptyNote>
        )}
        {done && rows.length > 0 && (
          <>
            <TableToolbar
              summary={<>
                Probe Disconnections · <strong>{plural(s.units, 'unit')}</strong>, {plural(s.runs, 'disconnection')}, {plural(s.alerts, 'alert')}
                <span className="rpt-sub"> · {fleet} · {words}</span>
                {done.failed > 0 && <span className="rpt-warn"> · {plural(done.failed, 'unit')} could not be read</span>}
                {done.unread.length > 0 && <span className="rpt-warn"> · {done.unread.join(', ')} could not be opened</span>}
              </>}
              onCsv={saveCsv}
              actions={<>
                {editor.button}
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
                <JpegButton word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save('pdf', landscape)} disabled={Boolean(file.busy)} title="The report as a PDF" />
                <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Probe disconnection report" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}
            <section className="rpt-events" aria-label="By unit">
              <h3 className="rpt-events__title">By unit <span className="rpt-sub">· {plural(s.units, 'unit')}</span></h3>
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className="sp4-table rpt-table">
                  <thead><tr>{UNIT_HEADS.map((h, i) => <th key={h} scope="col" className={UNIT_FIGURES.has(i) ? 'rpt-num' : undefined}>{h}</th>)}</tr></thead>
                  <tbody>
                    {units.map((u) => (
                      <tr key={u.vehicleId} className="sp4-tr">
                        {unitCells(u).map((v, i) => <td key={UNIT_HEADS[i]} className={i === 0 ? 'rpt-unit' : UNIT_FIGURES.has(i) ? 'rpt-num' : undefined}>{v}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rpt-events" aria-label="Each disconnection">
              <h3 className="rpt-events__title">Each disconnection <span className="rpt-sub">· {plural(s.runs, 'disconnection')}</span></h3>
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className="sp4-table rpt-table">
                  <thead><tr>{RUN_HEADS.map((h, i) => <th key={h} scope="col" className={RUN_FIGURES.has(i) ? 'rpt-num' : undefined}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.vehicleId}|${r.at}`} className="sp4-tr">
                        {runCells(r).map((v, i) => (
                          <td key={RUN_HEADS[i]} className={i === 0 ? 'rpt-unit' : RUN_FIGURES.has(i) ? 'rpt-num' : undefined}>
                            {i === PLACE_COLUMN && mapUrl(r) ? <a href={mapUrl(r)} target="_blank" rel="noreferrer" title="Where it happened, on Google Maps">{v}</a> : v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
