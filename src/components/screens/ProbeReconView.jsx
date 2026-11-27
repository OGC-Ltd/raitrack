/*
 * The reconciled sheet as a report (Fuel Filled › Reconcile a sheet; operator,
 * 2026-11-27: "a report like the standard reports"): its figures, each row with
 * the records' and the probe's litres and the variance, a unit filter, and the
 * PDF, JPEG, CSV and preview off one document (lib/reportDocs probeReconDoc).
 * Excel saves the filled sheet itself, in the sheet's own format.
 */

import { useMemo, useState } from 'react';
import { makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { CHECK, RECON_FIGURES, RECON_HEADS, reconCells, reconSummary, dmyOf } from '../../lib/probeRecon';
import { probeReconDoc } from '../../lib/reportDocs';
import { docCsv, docSlug } from '../../lib/docCsv';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import PdfPreview from '../shared/PdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ChoicePicker from './ChoicePicker';
import ProbeReconUpload from './ProbeReconUpload';

const fmt = (n) => n.toLocaleString('en-GB');
const fmtL = (n) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n, one) => `${fmt(n)} ${one}${n === 1 ? '' : 's'}`;
const KPI_LABELS = ['Rows checked', 'Records, L', 'Probes, L', 'Variance, L'];
const CHECKS = [null, CHECK.FILLED, CHECK.NO_FILL, CHECK.BEFORE, CHECK.NOT_ON_PLATFORM];

function Kpi({ value, label }) {
  return (
    <div className="sp4-kpi">
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

export default function ProbeReconView({ recon, orgId, orgCode, fleet, onClose, onReplace }) {
  const [unit, setUnit] = useState(null);
  const [check, setCheck] = useState(null);
  const [file, setFile] = useState({ busy: false, error: null });

  const all = recon.rows;
  const units = useMemo(() => {
    const m = new Map();
    for (const r of all) m.set(r.key, (m.get(r.key) ?? { key: r.key, label: r.plate, n: 0 }));
    for (const r of all) m.get(r.key).n += 1;
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  }, [all]);
  const pick = unit && units.some((u) => u.key === unit) ? unit : null;
  const rows = useMemo(() => all.filter((r) => (!pick || r.key === pick) && (!check || r.check === check)), [all, pick, check]);
  const s = useMemo(() => reconSummary(rows), [rows]);
  const unitWords = pick ? units.find((u) => u.key === pick)?.label ?? '' : '';
  const words = s.from ? (s.from === s.to ? dmyOf(s.from) : `${dmyOf(s.from)} to ${dmyOf(s.to)}`) : '';

  const doc = () => probeReconDoc(rows, { fleet, unit: unitWords, orgCode, sheet: recon.name });
  const makePdf = (landscape) => makeReportDoc({ orgId, landscape, doc: doc() });
  const preview = usePdfPreview(makePdf);
  const save = async (as, landscape = false) => {
    if (file.busy) return;
    setFile({ busy: as, error: null });
    try {
      if (as === 'sheet') await recon.saveSheet();
      else {
        const { blob, filename } = await makePdf(landscape);
        if (as === 'jpeg') await savePdfAsJpeg(blob, filename);
        else saveFile(blob, filename);
      }
      setFile({ busy: false, error: null });
    } catch (err) {
      const what = as === 'sheet' ? 'filled sheet' : as === 'jpeg' ? 'JPEG' : 'PDF';
      setFile({ busy: false, error: `The ${what} could not be made: ${err?.message ?? err}` });
    }
  };
  const saveCsv = () => { const d = doc(); downloadTableCsv({ ...docCsv(d), filenameSlug: docSlug(d) }); };

  const values = [`${fmt(s.filled)} / ${fmt(s.rows)}`, fmtL(s.recordsL), fmtL(s.probeL), fmtL(s.varianceL)];
  const sheetWord = recon.ext === 'csv' ? 'CSV' : 'Excel';

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {KPI_LABELS.map((label, i) => <Kpi key={label} label={label} value={values[i]} />)}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <button type="button" className="sp4-ghost-btn" onClick={onClose} title="Back to the refuels for the days picked">
          <i className="ti ti-arrow-left" aria-hidden="true" /> Back to refuels
        </button>
        <ChoicePicker icon="ti-truck" label="Unit" value={pick} search
                      options={[{ value: null, label: 'All units', note: all.length },
                        ...units.map((u) => ({ value: u.key, label: u.label, note: u.n }))]}
                      onChange={setUnit} />
        <ChoicePicker icon="ti-filter" label="Check" value={check}
                      options={CHECKS.map((c) => ({ value: c, label: c ?? 'All rows', note: c ? all.filter((r) => r.check === c).length : all.length }))}
                      onChange={setCheck} />
        <ProbeReconUpload orgId={orgId} onDone={onReplace} />
      </div>

      <div className="sp4-body rpt-body">
        {!rows.length ? (
          <EmptyNote icon="ti-file-search" title="No Rows">Nothing on the sheet matches these filters.</EmptyNote>
        ) : (
          <>
            <TableToolbar
              summary={<>
                Fuel Reconciliation · <strong>{plural(s.filled, 'row')} checked</strong> of {fmt(s.rows)}, variance {fmtL(s.varianceL)} L
                <span className="rpt-sub"> · {unitWords || fleet} · {words} · {recon.name}</span>
                {s.noFill > 0 && <span className="rpt-sub" title="That unit had no probe refuel on that day: left blank"> · {fmt(s.noFill)} no fill that day</span>}
                {s.before > 0 && <span className="rpt-sub" title={`Dated before the fuel records begin (${dmyOf(recon.coveredFrom)}); the sheet's figures are kept`}> · {fmt(s.before)} before the records</span>}
                {s.notOnPlatform > 0 && <span className="rpt-sub" title="The Reg No is not a unit on the platform; the sheet's figures are kept"> · {fmt(s.notOnPlatform)} not on the platform</span>}
              </>}
              onCsv={saveCsv}
              actions={<>
                {file.busy ? <span className="rpt-sub">{file.busy === 'sheet' ? 'Writing the sheet…' : file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <button type="button" className="sp4-ghost-btn" onClick={() => save('sheet')} disabled={Boolean(file.busy)}
                        title={`The uploaded sheet with Filling as per Fuel Probes and Variance filled in, as ${sheetWord}`}>
                  <i className="ti ti-file-spreadsheet" aria-hidden="true" /> Filled sheet
                </button>
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The report as an image" />
                <JpegButton word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save('pdf', landscape)} disabled={Boolean(file.busy)} title="The report as a PDF" />
                <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Fuel reconciliation report" edited={0} onRetry={preview.retry} onClose={preview.close} />}
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table">
                <thead><tr>{RECON_HEADS.map((h, i) => <th key={h} scope="col" className={RECON_FIGURES.has(i) ? 'rpt-num' : undefined}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.row} className={`sp4-tr${r.check === CHECK.FILLED ? '' : ' rpt-sub'}`}>
                      {reconCells(r).map((v, i) => (
                        <td key={RECON_HEADS[i]} className={i === 1 ? 'rpt-unit' : RECON_FIGURES.has(i) ? 'rpt-num' : undefined}
                            title={i === 5 && r.kept ? 'Not checked: the sheet’s own figures are shown' : undefined}>
                          {v === '' || v == null ? '-' : v}
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
