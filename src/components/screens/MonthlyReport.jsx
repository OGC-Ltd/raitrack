/*
 * Monthly Fleet Report (Reports › Monthly report): an organisation's month in
 * one document, every report it has summed by the map's fleet groups.
 *
 * Each report is read with its own loader, one after another (never all at
 * once: a month of every unit is heavy), with the progress shown. The figures
 * are lib/monthlyReport's; the pages lib/monthlyReportDoc's, shown here in a
 * frame and drawn to the PDF from the same HTML.
 *
 * Never run on opening: only on Run report.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import ChoicePicker from './ChoicePicker';
import EmptyNote from '../shared/EmptyNote';
import TableToolbar from '../body/TableToolbar';
import ReportIcon from '../shared/ReportIcon';
import { loadUsage, loadOverspeeds, loadConductPeriod, loadFuelDrains } from '../../api/fleetReports';
import { loadFuelConsumptionRate, loadAlarmDistribution, loadUnauthorizedPassengers } from '../../api/reports';
import { getProbeHealth } from '../../api/probeHealth';
import * as conductApi from '../../api/driverConduct';
import { letterheadLogos } from '../../api/letterheadPdf';
import { fleetListEntries } from '../../hooks/useFleetList';
import { fleetEntriesFor } from '../../lib/fleetListFile';
import { withTypeTargets } from '../../lib/fuelTargets';
import { behaviourRows, fleetDay, daysCovering } from '../../lib/fleetReports';
import { buildMonthlyReport, monthPeriod, monthUnits, monthlyBlocks, lastCompleteMonth, previousMonth } from '../../lib/monthlyReport';
import { monthlyReportHtml } from '../../lib/monthlyReportDoc';
import './MonthlyReport.css';

const DAY = 86_400_000;
/** The months offered: this one (to date) and the eleven before it. */
const MONTHS_BACK = 12;
/** Dashcam alarms are kept this many days (fleet-server ALARM_MAX_DAYS). */
const ALARM_DAYS = 7;

/** Reports made in this tab, by organisation and month: the previous month's, for the variance. */
const made = new Map();

/** The run's steps for this organisation, in order; each says what it reads. */
function stepsFor(blocks) {
  return [
    { key: 'usage', words: 'Reading each unit’s days' },
    { key: 'overspeed', words: 'Reading overspeeds, unit' },
    { key: 'conduct', words: 'Reading harsh driving and dashcam alarms, day' },
    blocks.passengers && { key: 'passengers', words: 'Reading unauthorised passengers' },
    blocks.fuelRate && { key: 'fuelRate', words: 'Reading fuel consumption' },
    blocks.thefts && { key: 'thefts', words: 'Reading fuel drains' },
    blocks.probes && { key: 'probes', words: 'Reading fuel probes' },
    blocks.alarms && { key: 'alarms', words: 'Reading dashcam alarms' },
  ].filter(Boolean);
}

/** "Reading overspeeds, unit" → "Overspeeds": a step as the run sheet names it. */
const stepName = (words) => {
  const w = words.replace(/^Reading /, '').replace(/, (unit|day)$/, '');
  return w.charAt(0).toUpperCase() + w.slice(1);
};
const n0 = (n) => n.toLocaleString('en-GB');
const STATE_WORDS = { waiting: 'Waiting', reading: 'Reading', read: 'Read' };

function monthOptions(now) {
  const out = [];
  let key = fleetDay(now).slice(0, 7);
  for (let i = 0; i < MONTHS_BACK; i++) {
    const p = monthPeriod(key, now);
    out.push({ value: key, label: p.complete ? p.label : `${p.label} (to date)` });
    key = previousMonth(key);
  }
  return out;
}

