/*
 * Reports (operator, 1 Nov 2026): four fleet reports on one page, each for a
 * period the reader picks, by the organisation's groups where it has them.
 *
 *   Driver behaviour     harsh acceleration, harsh braking, no seatbelt and on phone, per vehicle
 *   Night driving        distance covered in the night hours (19:00–05:00 unless changed)
 *   Overspeeding         overspeeds lasting more than 5 minutes unbroken, and their distance
 *   Vehicle utilisation  every vehicle's distance, time moving and fuel, stationary ones included
 *
 * The figures come from records the server already keeps (api/fleetReports);
 * how each report reads as a table is lib/reportTables, so the screen, the PDF
 * and the CSV are the same rows. The PDF is the End of shift letterhead (lib/letterhead).
 *
 * A report runs when Run is pressed, not on every change: the distance
 * reports read every unit's day of readings, which is a minute or two for a
 * large fleet, and a half-chosen period should not start that.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { useCompanies } from '../../context/AppContext';
import { ORG_CODE_BY_COMPANY } from '../../api/org';
import { loadHarshEvents, loadDashcamAlarms, loadOverspeeds, loadDistances } from '../../api/fleetReports';
import { groupsFor, scopeUnits } from '../../lib/fleetGroups';
import {
  presetRange, nightWindows, behaviourRows, overspeedRows, nightRows, utilisationRows, sections, RATED_SECTIONS,
  toLocalInput, fromLocalInput, whenWords, NIGHT, hourLabel, periodWords as periodText,
} from '../../lib/fleetReports';
import { REPORTS, csvTable, RATES, DEFAULT_RATE, isFigure, shownColumns, overStandard } from '../../lib/reportTables';
import { reportHtml } from '../../lib/reportLetterhead';
import { saveLetterheadPdf, letterheadLogos } from '../../api/letterheadPdf';
import { downloadTableCsv } from '../../utils/tableExport';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import { IncidentDialog, LoggedIncidents } from './OperatorIncidents';
import { loadEntries, saveEntries, upsert, remove } from '../../lib/operatorLog';
import { ActionDialog, FollowUpPanel } from './FollowUp';
import { casesFromRun, mergeCases, recordAction, periodCases, loadCases, saveCases } from '../../lib/followUp';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { downloadEndOfShiftReport } from '../../api/endOfShiftReport';
import { loadMovementReport, downloadEditedMovementReport } from '../../api/reports';
import ReportIcon from '../shared/ReportIcon';
import { reportKeysFor, useCurrentReport, chooseReport as pickReport } from '../../lib/reportNav';
import { DIRECTION, STATES, TINT, stamp, applyEdits, pdfRequest, isEdited, isMoving, isLoading, locationChanged } from '../../lib/movementReport';
import '../body/SensorPanel.css';
import './FuelReportScreen.css';
import './ReportsScreen.css';
import './OperatorIncidents.css';

const DAY = 86_400_000;
/** The End of Shift and CPO movements tabs: made by the server, not from REPORTS. */
const SHIFT = 'shift';
const MOVEMENTS = 'movements';
const SERVER_TABS = {
  [SHIFT]: { label: 'End of shift' },
  [MOVEMENTS]: { label: 'CPO movements' },
};
/** The movement report's windows, in hours. */
const MOVEMENT_WINDOWS = [2, 4];

const PRESETS = {
  today: 'Today',
  yesterday: 'Yesterday',
  lastNight: 'Last night',
  week: 'Last 7 days',
};
const presetsFor = (key) => (key === 'night' ? ['lastNight', 'yesterday', 'week'] : ['today', 'yesterday', 'week']);

const spanFor = (key) => {
  const id = (REPORTS[key] ?? REPORTS.behaviour).preset;
  return { id, ...presetRange(id) };
};

/** A period end, as the datetime picker face shows it. */
function WhenField({ label, value, onChange, min, max }) {
  const open = (e) => { try { e.currentTarget.showPicker?.(); } catch { /* typing still works */ } };
  return (
    <label className="frp-when">
      <span className="frp-when__l">{label}</span>
      <span className="frp-when__v">{Number.isFinite(value) ? whenWords(value) : '-'}</span>
      <i className="ti ti-calendar frp-when__i" aria-hidden="true" />
      <input type="datetime-local" className="frp-when__input" aria-label={label}
             value={Number.isFinite(value) ? toLocalInput(value) : ''}
             min={Number.isFinite(min) ? toLocalInput(min) : undefined}
             max={Number.isFinite(max) ? toLocalInput(max) : undefined}
             onClick={open}
             onChange={(e) => { const t = fromLocalInput(e.target.value); if (Number.isFinite(t)) onChange(t); }} />
    </label>
  );
}

