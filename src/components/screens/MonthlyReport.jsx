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
import { loadUsage, loadOverspeeds, loadConductPeriod, loadFuelDrains } from '../../api/fleetReports';
import { loadFuelConsumptionRate, loadAlarmDistribution, loadUnauthorizedPassengers } from '../../api/reports';
import { getProbeHealth } from '../../api/probeHealth';
import * as conductApi from '../../api/driverConduct';
import { letterheadLogos } from '../../api/letterheadPdf';
import { fleetListEntries } from '../../hooks/useFleetList';
import { fleetEntriesFor } from '../../lib/fleetListFile';
import { withTypeTargets } from '../../lib/fuelTargets';
import { behaviourRows, fleetDay } from '../../lib/fleetReports';
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
    const steps = [
      { key: 'usage', words: 'Reading each unit’s days' },
      { key: 'overspeed', words: 'Reading overspeeds, unit' },
      { key: 'conduct', words: 'Reading harsh driving and dashcam alarms, day' },
      blocks.passengers && { key: 'passengers', words: 'Reading unauthorised passengers' },
      blocks.fuelRate && { key: 'fuelRate', words: 'Reading fuel consumption' },
      blocks.thefts && { key: 'thefts', words: 'Reading fuel drains' },
      blocks.probes && { key: 'probes', words: 'Reading fuel probes' },
      blocks.alarms && { key: 'alarms', words: 'Reading dashcam alarms' },
    ].filter(Boolean);
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
  const share = busy && run.total ? Math.min(1, run.done / run.total) : null;

  return (
    <div className="mr-root">
      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <ChoicePicker icon="ti-calendar-month" label="Month" value={month}
                      options={options} onChange={(v) => setMonth(v ?? lastCompleteMonth(now))} />
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={busy ? stop : execute}
                disabled={!orgId || !vehicles.length}>
          {busy ? 'Stop' : 'Run report'}
        </button>
        <button type="button" className="sp4-ghost-btn rpt-run" disabled title="The PDF comes with stage 4">
          Download PDF
        </button>
      </div>

      {run.status === 'idle' && (
        <EmptyNote icon="ti-calendar-month" title="Monthly Fleet Report">
          Pick a month and run the report. Reading a month of every unit takes several minutes.
        </EmptyNote>
      )}
      {busy && (
        <div className="mr-progress" role="status">
          <div className="mr-progress__words">
            Step {run.step} of {run.steps}: {run.words}{run.total ? ` ${run.done.toLocaleString('en-GB')} of ${run.total.toLocaleString('en-GB')}` : run.done ? ` · ${run.done.toLocaleString('en-GB')}` : '…'}
          </div>
          <div className="mr-progress__bar"><span style={{ width: `${Math.round(((run.step - 1 + (share ?? 0)) / run.steps) * 100)}%` }} /></div>
        </div>
      )}
      {run.status === 'error' && (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: execute }}>
          {run.message}
        </EmptyNote>
      )}
      {run.status === 'done' && (
        <>
          {run.missed.length > 0 && (
            <div className="mr-missed" role="status">
              <b>Not all of the month could be read:</b>
              <ul>{run.missed.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          <iframe className="mr-frame" title="Monthly Fleet Report preview" srcDoc={doc.html} />
        </>
      )}
    </div>
  );
}
