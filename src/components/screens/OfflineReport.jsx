/*
 * Dormant Assets Report, a tab under Movements (operator, 3 Nov 2026; was
 * Non-Updating Assets, a report of its own; West Kenya's sheet,
 * Menengai too): the vehicles whose trackers have stopped sending, in three
 * sections by the day of their last message: offline yesterday, for 48 hrs,
 * for over 48 hrs. A template (lib/reportTemplates): each organisation that
 * has it makes its own, and West Kenya's may be made together.
 * lib/offlineReport sorts the vehicles; this is the page, and the PDF, JPEG
 * and CSV.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { useReportOrgs } from '../../hooks/useReportOrgs';
import { loadMovementReport, makeReportPdf } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { fleetDay } from '../../lib/fleetReports';
import { SECTIONS, COLUMNS, BAR, asAtOf, offlineReport, offlineCount, rowCells, sectionDays, asAtWords, csvTable, offlinePdfBody } from '../../lib/offlineReport';
import JpegButton from '../shared/JpegButton';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import CheckPicker from './CheckPicker';
import DateRangePicker from '../layout/DateRangePicker';
import ReportIcon from '../shared/ReportIcon';

/** The window asked of Movements: only where each unit last was matters here. */
const WINDOW_MS = 3600_000;

function Kpi({ value, label, tone }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ''}`}>
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

export default function OfflineReport({ orgId, orgCode, companyName, active = true }) {
  const { picked, several, orgIdOf, nameOf, keepUnit, pickedWords, picker } = useReportOrgs('offline', { orgId, orgCode, companyName });
  const today = fleetDay(Date.now());
  const [day, setDay] = useState(today);
  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const runId = useRef(0);
  const problem = !orgId ? 'Waiting for the organisation to load' : null;

  const execute = async () => {
    if (problem) return;
    const id = ++runId.current;
    const live = () => id === runId.current;
    const now = asAtOf(day);
    const rows = [];
    const unread = [];
    try {
      for (const [n, c] of picked.entries()) {
        setRun({ status: 'loading', words: `${several ? `${nameOf(c)}: ` : ''}Reading each vehicle’s last message`, part: [n + 1, picked.length] });
        const oid = await orgIdOf(c);
        if (!oid) { unread.push(nameOf(c)); continue; }
        const moves = await loadMovementReport({ orgId: oid, from: now - WINDOW_MS, to: now, offline: true });
        if (!live()) return;
        rows.push(...(moves?.groups ?? []).flatMap((g) => g.rows ?? []).filter((r) => keepUnit(c, r.grouping ?? r.plate)));
      }
      setRun({ status: 'done', rep: offlineReport(rows, now), now, day, fleet: pickedWords, unread });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };
  // Opens made, for this organisation, once its tab is first shown: there is nothing to pick first
  useEffect(() => { if (active && orgId && run.status === 'idle') execute(); }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = run.status === 'done' ? run : null;
  const rep = done?.rep;
  const kpis = [
    ...SECTIONS.map((s) => ({ label: s.words, value: rep?.sections[s.key].length, tone: s.key === 'over' && rep?.sections.over.length ? 'speed' : undefined })),
    { label: 'Not updating', value: rep ? offlineCount(rep) : undefined },
  ];

  const save = async (as, landscape = false) => {
    if (!done || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makeReportPdf({ orgId, kind: 'dormant-assets', body: offlinePdfBody(rep, { fleet: done.fleet, now: done.now }), landscape });
      if (as === 'jpeg') await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };
  const saveCsv = () => {
    if (!done) return;
    downloadTableCsv({ ...csvTable(rep), filenameSlug: `dormant-assets-${new Date(done.now + 3 * 3600_000).toISOString().slice(0, 10)}` });
  };

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone}
                 value={rep ? k.value.toLocaleString('en-GB') : <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker from={day} to={day} today={today} maxDays={1} spans={[]} label="As at" on onChange={(d) => setDay(d)} />
        <span className="rpt-sub">As at {done ? asAtWords(done.now) : 'now'}</span>
        {picker && <CheckPicker {...picker} />}
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={execute}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report as at this day'}>
          {run.status === 'loading' ? 'Running…' : done?.day === day ? 'Refresh' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name="offline" />} title="Dormant Assets">
            The vehicles whose trackers have stopped sending, by the day of their last message.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">
            {run.part?.[1] > 1 ? `Organisation ${run.part[0]} of ${run.part[1]}. ` : ''}{run.words}…
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
                Dormant Assets · <strong>{offlineCount(rep)}</strong> of {rep.total} vehicles
                <span className="rpt-sub"> · {done.fleet} · as at {asAtWords(done.now)}</span>
                {done.unread.length > 0 && <span className="rpt-warn"> · {done.unread.join(', ')} could not be opened</span>}
              </>}
              onCsv={offlineCount(rep) ? saveCsv : undefined}
              onPdf={file.busy ? undefined : () => save('pdf')}
              actions={<>
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
              </>}
            />
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table ofl-table">
                <colgroup><col style={{ width: '30%' }} /><col style={{ width: '18%' }} /><col /></colgroup>
                <thead>
                  <tr>{COLUMNS.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {SECTIONS.map((s) => {
                    const list = rep.sections[s.key];
                    return (
                      <Fragment key={s.key}>
                        {/* A section is a group row, as in Movements, in the sheet's blue */}
                        <tr className="rpt-group ofl-group">
                          <th colSpan={3} scope="rowgroup" style={{ background: BAR }}>
                            <span className="rpt-group__name">{s.words}</span>
                            <span className="rpt-group__meta">{sectionDays(s, done.now)} · {list.length} vehicle{list.length === 1 ? '' : 's'}</span>
                          </th>
                        </tr>
                        {list.length ? list.map((r) => (
                          <tr key={r.vehicleId} className="sp4-tr">
                            {rowCells(r).map((v, i) => <td key={i} className={i === 0 ? 'rpt-unit' : undefined}>{v}</td>)}
                          </tr>
                        )) : (
                          <tr><td colSpan={3} className="rpt-sub ofl-none">No vehicle.</td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {rep.never.length > 0 && (
                <details className="rpt-missing">
                  <summary>{rep.never.length} vehicle{rep.never.length === 1 ? ' has' : 's have'} never reported to the platform</summary>
                  <p>{rep.never.map((m) => m.name).join(', ')}</p>
                </details>
              )}
              <p className="tkr-key">A tracker that stopped sending on the day of the report is not listed yet: it shows the next day, as offline yesterday.</p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