export default function MonthlyReport({ orgId, orgCode, companyName, vehicles, can }) {
  const qc = useQueryClient();
  const [now] = useState(() => Date.now());
  const options = useMemo(() => monthOptions(now), [now]);
  const [month, setMonth] = useState(() => lastCompleteMonth(now));
  const [run, setRun] = useState({ status: 'idle' });
  const ctl = useRef(null);
  const stop = () => { ctl.current?.abort(); ctl.current = null; };
  useEffect(() => stop, []);
  useEffect(() => { stop(); setRun({ status: 'idle' }); }, [orgId]);
  /** Stop: the reads are dropped and the steps go back to waiting. */
  const halt = () => { stop(); setRun({ status: 'idle' }); };

  // Edit (operator, 28 Nov 2026: "the report should be editable"): the report's own pages turn
  // editable in place, so its charts stay; any text is changed by clicking into it. A new run
  // replaces it, so with edits it asks first. The PDF (stage 4) should draw from the frame's
  // document as edited (frameRef.current.contentDocument), not from doc.html.
  const frameRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [confirm, setConfirm] = useState(null);           // { words, go }
  useEffect(() => { setEditing(false); setEdited(false); }, [run]);
  const frameDoc = () => frameRef.current?.contentDocument ?? null;
  const armFrame = () => {
    const d = frameDoc();
    if (!d) return;
    d.designMode = editing ? 'on' : 'off';
    d.addEventListener('input', () => setEdited(true));
  };
  useEffect(() => { const d = frameDoc(); if (d) d.designMode = editing ? 'on' : 'off'; }, [editing]);
  useEffect(() => {
    if (!edited) return undefined;
    const warn = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edited]);
  const undoEdits = () => { setEdited(false); setEditing(false); setFrameKey((k) => k + 1); };
  const guard = (words, go) => (edited ? setConfirm({ words, go }) : go());

  const blocks = useMemo(() => monthlyBlocks(orgCode, can), [orgCode, can]);

  const execute = async () => {
    if (!orgId || !vehicles.length) return;
    stop();
    const ac = new AbortController();
    ctl.current = ac;
    const { signal } = ac;
    const live = () => ctl.current === ac;
    const period = monthPeriod(month, Date.now());
    const { from, to } = period;
    const firstDay = fleetDay(from);
    const lastDay = fleetDay(to - 1);
    const { units } = monthUnits(vehicles);
    const trackers = units.flatMap((u) => u.vehicles);
    const missed = [];

    // The steps, one after another; each says what it reads
    const steps = stepsFor(blocks);
    const show = (i, done = 0, total = 0) => {
      if (live()) setRun({ status: 'loading', step: i + 1, steps: steps.length, words: steps[i].words, done, total });
    };
    const at = (key) => steps.findIndex((s) => s.key === key);
    const progress = (key) => ({ done, total }) => show(at(key), done, total);
    /** A step that fails is said on the page, and the report is made without it. */
    const attempt = async (key, fn, fallback) => {
      if (at(key) < 0) return fallback;
      show(at(key));
      try {
        return await fn();
      } catch (err) {
        if (signal.aborted) throw err;
        missed.push(`${steps[at(key)].words.replace(/^Reading /, '').replace(/, (unit|day)$/, '')}: ${err?.message ?? err}`);
        return fallback;
      }
    };

    try {
      const usage = await attempt('usage', async () => {
        const r = await loadUsage({ orgId, vehicles: trackers, from, to, signal, onProgress: progress('usage') });
        if (r.failed) missed.push(`${r.failed} tracker${r.failed === 1 ? '' : 's'} could not be read for every day`);
        return r.usage;
      }, new Map());
      const overspeeds = await attempt('overspeed', async () => {
        const r = await loadOverspeeds({ orgId, from, to, vehicleIds: trackers.map((v) => v.vehicleId), onProgress: progress('overspeed') });
        if (r.failed) missed.push(`${r.failed} unit${r.failed === 1 ? '' : 's'}’ overspeeds could not be read`);
        return r.byVehicle;
      }, new Map());
      const conduct = await attempt('conduct', async () => {
        const [{ harsh, cam }, logged] = await Promise.all([
          loadConductPeriod({ orgId, from, to, signal, onHarsh: progress('conduct'), onDashcam: progress('conduct') }),
          conductApi.listIncidents(orgId).catch(() => []),
        ]);
        // Harsh cornering is not counted over more than a day (Driver conduct's own rule, #155)
        return behaviourRows(units, harsh.events, cam.alarms, { from, to, dashcams: cam.cameras > 0 && !cam.failed, logged, runs: null });
      }, []);
      const passengers = await attempt('passengers', async () => (await loadUnauthorizedPassengers({ orgId, from: firstDay, to: lastDay }))?.incidents ?? [], []);
      const fuelRate = await attempt('fuelRate', async () => {
        const [data, list] = await Promise.all([
          loadFuelConsumptionRate({ orgId, from: firstDay, to: lastDay }),
          fleetListEntries(qc, orgId).catch(() => null),
        ]);
        return withTypeTargets(data?.rows ?? [], fleetEntriesFor(orgCode, list));
      }, []);
      const thefts = await attempt('thefts', () => loadFuelDrains({ orgId, from, to, signal, onProgress: progress('thefts') }), []);
      const probes = await attempt('probes', async () => (await getProbeHealth({ orgId }))?.rows ?? [], []);
      // The dashcams keep a week: the month's last week, where it is still within it
      const alarmFrom = Math.max(from, to - ALARM_DAYS * DAY);
      const alarmsReach = Date.now() - alarmFrom < (ALARM_DAYS + 1) * DAY;
      const alarms = await attempt('alarms', async () => (alarmsReach
        ? (await loadAlarmDistribution({ orgId, from: fleetDay(alarmFrom), to: lastDay }))?.rows ?? []
        : null), null);
      if (!live()) return;

      const previous = made.get(`${orgId}|${previousMonth(month)}`) ?? null;
      const report = buildMonthlyReport({
        month, now: Date.now(), vehicles, blocks, usage, overspeeds, conduct, passengers, fuelRate, thefts, alarms, probes, previous,
      });
      report.alarmsFrom = alarms ? alarmFrom : null;
      made.set(`${orgId}|${month}`, report);
      setRun({ status: 'done', report, missed, made: Date.now() });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    } finally {
      if (ctl.current === ac) ctl.current = null;
    }
  };

  const doc = useMemo(() => (run.status === 'done'
    ? monthlyReportHtml(run.report, { companyName: companyName ?? orgCode ?? 'Fleet', orgCode, logos: letterheadLogos(), now: run.made })
    : null), [run, companyName, orgCode]);

  const busy = run.status === 'loading';
  const done = run.status === 'done';
  const share = busy && run.total ? Math.min(1, run.done / run.total) : null;

  // What the month will read, before, during and after a run
  const steps = useMemo(() => stepsFor(blocks), [blocks]);
  const scope = useMemo(() => {
    const p = monthPeriod(month, now);
    const trackers = monthUnits(vehicles).units.reduce((n, u) => n + u.vehicles.length, 0);
    const days = daysCovering(p.from, p.to).length;
    return { label: p.complete ? p.label : `${p.label} to date`, trackers, days, unitDays: trackers * days };
  }, [month, now, vehicles]);
  const stateOf = (i) => {
    if (done) return 'read';
    if (!busy) return 'waiting';
    return i < run.step - 1 ? 'read' : i === run.step - 1 ? 'reading' : 'waiting';
  };
  const readCount = done ? steps.length : busy ? run.step - 1 : 0;
  const missedCount = done ? run.missed.length : null;

  // The figures strip, as Movements has it: what the month covers, and how far the run has got
  const kpis = [
    { label: 'Trackers', value: n0(scope.trackers) },
    { label: 'Days', value: n0(scope.days) },
    { label: 'Unit-days', value: n0(scope.unitDays) },
    { label: 'Steps read', value: `${readCount} of ${steps.length}`, tone: done ? 'live' : undefined },
    { label: 'Not read', value: missedCount == null ? '-' : n0(missedCount), tone: missedCount ? 'speed' : undefined },
  ];

  // The two months most runs want, one click each, as Movements has its windows; the picker holds the year
  const lastKey = lastCompleteMonth(now);
  const quick = [options.find((o) => o.value === lastKey), options[0].value !== lastKey ? options[0] : null].filter(Boolean);
  const pick = (v) => { if (!busy) setMonth(v); };

  const current = busy ? steps[run.step - 1] : null;
  const summary = done ? (
    <><strong>Monthly fleet report</strong><span className="rpt-sub"> for {scope.label}, made at {new Date(run.made).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></>
  ) : busy ? (
    <><strong>Step {run.step} of {steps.length}</strong><span className="rpt-sub">: reading {stepName(current.words).toLowerCase()}{run.total ? `, ${n0(run.done)} of ${n0(run.total)}` : ''}</span></>
  ) : (
    <><strong>{steps.length} steps</strong><span className="rpt-sub"> for {scope.label}, read one after another. Nothing is read until you run it; a month of every unit takes several minutes.</span></>
  );

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <div key={k.label} className={`sp4-kpi${k.tone ? ` sp4-kpi--${k.tone}` : ''}`}>
              <span className="sp4-kpi-n">{k.value}</span>
              <span className="sp4-kpi-l">{k.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Month">
          {quick.map((o) => (
            <button key={o.value} type="button" aria-pressed={month === o.value} disabled={busy}
                    className={`sp4-filter-chip${month === o.value ? ' sp4-filter-chip--on' : ''}`}
                    onClick={() => pick(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <ChoicePicker icon="ti-calendar-month" label="Month" value={month}
                      options={options} onChange={(v) => pick(v ?? lastKey)} />
        <button type="button" className="sp4-submit-btn frp-run rpt-run"
                onClick={busy ? halt : () => guard('Run the report again', execute)}
                disabled={!orgId || !vehicles.length}>
          {busy ? 'Stop' : done ? 'Run again' : 'Run report'}
        </button>
      </div>

      <div className="sp4-body rpt-body mr-body">
        {run.status === 'error' ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
            {run.message}
          </EmptyNote>
        ) : (
          <>
            <TableToolbar
              summary={summary}
              actions={done ? (
                <>
                  {editing && <span className="rpt-sub" role="status">Click any text on the report to change it.</span>}
                  {edited && <button type="button" className="sp4-ghost-btn" onClick={undoEdits}>Undo edits</button>}
                  <button type="button" className="sp4-ghost-btn" aria-pressed={editing}
                          onClick={() => setEditing((e) => !e)} title="Change any text on the report">
                    <i className={`ti ${editing ? 'ti-check' : 'ti-pencil'}`} aria-hidden="true" /> {editing ? 'Done' : edited ? 'Edited' : 'Edit'}
                  </button>
                  <button type="button" className="sp4-ghost-btn" disabled title="The PDF comes with stage 4">
                    <i className="ti ti-file-type-pdf" aria-hidden="true" /> PDF
                  </button>
                </>
              ) : null}
            />
            {confirm && (
              <div className="mvr-confirm" role="alertdialog" aria-labelledby="mr-confirm-words">
                <span id="mr-confirm-words">{confirm.words} and lose your edits?</span>
                <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setConfirm(null)} autoFocus>Keep editing</button>
                <button type="button" className="sp4-submit-btn frp-run mvr-confirm__go"
                        onClick={() => { const { go } = confirm; setConfirm(null); go(); }}>Discard edits</button>
              </div>
            )}
            <div className="mr-scroll">
              {done && run.missed.length > 0 && (
                <div className="mr-missed" role="status">
                  <p className="mr-missed__title">Not all of the month could be read</p>
                  <ul>{run.missed.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
              )}
              {done ? (
                <div className={`mr-frame-wrap${editing ? ' mr-frame-wrap--editing' : ''}`} tabIndex={0} role="region" aria-label="Report pages, scroll sideways">
                  <iframe key={frameKey} ref={frameRef} onLoad={armFrame} className="mr-frame"
                          title={editing ? 'Monthly Fleet Report, editable' : 'Monthly Fleet Report preview'} srcDoc={doc.html} />
                </div>
              ) : (
                <table className="sp4-table rpt-table mr-steps">
                  <thead>
                    <tr>
                      <th scope="col" className="mr-steps__n"><span className="mr-sr">Step</span></th>
                      <th scope="col">What it reads</th>
                      <th scope="col" className="rpt-num">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="rpt-group">
                      <th colSpan={3} scope="rowgroup">
                        <span className="rpt-group__name"><ReportIcon name="monthly" className="mr-mark" /> {scope.label}</span>
                        <span className="rpt-group__meta">{n0(scope.trackers)} trackers over {scope.days} days</span>
                      </th>
                    </tr>
                    {steps.map((st, i) => {
                      const state = stateOf(i);
                      const reading = state === 'reading';
                      return (
                        <tr key={st.key} className="sp4-tr mr-step" data-state={state} aria-current={reading ? 'step' : undefined}>
                          <td className="mr-steps__n">
                            <span className="mr-step__n" aria-hidden="true">{state === 'read' ? <i className="ti ti-check" /> : i + 1}</span>
                          </td>
                          <td>
                            <span className="mr-step__name">{stepName(st.words)}</span>
                            {reading && run.total > 0 && (
                              <span className="mr-step__bar" aria-hidden="true">
                                <span style={{ transform: `scaleX(${share ?? 0})` }} />
                              </span>
                            )}
                          </td>
                          <td className="rpt-num mr-step__state" role={reading ? 'status' : undefined}>
                            {reading && run.total ? `${n0(run.done)} of ${n0(run.total)}` : reading && run.done ? n0(run.done) : STATE_WORDS[state]}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
