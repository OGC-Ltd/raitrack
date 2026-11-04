/*
 * Speed Report, a tab under Movements (operator, 4 Nov 2026; West Kenya's daily
 * sheet, Sukari, Kabras and Nzoia too): each unit that went over its limit on a day. A template
 * (lib/reportTemplates): each organisation makes its own, and West Kenya's may
 * be made together. The server does the working; lib/speedReport lays out the
 * rows; this is the page, and the PDF, JPEG and CSV.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useReportOrgs } from '../../hooks/useReportOrgs';
import { loadSpeedReport, makeReportPdf } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { COLUMNS, FIGURES, PEAK_COLUMN, csvTable, dayWords, mergeRows, peakUrl, rowCells, rowsOfGroup, sections, speedPdfBody, summary, yesterday } from '../../lib/speedReport';
import JpegButton from '../shared/JpegButton';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import ReportIcon from '../shared/ReportIcon';
import CheckPicker from './CheckPicker';
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
const KPI_LABELS = ['Units over', 'Occurrences', 'Highest, km/h', 'Distance over, km', 'Mileage, km'];

export default function SpeedReport({ orgId, orgCode, companyName, active = true }) {
  const { picked, several, orgIdOf, nameOf, keepUnit, pickedWords, picker } = useReportOrgs('speedReport', { orgId, orgCode, companyName });
  const [day, setDay] = useState(() => yesterday());
  const [group, setGroup] = useState('all');
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
      const reports = [];
      const unread = [];
      for (const c of picked) {
        const oid = await orgIdOf(c);
        if (!oid) { unread.push(nameOf(c)); continue; }
        const rep = await loadSpeedReport({ orgId: oid, day });
        reports.push({ ...rep, rows: rep.rows.filter((r) => keepUnit(c, r.name)) });
      }
      if (id !== runId.current) return;
      setGroup('all');
      setRun({
        status: 'done', day, fleet: pickedWords, unread,
        rep: {
          day,
          failed: reports.reduce((n, r) => n + r.failed, 0),
          fromTelemetry: reports.reduce((n, r) => n + r.fromTelemetry, 0),
          rows: mergeRows(reports.map((r) => r.rows)),
        },
      });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // A tab under Movements: it runs when first opened, not with the page.
  useEffect(() => { if (active && orgId && run.status === 'idle') execute(); }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = run.status === 'done' ? run : null;
  const groups = useMemo(() => (done ? sections(done.rep.rows).map((s) => s.group) : []), [done]);
  const rows = useMemo(() => (done ? rowsOfGroup(done.rep.rows, group) : []), [done, group]);
  const s = useMemo(() => (done ? summary(rows) : null), [done, rows]);
  const fleet = done ? done.fleet : (companyName ?? orgCode ?? '');

  const values = s
    ? [fmt(s.units), fmt(s.occurrences), s.fastest ? fmt(Math.round(s.fastest)) : '-', fmt(Math.round(s.overKm)), fmt(Math.round(s.km))]
    : KPI_LABELS.map((label) => <span key={label} className="frp-kpi-none">-</span>);

  const save = async (as, landscape = false) => {
    if (!done || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makeReportPdf({ orgId, kind: 'speed', body: speedPdfBody(rows, { day: done.rep.day, fleet, group }), landscape });
      if (as === 'jpeg') await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };
  const saveCsv = () => done && downloadTableCsv({ ...csvTable(rows), filenameSlug: `speed-report-${done.rep.day}` });

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {KPI_LABELS.map((label, i) => <Kpi key={label} label={label} value={values[i]} />)}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker from={day} to={day} today={today} maxDays={1} spans={[]} label="Day" on onChange={(d) => setDay(d)} />
        {groups.length > 1 && (
          <label className="rpt-sub tat-field">
            Units
            <select className="tat-input" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">All</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        )}
        {picker && <CheckPicker {...picker} />}
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={execute}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report for this day'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name="speedReport" />} title="Speed Report">
            Each unit that went over its limit on a day.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">{several ? `${picked.length} organisations. ` : ''}Reading each unit’s messages for the day; this can take up to a minute…</EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}
        {done && !rows.length && (
          <EmptyNote icon={<ReportIcon name="speedReport" />} title="No Overspeeding">
            No unit went over its limit on {dayWords(done.rep.day)}.
          </EmptyNote>
        )}
        {done && rows.length > 0 && (
          <>
            <TableToolbar
              summary={<>
                Speed Report · <strong>{fmt(s.units)}</strong> unit{s.units === 1 ? '' : 's'} over the limit, {fmt(s.occurrences)} occurrence{s.occurrences === 1 ? '' : 's'}
                <span className="rpt-sub"> · {fleet} · {dayWords(done.rep.day)}</span>
                {done.rep.failed > 0 && <span className="rpt-warn"> · {done.rep.failed} unit{done.rep.failed === 1 ? '' : 's'} could not be read</span>}
                {done.rep.fromTelemetry > 0 && <span className="rpt-warn"> · {done.rep.fromTelemetry} unit{done.rep.fromTelemetry === 1 ? '' : 's'} read from stored positions, not Wialon</span>}
                {done.unread.length > 0 && <span className="rpt-warn"> · {done.unread.join(', ')} could not be opened</span>}
              </>}
              onCsv={saveCsv}
              onPdf={file.busy ? undefined : () => save('pdf')}
              actions={<>
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
              </>}
            />
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table tat-table">
                <thead>
                  <tr>{COLUMNS.map((h, i) => <th key={h} scope="col" className={FIGURES.has(i) ? 'rpt-num' : undefined}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sections(rows).map((sec) => (
                    <Fragment key={sec.group}>
                      <tr className="rpt-group">
                        <th colSpan={COLUMNS.length} scope="rowgroup">
                          <span className="rpt-group__name">{sec.group}</span>
                          <span className="rpt-group__meta">{sec.rows.length} unit{sec.rows.length === 1 ? '' : 's'}</span>
                        </th>
                      </tr>
                      {sec.rows.map((r) => (
                        <tr key={r.vehicleId} className="sp4-tr">
                          {rowCells(r).map((v, i) => (
                            <td key={i} className={i === 0 ? 'rpt-unit' : FIGURES.has(i) ? 'rpt-num' : undefined}>
                              {i === PEAK_COLUMN && peakUrl(r)
                                ? <a href={peakUrl(r)} target="_blank" rel="noreferrer" title="Where it happened, on Google Maps">{v}</a>
                                : v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
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