/** The end-of-shift report's periods: today up to now (the default), or yesterday. */
const SHIFT_PRESETS = ['today', 'yesterday'];
/** The longest period the server makes it for (fleet-server END_OF_SHIFT_MAX_DAYS). */
const SHIFT_MAX_DAYS = 7;

/**
 * The end-of-shift report (moved here from the sidebar, operator 1 Nov 2026).
 * The server gathers the shift and draws the PDF. It opens on today from
 * midnight with To at the current time, kept current while Today is picked;
 * any other period can be picked, a week at most (operator, 2 Nov 2026).
 */
function ShiftReport({ orgId }) {
  const [span, setSpan] = useState(() => ({ id: 'today', ...presetRange('today') }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Today runs up to now: To follows the clock.
  useEffect(() => {
    if (span.id !== 'today') return undefined;
    const tick = setInterval(() => setSpan({ id: 'today', ...presetRange('today') }), 30_000);
    return () => clearInterval(tick);
  }, [span.id]);
  const now = Date.now();
  const problem = !orgId ? 'Waiting for the organisation to load'
    : !(span.to > span.from) ? 'The period ends before it starts'
    : span.to > now + 60_000 ? 'The period cannot end in the future'
    : span.to - span.from > SHIFT_MAX_DAYS * DAY ? `${SHIFT_MAX_DAYS} days at most for this report`
    : null;
  const pick = (next) => { setSpan(next); setError(null); };
  const run = async () => {
    if (busy || problem) return;
    // Today is made up to the moment the button is pressed.
    const period = span.id === 'today' ? presetRange('today') : span;
    setBusy(true); setError(null);
    try {
      await downloadEndOfShiftReport({ orgId, from: period.from, to: period.to });
    } catch (err) {
      setError(`The report could not be made: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="sp4-header rpt-header">
        <p className="rpt-blurb">The shift at a glance for the whole fleet, for the period picked: today from midnight up to now unless you change it. The server makes it as a PDF on the letterhead.</p>
      </div>
      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Period">
          {SHIFT_PRESETS.map((id) => (
            <button key={id} type="button" aria-pressed={span.id === id}
                    className={`sp4-filter-chip${span.id === id ? ' sp4-filter-chip--on' : ''}`}
                    onClick={() => pick({ id, ...presetRange(id) })}>{PRESETS[id]}</button>
          ))}
        </div>
        <div className="frp-range">
          <WhenField label="From" value={span.from} max={span.to} onChange={(t) => pick({ ...span, id: null, from: t })} />
          <span className="frp-range__dash" aria-hidden="true">–</span>
          <WhenField label="To" value={span.to} min={span.from} max={now} onChange={(t) => pick({ ...span, id: null, to: t })} />
        </div>
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={run}
                disabled={busy || Boolean(problem)} aria-busy={busy} title={problem ?? 'Make the report'}>
          {busy ? 'Making the report…' : 'Download PDF'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
        {error && <span className="rpt-problem" role="alert">{error}</span>}
      </div>
      <div className="sp4-body rpt-body">
        <EmptyNote icon={<ReportIcon name={SHIFT} />} title="End of Shift Report">
          Press Download PDF. It takes a few seconds while the server gathers the shift.
        </EmptyNote>
      </div>
    </>
  );
}

/** CPO movements tables and their edits, by organisation, while this browser tab is open. */
const movementsKept = new Map();

/** "5 vehicles", or "4 of 5 vehicles" once some are left out. */
function groupWords(g, edits) {
  const kept = g.rows.filter((r) => !edits[r.vehicleId]?.removed).length;
  const all = g.rows.length;
  return `${kept === all ? all : `${kept} of ${all}`} vehicle${all === 1 ? '' : 's'}`;
}

/**
 * CPO movements (operator, 2 Nov 2026): where every unit is now and whether it
 * is heading to or from MORL over the last 2 or 4 hours, as a table first. The
 * operator may correct a row's location or direction, or leave a row out,
 * before the PDF; the server draws the PDF from the table as edited
 * (lib/movementReport), counting the overview again from what is kept.
 */
function MovementsReport({ orgId }) {
  // Mounted afresh for each organisation (key={orgId}), from what was kept for it.
  const [saved] = useState(() => movementsKept.get(orgId));
  const [hours, setHours] = useState(saved?.hours ?? MOVEMENT_WINDOWS[0]);
  const [run, setRun] = useState(saved ? { status: 'done', report: saved.report } : { status: 'idle' });
  const [edits, setEdits] = useState(saved?.edits ?? {});   // by vehicleId: { location?, state?, removed? }
  const [pdf, setPdf] = useState({ busy: false, error: null });
  const [confirm, setConfirm] = useState(null);              // { words, go }: waits for the operator's yes
  const runId = useRef(0);

  const reset = () => { runId.current += 1; setRun({ status: 'idle' }); setEdits({}); };

  // The table and its edits outlive this tab: another report tab or page and
  // back finds them as they were. Only a finished table is kept.
  useEffect(() => {
    if (!orgId) return;
    if (run.status === 'done') movementsKept.set(orgId, { hours, report: run.report, edits });
    else movementsKept.delete(orgId);
  }, [orgId, hours, run, edits]);

  const execute = async () => {
    if (!orgId) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    try {
      const report = await loadMovementReport({ orgId, hours });
      if (id === runId.current) { setEdits({}); setRun({ status: 'done', report }); }
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const report = run.status === 'done' ? run.report : null;
  const kept = useMemo(() => (report ? applyEdits(report, edits) : null), [report, edits]);
  const changed = report ? report.groups.reduce((n, g) => n + g.rows.filter((r) => isEdited(r, edits[r.vehicleId])).length, 0) : 0;
  const edit = (vehicleId, patch) => setEdits((e) => ({ ...e, [vehicleId]: { ...e[vehicleId], ...patch } }));

  // Closing or reloading the browser tab would lose them: the browser asks first.
  useEffect(() => {
    if (!changed) return undefined;
    const warn = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);

  // A new run or another window replaces the table: with edits on it, ask first.
  const guard = (words, go) => (changed ? setConfirm({ words, go }) : go());

  const downloadPdf = async () => {
    if (!report || pdf.busy) return;
    setPdf({ busy: true, error: null });
    try {
      await downloadEditedMovementReport({ orgId, request: pdfRequest(report, edits) });
      setPdf({ busy: false, error: null });
    } catch (err) {
      setPdf({ busy: false, error: `The PDF could not be made: ${err?.message ?? err}` });
    }
  };

  const n = kept?.counts;
  const silentCount = n ? n.stale + n['no-fix'] : 0;
  const kpis = [
    { label: 'Vehicles', value: n?.total },
    { label: 'To MORL', value: n?.to, tone: n?.to ? 'live' : undefined },
    { label: 'From MORL', value: n?.from },
    { label: 'At MORL', value: n?.at },
    { label: 'Not reporting', value: silentCount, tone: silentCount ? 'speed' : undefined },
  ];

  return (
    <>
      <div className="sp4-header rpt-header">
        <p className="rpt-blurb">Where every unit was last seen, its speed, and whether it is heading to or from MORL over the window. Correct a location or a direction, or leave a unit out, then download the PDF.</p>
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone} value={n ? k.value.toLocaleString('en-GB') : <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Window">
          {MOVEMENT_WINDOWS.map((h) => (
            <button key={h} type="button" aria-pressed={hours === h}
                    className={`sp4-filter-chip${hours === h ? ' sp4-filter-chip--on' : ''}`}
                    onClick={() => { if (h !== hours) guard(`Show the last ${h} hours`, () => { setHours(h); reset(); }); }}>
              Last {h} hours
            </button>
          ))}
        </div>
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => guard('Run the report again', execute)}
                disabled={!orgId || run.status === 'loading'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
      </div>

      {confirm && (
        <div className="mvr-confirm" role="alertdialog" aria-labelledby="mvr-confirm-words">
          <span id="mvr-confirm-words">{confirm.words} and lose your {changed} edit{changed === 1 ? '' : 's'}?</span>
          <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setConfirm(null)} autoFocus>Keep editing</button>
          <button type="button" className="sp4-submit-btn frp-run mvr-confirm__go"
                  onClick={() => { const { go } = confirm; setConfirm(null); go(); }}>Discard edits</button>
        </div>
      )}

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name={MOVEMENTS} />} title="CPO Movements">
            Choose the window, then press Run report.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">
            Reading where every unit is. Up to half a minute while new places are named.
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made"
                     action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}

        {report && (
          <>
            <TableToolbar
              summary={<>
                <strong>{kept.counts.total.toLocaleString('en-GB')}</strong> vehicle{kept.counts.total === 1 ? '' : 's'}
                <span className="rpt-sub"> · {periodText(report.from, report.to)} · {report.morl ? `${report.morl} geofence` : 'no MORL geofence, so no direction'}</span>
                {changed > 0 && <span className="rpt-edited"> · {changed} edited</span>}
              </>}
              onPdf={pdf.busy ? undefined : downloadPdf}
              actions={<>
                {changed > 0 && <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setEdits({})}>Undo edits</button>}
                {pdf.busy ? <span className="rpt-sub">Making the PDF…</span> : pdf.error ? <span className="rpt-warn">{pdf.error}</span> : null}
              </>}
            />
            {!report.groups.length ? (
              <EmptyNote icon="ti-circle-check" title="Nothing to Report">No units are tracked for this fleet.</EmptyNote>
            ) : (
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className="sp4-table rpt-table mvr-table">
                  <thead>
                    <tr>
                      <th scope="col">Grouping</th>
                      <th scope="col">Last coordinates</th>
                      <th scope="col">Location</th>
                      <th scope="col" className="rpt-num">Speed</th>
                      <th scope="col">Direction</th>
                      <th scope="col"><span className="mvr-sr">Keep or leave out</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.groups.map((g) => (
                      <Fragment key={g.name}>
                        <tr className="rpt-group">
                          <th colSpan={6} scope="rowgroup">
                            <span className="rpt-group__name">{g.name}</span>
                            <span className="rpt-group__meta">{groupWords(g, edits)}</span>
                          </th>
                        </tr>
                        {g.rows.map((row) => {
                          const e = edits[row.vehicleId];
                          const out = Boolean(e?.removed);
                          const state = e?.state ?? row.state;
                          const location = e?.location ?? row.location ?? '';
                          const silent = row.stale || row.state === 'no-fix';
                          return (
                            <tr key={row.vehicleId} className={`sp4-tr${out ? ' mvr-row--out' : ''}`}
                                style={!out && TINT[state] ? { background: TINT[state] } : undefined}>
                              <td className={`rpt-unit${silent ? ' mvr-silent' : ''}`}>{row.grouping}</td>
                              <td className={row.stale ? 'mvr-silent' : undefined}>{stamp(row.lastAt)}</td>
                              <td className={out ? undefined : isLoading(row) ? 'mvr-cell--loading' : state === 'at' ? 'mvr-cell--morl' : isMoving({ ...row, state }) ? 'mvr-cell--moving' : undefined}>
                                <input type="text" className={`mvr-edit${locationChanged(row, location) ? ' mvr-edit--changed' : ''}`}
                                       value={location} placeholder="-" maxLength={200} disabled={out}
                                       aria-label={`Location of ${row.plate}`}
                                       onChange={(ev) => edit(row.vehicleId, { location: ev.target.value })} />
                              </td>
                              <td className="rpt-num">{row.speedKmh != null ? `${row.speedKmh} km/h` : '-'}</td>
                              <td>
                                <select className={`rpt-select mvr-edit${state !== row.state ? ' mvr-edit--changed' : ''}`}
                                        value={state} disabled={out} aria-label={`Direction of ${row.plate}`}
                                        onChange={(ev) => edit(row.vehicleId, { state: ev.target.value })}>
                                  {STATES.map((s) => <option key={s} value={s}>{DIRECTION[s]}</option>)}
                                </select>
                              </td>
                              <td className="mvr-keep">
                                <button type="button" className="mvr-keep__btn"
                                        onClick={() => edit(row.vehicleId, { removed: !out })}
                                        title={out ? 'Put this unit back in the report' : 'Leave this unit out of the PDF'}
                                        aria-label={out ? `Put ${row.plate} back` : `Leave ${row.plate} out`}>
                                  <i className={`ti ${out ? 'ti-arrow-back-up' : 'ti-x'}`} aria-hidden="true" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
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

function Kpi({ value, label, tone }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ''}`}>
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

export default function ReportsScreen() {
  const { vehicles = [], orgId } = useFleetLiveShared();
  const { activeCompany } = useCompanies();
  const orgCode = activeCompany?.code ?? ORG_CODE_BY_COMPANY[activeCompany?.id] ?? null;
  const groups = useMemo(() => groupsFor(orgCode), [orgCode]);
  // Mufindi (KASULU) has the machine register: utilization reads each unit
  // against its own rated burn, L/h or L/km, rather than one picked unit.
  const rated = String(orgCode ?? '').toUpperCase() === 'KASULU';

  const { can } = usePermissions();
  // Which tabs the grants allow (lib/reportNav); the sidebar's Reports tree
  // lists the same and picks among them too.
  const tabs = reportKeysFor(can);
  // End of shift first, where the grants allow it.
  const chosen = useCurrentReport() ?? tabs[0];
  const key = tabs.includes(chosen) ? chosen : tabs[0];
  const isServer = Boolean(SERVER_TABS[key]);
  const def = REPORTS[isServer ? 'behaviour' : key];
  const [span, setSpan] = useState(() => spanFor(key));
  const [group, setGroup] = useState(null);
  const [night, setNight] = useState(NIGHT);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [run, setRun] = useState({ status: 'idle' });
  const runId = useRef(0);

  // Incidents operators logged by hand (lib/operatorLog), kept in this browser.
  const me = useAuth().user;
  const by = me?.name || me?.email || '';
  const [entries, setEntries] = useState(() => loadEntries(orgId));
  const [saveFailed, setSaveFailed] = useState(false);
  const [dialog, setDialog] = useState(null);   // null | { entry? }
  useEffect(() => { setEntries(loadEntries(orgId)); }, [orgId]);
  const keep = (list) => { setEntries(list); setSaveFailed(!saveEntries(orgId, list)); };

  // Follow-up cases (lib/followUp), kept in this browser like the log.
  const [cases, setCases] = useState(() => loadCases(orgId));
  const [casesFailed, setCasesFailed] = useState(false);
  const [acting, setActing] = useState(null);   // the case id in the action form
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setCases(loadCases(orgId)); }, [orgId]);
  useEffect(() => {
    // Another tab, or the import, changed them; and "open for" moves on.
    const reload = () => setCases(loadCases(orgId));
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener('storage', reload);
    return () => { clearInterval(tick); window.removeEventListener('storage', reload); };
  }, [orgId]);
  const keepCases = (list) => { setCases(list); setCasesFailed(!saveCases(orgId, list)); };

  // A different organisation starts over: its groups and units differ.
  useEffect(() => {
    runId.current += 1;
    setRun({ status: 'idle' });
    setGroup(null);
  }, [orgId]);

  const reset = () => { runId.current += 1; setRun({ status: 'idle' }); };
  // Picked here or in the sidebar: the new report starts on its own period.
  const showing = useRef(key);
  useEffect(() => {
    if (showing.current === key) return;
    showing.current = key;
    setSpan(spanFor(key)); reset();
  }, [key]);
  const chooseReport = (k) => { if (k !== key) pickReport(k); };
  const choosePreset = (id) => { setSpan({ id, ...presetRange(id) }); reset(); };
  const setFrom = (t) => { setSpan((s) => ({ ...s, id: null, from: t })); reset(); };
  const setTo = (t) => { setSpan((s) => ({ ...s, id: null, to: t })); reset(); };

  const days = (span.to - span.from) / DAY;
  const problem = !orgId ? 'Waiting for the organisation to load'
    : !(span.to > span.from) ? 'The period ends before it starts'
    : days > def.maxDays ? `${def.maxDays} days at most for this report`
    : def.reachDays && span.from < Date.now() - def.reachDays * DAY ? `The dashcam keeps its alarms ${def.reachDays} days: start the period within them`
    : null;

  const execute = async () => {
    if (problem) return;
    const id = ++runId.current;
    const live = () => id === runId.current;
    const ctx = { from: span.from, to: span.to, group, night: { ...night }, rate, rated: rated && key === 'utilisation' };
    const { units, missing } = scopeUnits(vehicles, groups, group);
    if (!units.length) {
      setRun({ status: 'done', rows: [], secs: [], ctx, missing, failed: 0, units: 0 });
      return;
    }
    const step = (words) => ({ done, total }) => { if (live()) setRun({ status: 'loading', words, done, total }); };
    setRun({ status: 'loading', words: 'Starting', done: 0, total: 0 });
    try {
      let rows;
      let failed = 0;
      if (key === 'behaviour') {
        const [h, cam] = await Promise.all([
          loadHarshEvents({ orgId, from: ctx.from, to: ctx.to, onProgress: step('Reading harsh driving, day') }),
          loadDashcamAlarms({ orgId, from: ctx.from }),
        ]);
        ctx.dashcams = cam.cameras > 0;
        ctx.dashcamFailed = cam.failed;
        if (!live()) return;
        // The rows are worked out below, with the operators' entries, so a
        // new entry shows in the report without running it again.
        setRun({ status: 'done', raw: { events: h.events, alarms: cam.alarms, dashcams: ctx.dashcams && !cam.failed },
                 unitList: units, ctx, missing, failed: h.failed, units: units.length });
        return;
      } else if (key === 'overspeed') {
        const ids = units.flatMap((u) => u.vehicles.map((v) => v.vehicleId));
        const r = await loadOverspeeds({ orgId, from: ctx.from, to: ctx.to, vehicleIds: ids, onProgress: step('Reading overspeeds, vehicle') });
        rows = overspeedRows(units, r.byVehicle); failed = r.failed;
      } else {
        const windows = key === 'night' ? nightWindows(ctx.from, ctx.to, ctx.night) : [[ctx.from, ctx.to]];
        ctx.windows = windows;
        const r = await loadDistances({ orgId, vehicles: units.flatMap((u) => u.vehicles), windows, onProgress: step('Reading each vehicle’s day') });
        rows = key === 'night' ? nightRows(units, r.perVehicle) : utilisationRows(units, r.perVehicle, { rated: ctx.rated });
        failed = r.failed;
      }
      if (!live()) return;
      const secs = sections(rows, ctx.rated ? RATED_SECTIONS : groups?.map((g) => g.name), def.sum);
      setRun({ status: 'done', rows, secs, ctx, missing, failed, units: units.length });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  // A behaviour run (and any new operator entry) opens the cases it finds;
  // what operators recorded on cases already there stays.
  useEffect(() => {
    if (run.status !== 'done' || !run.raw || !orgId) return;
    const found = casesFromRun(run.unitList, run.raw.events, run.raw.alarms, { ...run.ctx, dashcams: run.raw.dashcams, logged: entries });
    const merged = mergeCases(loadCases(orgId), found);
    setCases(merged);
    setCasesFailed(!saveCases(orgId, merged));
  }, [run, entries, orgId]);

  const done = useMemo(() => {
    if (run.status !== 'done') return null;
    if (!run.raw) return run;
    const rows = behaviourRows(run.unitList, run.raw.events, run.raw.alarms, { ...run.ctx, dashcams: run.raw.dashcams, logged: entries });
    const inScope = new Set(run.unitList.map((u) => u.key));
    const period = periodCases(cases, run.ctx).filter((c) => inScope.has(c.unitKey));
    const followUp = new Map();
    for (const c of period) followUp.set(c.unitKey, [...(followUp.get(c.unitKey) ?? []), c]);
    const ctx = { ...run.ctx, followUp, cases: period, allCases: cases, now };
    return { ...run, ctx, rows, logged: rows.logged, secs: sections(rows, groups?.map((g) => g.name), REPORTS.behaviour.sum) };
  }, [run, entries, groups, cases, now]);

  // The case the report's Follow-up cell opens: the oldest pending, else the latest.
  const openCaseFor = (unitKey) => {
    const list = done?.ctx.followUp?.get(unitKey) ?? [];
    const c = list.find((x) => x.status === 'pending') ?? list[list.length - 1];
    if (c) setActing(c.id);
  };
  const actingCase = acting ? cases.find((c) => c.id === acting) : null;
  const ctx = done?.ctx ?? { from: span.from, to: span.to };
  const kpis = def.kpis(done?.rows ?? []);
  const columns = def.columns(ctx);
  // Type or Driver blank for every vehicle (e.g. all "UNSPECIFIED"): left out.
  const shown = done ? shownColumns(def, done.rows, done.ctx) : columns.map((_, i) => i);
  const groupWords = done?.ctx.group ?? (groups ? 'All groups' : 'All vehicles');
  const periodWords = periodText(ctx.from, ctx.to);
  const nightWords = key === 'night' ? `Night hours ${hourLabel((done?.ctx.night ?? night).start)}:00hrs – ${hourLabel((done?.ctx.night ?? night).end)}:00hrs` : null;
  const slug = `${def.key}-${String(orgCode ?? 'fleet').toLowerCase()}${done?.ctx.group ? `-${done.ctx.group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}`;

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const downloadPdf = async () => {
    if (!done || pdfBusy) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { html, landscape, filename } = reportHtml(def, done, {
        companyName: activeCompany?.name ?? orgCode ?? 'Fleet',
        orgCode, groupWords, periodWords, nightWords, logos: letterheadLogos(),
      });
      await saveLetterheadPdf(html, { filename, landscape });
    } catch (err) {
      setPdfError(`The PDF could not be made: ${err?.message ?? err}`);
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadCsv = () => {
    if (!done) return;
    downloadTableCsv({ ...csvTable(def, done.secs, done.ctx), filenameSlug: slug });
  };

  return (
    <div className="sp4-root rpt-root">
      <div className="sp4-tabs rpt-tabs" role="tablist" aria-label="Report">
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={key === k}
                  className={`sp4-tab${key === k ? ' sp4-tab--on' : ''}`} onClick={() => chooseReport(k)}>
            <ReportIcon name={k} />
            {(SERVER_TABS[k] ?? REPORTS[k]).label}
          </button>
        ))}
      </div>

      {key === SHIFT ? <ShiftReport orgId={orgId} /> : key === MOVEMENTS ? <MovementsReport key={orgId ?? 'none'} orgId={orgId} /> : (<>

      <div className="sp4-header rpt-header">
        <p className="rpt-blurb">{def.blurb}</p>
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone} value={done ? k.value : <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Period">
          {presetsFor(key).map((id) => (
            <button key={id} type="button" aria-pressed={span.id === id}
                    className={`sp4-filter-chip${span.id === id ? ' sp4-filter-chip--on' : ''}`}
                    onClick={() => choosePreset(id)}>{PRESETS[id]}</button>
          ))}
        </div>
        <div className="frp-range">
          <WhenField label="From" value={span.from} max={span.to} onChange={setFrom} />
          <span className="frp-range__dash" aria-hidden="true">–</span>
          <WhenField label="To" value={span.to} min={span.from} onChange={setTo} />
        </div>

        {key === 'utilisation' && !rated && (
          <label className="rpt-field">
            <span className="rpt-field__l">Consumption</span>
            <select className="rpt-select" value={rate}
                    onChange={(e) => { setRate(e.target.value); reset(); }}>
              {Object.entries(RATES).map(([k, r]) => <option key={k} value={k}>{r.label} ({r.unit})</option>)}
            </select>
          </label>
        )}

        {key === 'night' && (
          <div className="rpt-field" role="group" aria-label="Night hours">
            <span className="rpt-field__l">Night</span>
            <select className="rpt-select" value={night.start} aria-label="Night starts"
                    onChange={(e) => { setNight((n) => ({ ...n, start: Number(e.target.value) })); reset(); }}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}:00</option>)}
            </select>
            <span className="frp-range__dash" aria-hidden="true">–</span>
            <select className="rpt-select" value={night.end} aria-label="Night ends"
                    onChange={(e) => { setNight((n) => ({ ...n, end: Number(e.target.value) })); reset(); }}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}:00</option>)}
            </select>
          </div>
        )}

        {groups && (
          <label className="rpt-field">
            <span className="rpt-field__l">Group</span>
            <select className="rpt-select" value={group ?? ''}
                    onChange={(e) => { setGroup(e.target.value || null); reset(); }}>
              <option value="">All groups</option>
              {groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
            </select>
          </label>
        )}

        {key === 'behaviour' && (
          <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setDialog({})}>Log incident</button>
        )}
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={execute}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      <div className="sp4-body rpt-body">
        {run.status === 'idle' && (
          <EmptyNote icon={<ReportIcon name={def.key} />} title={def.title}>
            Choose the period{groups ? ' and group' : ''}, then press Run report.
          </EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report"
                     progress={run.total ? run.done / run.total : null}>
            {run.total ? `${run.words} ${Math.min(run.done + 1, run.total)} of ${run.total}.` : `${run.words}…`}
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made"
                     action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        )}

        {done && (
          <>
            <TableToolbar
              summary={<>
                <strong>{done.rows.length.toLocaleString('en-GB')}</strong> vehicle{done.rows.length === 1 ? '' : 's'}
                {key === 'utilisation' || key === 'night' ? ` of ${done.units.toLocaleString('en-GB')}` : ''}
                <span className="rpt-sub"> · {periodWords} · {groupWords}{nightWords ? ` · ${nightWords}` : ''}</span>
                {done.failed > 0 && <span className="rpt-warn"> · {done.failed} could not be read</span>}
                {key === 'behaviour' && done.ctx.dashcamFailed && <span className="rpt-warn"> · the dashcam alarms could not be read; seatbelt and phone are not counted</span>}
                {key === 'behaviour' && !done.ctx.dashcams && !done.ctx.dashcamFailed && <span className="rpt-sub"> · no dashcams in this fleet</span>}
              </>}
              onCsv={done.rows.length ? downloadCsv : undefined}
              onPdf={pdfBusy ? undefined : downloadPdf}
              actions={pdfBusy ? <span className="rpt-sub">Making the PDF…</span>
                : pdfError ? <span className="rpt-warn">{pdfError}</span> : null}
            />
            {!done.rows.length ? (
              <EmptyNote icon="ti-circle-check" title="Nothing to Report">{def.empty}</EmptyNote>
            ) : (
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className={`sp4-table rpt-table${def.wide ? ' rpt-table--grid' : ''}`}>
                  <thead>
                    <tr>
                      {shown.map((i) => (
                        <th key={columns[i]} className={isFigure(def, columns, i) ? 'rpt-num' : undefined} scope="col">{columns[i]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {done.secs.map((s) => (
                      <Fragment key={s.name ?? 'all'}>
                        {s.name && (
                          <tr className="rpt-group">
                            <th colSpan={shown.length} scope="rowgroup">
                              <span className="rpt-group__name">{s.name}</span>
                              <span className="rpt-group__meta">{s.rows.length} vehicle{s.rows.length === 1 ? '' : 's'} · {def.sumWords(s.total)}</span>
                            </th>
                          </tr>
                        )}
                        {s.rows.map((r) => {
                          const cells = def.cells(r, done.ctx);
                          return (
                            <tr key={r.unit.key} className={`sp4-tr${r.noData ? ' rpt-row--nodata' : ''}`}>
                              {shown.map((i) => {
                                const c = cells[i];
                                if (i === 0) {
                                  return (
                                    <td key={i} className="rpt-unit">
                                      {r.unit.plate}
                                      {key === 'utilisation' && overStandard(r) && <span className="rpt-tag rpt-tag--warn" title="More than 15% over the standard on the register">Over standard</span>}
                                      {r.suspect && <span className="rpt-tag rpt-tag--warn" title="More than 100 harsh events a day, far more than a driver makes: most likely a faulty sensor">Check sensor</span>}
                                    </td>
                                  );
                                }
                                if (key === 'behaviour' && columns[i] === 'Follow-up') {
                                  return (
                                    <td key={i}>
                                      {c === 'No case' ? <span className="rpt-fu-none">No case</span> : (
                                        <button type="button" className={`rpt-fu rpt-fu--${c === 'Overdue' ? 'overdue' : c === 'Pending' ? 'pending' : 'done'}`}
                                                onClick={() => openCaseFor(r.unit.key)}
                                                title={c === 'Action taken' ? 'See or change the action taken' : 'Record the action taken'}>{c}</button>
                                      )}
                                    </td>
                                  );
                                }
                                return <td key={i} className={isFigure(def, columns, i) ? 'rpt-num' : undefined}>{c}</td>;
                              })}
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {done.missing.length > 0 && (
                  <details className="rpt-missing">
                    <summary>{done.missing.length} unit{done.missing.length === 1 ? '' : 's'} on the list {done.missing.length === 1 ? 'is' : 'are'} not tracked on the platform</summary>
                    <p>{done.missing.map((m) => `${m.plate} (${m.group})`).join(', ')}</p>
                  </details>
                )}
              </div>
            )}
          </>
        )}

        {key === 'behaviour' && (
          <FollowUpPanel cases={cases} orgCode={orgCode} now={now} saveFailed={casesFailed}
                         onOpen={(c) => setActing(c.id)} onReplace={keepCases} />
        )}
        {key === 'behaviour' && (
          <LoggedIncidents entries={entries} orgCode={orgCode} saveFailed={saveFailed}
                           onLog={() => setDialog({})} onEdit={(entry) => setDialog({ entry })}
                           onDelete={(id) => keep(remove(entries, id))} onReplace={keep} />
        )}
      </div>

      </>)}

      {actingCase && (
        <ActionDialog key={actingCase.id} kase={actingCase} by={by} onClose={() => setActing(null)}
                      onSave={(a) => { keepCases(recordAction(cases, actingCase.id, { ...a, at: Date.now() })); setActing(null); }} />
      )}
      {dialog && (
        <IncidentDialog vehicles={vehicles} entry={dialog.entry} by={by}
                        onClose={() => setDialog(null)}
                        onSave={(e) => { keep(upsert(entries, e)); setDialog(null); }} />
      )}
    </div>
  );
}
