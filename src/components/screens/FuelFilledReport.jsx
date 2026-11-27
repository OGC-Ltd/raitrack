/*
 * Fuel filled, a tab under Movements › Fuel (2026-11-27; Aquamist's sheet,
 * "Filling as per Fuel Probes"): each refuel, its day, the unit and the litres
 * the fuel probe saw go in. Read off the fuel ledger (fleet-server
 * fuel/fillings); lib/fuelFilledReport joins a stop's overlapping rows into one
 * refuel. The PDF, JPEG, CSV and Excel all come from the one document
 * (lib/reportDocs fuelFilledDoc).
 *
 * No records-side quantity (Aquamist's own issue records) is held on the
 * platform: FactorySuite fuel issues are Mufindi's alone. So no Variance or
 * Comment columns here; a sheet that has them is reconciled with Reconcile a
 * sheet (ProbeReconUpload), shown as its own report (ProbeReconView).
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { loadFuelFillings, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { FIGURES, HEADS, MAX_DAYS, dayWords, groupsOf, periodWords, plateHas, refuelsOf, regOf, rowCells, setAsideOf, summary, unitsOf, ymdOf, yesterday } from '../../lib/fuelFilledReport';
import { fuelFilledDoc } from '../../lib/reportDocs';
import { docCsv, docSlug } from '../../lib/docCsv';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import PdfPreview from '../shared/PdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import PlateFind from './PlateFind';
import ProbeReconUpload from './ProbeReconUpload';
import ProbeReconView from './ProbeReconView';
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
const fmtL = (n) => n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const KPI_LABELS = ['Units', 'Refuels', 'Filled, L'];
const plural = (n, one) => `${fmt(n)} ${one}${n === 1 ? '' : 's'}`;
const DAY_MS = 86_400_000;
// The table drops the Date column: the rows sit under their day's heading, as Trips groups its units
const TABLE_COLS = HEADS.map((h, i) => i).filter((i) => i !== 0);

export default function FuelFilledReport({ orgId, orgCode, companyName, active = true }) {
  const today = yesterday(Date.now() + DAY_MS);
  // One click runs these, as Trips' Last hour / 2 hours / 4 hours do
  const quick = [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: yesterday(Date.now()), to: yesterday(Date.now()) },
    { key: 'week', label: 'Last 7 days', from: yesterday(Date.now() - 5 * DAY_MS), to: today },
  ];
  const [days, setDays] = useState(() => ({ from: today, to: today }));
  const [find, setFind] = useState('');
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  // A reconciled sheet (Reconcile a sheet): shown as its own report until closed
  const [recon, setRecon] = useState(null);
  const runId = useRef(0);
  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a day' : days.to > today ? 'That day has not happened yet' : null;

  // A quick chip passes its own days: they are always a real, past period
  const execute = async (d = days) => {
    if (!orgId || (problem && d === days)) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    try {
      const { fills, capped } = await loadFuelFillings({ orgId, from: d.from, to: d.to });
      if (id !== runId.current) return;
      setRun({ status: 'done', from: d.from, to: d.to, fleet: companyName ?? orgCode ?? '', capped, setAside: setAsideOf(fills), rows: refuelsOf(fills) });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // A tab under Movements: it runs when first opened, not with the page.
  useEffect(() => { if (active && orgId && run.status === 'idle') execute(); }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = run.status === 'done' ? run : null;
  const all = useMemo(() => done?.rows ?? [], [done]);
  const rows = useMemo(() => (find.trim() ? all.filter((r) => plateHas(regOf(r), find)) : all), [all, find]);
  const byDay = useMemo(() => groupsOf(rows, (r) => ymdOf(r.at)), [rows]);
  const s = useMemo(() => summary(rows), [rows]);
  // One unit left by the search names the report; several keep the fleet's name
  const shownUnits = useMemo(() => unitsOf(rows), [rows]);
  const unitWords = find.trim() && shownUnits.length === 1 ? shownUnits[0].label : '';
  const words = done ? periodWords(done.from, done.to) : '';

  const values = done
    ? [fmt(s.units), fmt(s.refuels), fmtL(s.litres)]
    : KPI_LABELS.map((label) => <span key={label} className="frp-kpi-none">-</span>);

  const sheet = () => fuelFilledDoc(rows, { from: done.from, to: done.to, fleet: done.fleet, unit: unitWords, orgCode });
  const makePdf = (landscape) => makeReportDoc({ orgId, landscape, doc: sheet() });
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

  if (recon) {
    return <ProbeReconView key={recon.name + recon.rows.length} recon={recon} orgId={orgId} orgCode={orgCode} fleet={companyName ?? orgCode ?? ''}
                           onClose={() => setRecon(null)} onReplace={setRecon} />;
  }

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {KPI_LABELS.map((label, i) => <Kpi key={label} label={label} value={values[i]} />)}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Days">
          {quick.map((q) => {
            const on = days.from === q.from && days.to === q.to;
            return (
              <button key={q.key} type="button" aria-pressed={on} disabled={!orgId || run.status === 'loading'}
                      className={`sp4-filter-chip${on ? ' sp4-filter-chip--on' : ''}`}
                      onClick={() => { const d = { from: q.from, to: q.to }; setDays(d); execute(d); }}>
                {q.label}
              </button>
            );
          })}
        </div>
        <DateRangePicker from={days.from} to={days.to} today={today} maxDays={MAX_DAYS} spans={[]} label="Days"
                         on={!quick.some((q) => days.from === q.from && days.to === q.to)}
                         onChange={(from, to) => setDays({ from, to: to ?? from })} />
        <ProbeReconUpload orgId={orgId} onDone={setRecon} />
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => execute()}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report for these days'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name="fuelFilled" />} title="Fuel Filled Report">
            Each refuel and the litres the fuel probe measured going in.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">Reading the fuel ledger for these days…</EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: () => execute() }}>
            {run.message}
          </EmptyNote>
        )}
        {done && !all.length && (
          <EmptyNote icon={<ReportIcon name="fuelFilled" />} title="No Refuels">
            The fuel probes recorded no refuel for {unitWords || done.fleet} on {words}.
            {done.setAside > 0 ? ` ${plural(done.setAside, 'reading')} the verifier ruled were not fuel in ${done.setAside === 1 ? 'was' : 'were'} left out.` : ''}
          </EmptyNote>
        )}
        {done && all.length > 0 && (
          <>
            <TableToolbar
              summary={<>
                Fuel Filled · <strong>{plural(s.refuels, 'refuel')}</strong>, {fmtL(s.litres)} L, {plural(s.units, 'unit')}
                <span className="rpt-sub"> · {unitWords || done.fleet} · {words}</span>
                {s.joined > 0 && <span className="rpt-sub" title="Wialon split these refuels; the rows at one stop are joined, not added"> · {plural(s.joined, 'split row')} joined</span>}
                {done.setAside > 0 && <span className="rpt-sub" title="The verifier ruled these were not fuel in (the level came back, or a sensor fault)"> · {fmt(done.setAside)} set aside</span>}
                {done.capped && <span className="rpt-warn"> · too many rows: pick fewer days</span>}
              </>}
              onCsv={saveCsv}
              actions={<>
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy) || !rows.length} title="The PDF report as an image" />
                <JpegButton word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save('pdf', landscape)} disabled={Boolean(file.busy) || !rows.length} title="The report as a PDF" />
                <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy) || !rows.length} />
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Fuel filled report" edited={0} onRetry={preview.retry} onClose={preview.close} />}
            <PlateFind value={find} onChange={setFind} shown={rows.length} total={all.length} noun="refuel" />
            {rows.length > 0 && (
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table">
                <thead><tr>{TABLE_COLS.map((i) => <th key={HEADS[i]} scope="col" className={FIGURES.has(i) ? 'rpt-num' : undefined}>{HEADS[i]}</th>)}</tr></thead>
                <tbody>
                  {byDay.map((g) => {
                    const d = summary(g.rows);
                    return (
                      <Fragment key={g.key}>
                        <tr className="rpt-group">
                          <th colSpan={TABLE_COLS.length} scope="rowgroup">
                            <span className="rpt-group__name">{dayWords(g.key)}</span>
                            <span className="rpt-group__meta">{plural(d.refuels, 'refuel')}, {fmtL(d.litres)} L, {plural(d.units, 'unit')}</span>
                          </th>
                        </tr>
                        {g.rows.map((r) => {
                          const cells = rowCells(r);
                          return (
                            <tr key={`${r.vehicleId}|${r.at}`} className="sp4-tr">
                              {TABLE_COLS.map((i) => (
                                <td key={HEADS[i]} className={i === 2 ? 'rpt-unit' : FIGURES.has(i) ? 'rpt-num' : undefined}
                                    title={i === 3 && r.rows > r.fills ? `${r.rows} ledger rows at this stop (several sensors, or a split ramp), counted once (${regOf(r)})` : i === 3 && r.pending ? 'Still within the verifier’s wait; the figure may yet move' : undefined}>
                                  {cells[i]}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
