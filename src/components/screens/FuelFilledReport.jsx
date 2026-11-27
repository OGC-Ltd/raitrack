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

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadFuelFillings, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { FIGURES, HEADS, MAX_DAYS, periodWords, refuelsOf, regOf, rowCells, setAsideOf, summary, unitsOf, yesterday } from '../../lib/fuelFilledReport';
import { fuelFilledDoc } from '../../lib/reportDocs';
import { docCsv, docSlug } from '../../lib/docCsv';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import PdfPreview from '../shared/PdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import ChoicePicker from './ChoicePicker';
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

export default function FuelFilledReport({ orgId, orgCode, companyName, active = true }) {
  const today = yesterday(Date.now() + 86_400_000);
  const [days, setDays] = useState(() => ({ from: today, to: today }));
  const [unit, setUnit] = useState(null);
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  // A reconciled sheet (Reconcile a sheet): shown as its own report until closed
  const [recon, setRecon] = useState(null);
  const runId = useRef(0);
  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a day' : days.to > today ? 'That day has not happened yet' : null;

  const execute = async () => {
    if (problem) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    try {
      const { fills, capped } = await loadFuelFillings({ orgId, from: days.from, to: days.to });
      if (id !== runId.current) return;
      setRun({ status: 'done', ...days, fleet: companyName ?? orgCode ?? '', capped, setAside: setAsideOf(fills), rows: refuelsOf(fills) });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // A tab under Movements: it runs when first opened, not with the page.
  useEffect(() => { if (active && orgId && run.status === 'idle') execute(); }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = run.status === 'done' ? run : null;
  const all = useMemo(() => done?.rows ?? [], [done]);
  const units = useMemo(() => unitsOf(all), [all]);
  // A unit picked for another run that has no refuel in this one: show them all
  const pick = unit && units.some((u) => u.id === unit) ? unit : null;
  const rows = useMemo(() => (pick ? all.filter((r) => r.vehicleId === pick) : all), [all, pick]);
  const s = useMemo(() => summary(rows), [rows]);
  const unitWords = pick ? units.find((u) => u.id === pick)?.label ?? '' : '';
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
        <DateRangePicker from={days.from} to={days.to} today={today} maxDays={MAX_DAYS} spans={[]} label="Days" on onChange={(from, to) => setDays({ from, to: to ?? from })} />
        <ChoicePicker icon="ti-truck" label="Unit" value={pick} search
                      options={[{ value: null, label: 'All units', ...(done ? { note: all.length } : {}) },
                        ...units.map((u) => ({ value: u.id, label: u.label, note: all.filter((r) => r.vehicleId === u.id).length }))]}
                      onChange={setUnit} />
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={execute}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report for these days'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
        <ProbeReconUpload orgId={orgId} onDone={setRecon} />
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
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}
        {done && !rows.length && (
          <EmptyNote icon={<ReportIcon name="fuelFilled" />} title="No Refuels">
            The fuel probes recorded no refuel for {unitWords || done.fleet} on {words}.
            {done.setAside > 0 ? ` ${plural(done.setAside, 'reading')} the verifier ruled were not fuel in ${done.setAside === 1 ? 'was' : 'were'} left out.` : ''}
          </EmptyNote>
        )}
        {done && rows.length > 0 && (
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
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
                <JpegButton word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save('pdf', landscape)} disabled={Boolean(file.busy)} title="The report as a PDF" />
                <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Fuel filled report" edited={0} onRetry={preview.retry} onClose={preview.close} />}
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table">
                <thead><tr>{HEADS.map((h, i) => <th key={h} scope="col" className={FIGURES.has(i) ? 'rpt-num' : undefined}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.vehicleId}|${r.at}`} className="sp4-tr">
                      {rowCells(r).map((v, i) => (
                        <td key={HEADS[i]} className={i === 2 ? 'rpt-unit' : FIGURES.has(i) ? 'rpt-num' : undefined}
                            title={i === 3 && r.rows > r.fills ? `${r.rows} ledger rows at this stop (several sensors, or a split ramp), counted once (${regOf(r)})` : i === 3 && r.pending ? 'Still within the verifier’s wait; the figure may yet move' : undefined}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
