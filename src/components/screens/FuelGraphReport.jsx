/*
 * Fuel Graph Report (operator, 13 Nov 2026): the units' fuel graphs for the days picked, one page each,
 * with the day's figures in the bottom quarter (lib/fuelGraphPdf). The units are those of the Fuel
 * Consumption Rate report for the same days (GET …/reports/fuel-consumption-rate), ticked by hand or
 * all at once by their rate: below target, or below a km/L typed in.
 */

import { useMemo, useRef, useState } from 'react';
import './FuelConsumptionRateReport.css';
import { withTypeTargets, fuelGroupsFor, rowsInGroup, groupCounts } from '../../lib/fuelTargets';
import ChoicePicker from './ChoicePicker';
import { loadFleetList } from '../../lib/fleetListFile';
import { loadFuelConsumptionRate } from '../../api/reports';
import { loadPings } from '../../api/fleetReports';
import { fuelGraphsPdf, dayStart, dayEnd } from '../../lib/fuelGraphPdf';
import { loadVehicleFuelEvents } from '../../hooks/useVehicleFuelEvents';
import { fuelEpisodes, levelsFromPings } from '../../lib/fuelEpisodes';
import { reportNumber } from '../../lib/reportLetterhead';
import DateRangePicker from '../layout/DateRangePicker';
import EmptyNote from '../shared/EmptyNote';
import raiLogo from '../../assets/rai-group-logo.jpeg';
import ogcLogo from '../../assets/ogc-monitoring-logo.png';

const MAX_DAYS = 7;
/** The fleet days from one to the other, YYYY-MM-DD. */
const daysOf = (from, to) => { const out = []; for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const fleetDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
const rate = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));
const litres = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));

/** An image the site serves, as a data URL for the PDF; null when it cannot be read. */
async function dataUrl(src) {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

export default function FuelGraphReport({ orgId, orgCode, companyName }) {
  const today = fleetDay(Date.now());
  const [days, setDays] = useState({ from: today, to: today });
  const [run, setRun] = useState({ status: 'idle' });
  // One category or all, as on Fuel Consumption Rate (operator, 13 Nov 2026)
  const [group, setGroup] = useState(null);
  const groups = fuelGroupsFor(orgCode);
  const [ticked, setTicked] = useState(() => new Set());
  const [below, setBelow] = useState('');
  const [make, setMake] = useState({ busy: false, words: '', error: null });
  const runId = useRef(0);
  const fleet = companyName ?? orgCode ?? '';

  const execute = async () => {
    if (!orgId) return;
    const id = ++runId.current;
    setRun({ status: 'loading' });
    setTicked(new Set());
    try {
      const data = await loadFuelConsumptionRate({ orgId, from: days.from, to: days.to });
      if (id !== runId.current) return;
      // A target from the fleet Excel's TYPE where none is set by registration (operator, 13 Nov 2026)
      const rows = withTypeTargets(data.rows ?? [], loadFleetList(orgCode)?.entries ?? null)
        .sort((a, b) => (a.kmPerL ?? Infinity) - (b.kmPerL ?? Infinity));
      setRun({ status: 'done', rows, from: days.from, to: days.to });
    } catch (err) {
      if (id === runId.current) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const done = run.status === 'done' ? run : null;
  const allRows = useMemo(() => done?.rows ?? [], [done]);
  const rows = useMemo(() => (group ? rowsInGroup(allRows, orgCode, group) : allRows), [allRows, orgCode, group]);
  const counts = useMemo(() => groupCounts(allRows, orgCode), [allRows, orgCode]);
  const flip = (id) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tickWhere = (keep) => setTicked(new Set(rows.filter(keep).map((r) => r.vehicleId)));
  const limit = Number(below);
  const picked = rows.filter((r) => ticked.has(r.vehicleId));

  const makePdf = async () => {
    if (!done || !picked.length || make.busy) return;
    setMake({ busy: true, words: 'Reading the logos', error: null });
    try {
      const [rai, ogc] = await Promise.all([dataUrl(raiLogo), dataUrl(ogcLogo)]);
      const from = dayStart(done.from);
      const to = Math.min(dayEnd(done.to), Date.now());
      const units = [];
      for (const [i, row] of picked.entries()) {
        setMake({ busy: true, words: `Reading the fuel of ${row.plate} (${i + 1} of ${picked.length})`, error: null });
        const { pings } = await loadPings({ orgId, vehicles: [{ vehicleId: row.vehicleId }], from, to });
        const own = pings.get(row.vehicleId) ?? [];
        // The fuel ledger's refills, drains and possible thefts, day by day, as the unit card shows them;
        // without them the page marks the refills it reads off the line
        let events = null;
        try {
          const held = await Promise.all(daysOf(done.from, done.to).map((d) => loadVehicleFuelEvents(orgId, row.vehicleId, d)));
          events = fuelEpisodes({ drains: held.flatMap((h) => h.drains), fillings: held.flatMap((h) => h.fillings), levels: levelsFromPings(own) });
        } catch { events = null; }
        units.push({ row, pings: own, events });
      }
      setMake({ busy: true, words: 'Drawing the pages', error: null });
      const doc = await fuelGraphsPdf(units, { from: done.from, to: done.to, fleet, logos: { rai, ogc }, reportNo: reportNumber('FG', orgCode, Date.now()) });
      doc.save(`Fuel Graph Report ${fleet} ${done.from}${done.from !== done.to ? ` to ${done.to}` : ''}.pdf`);
      setMake({ busy: false, words: `${units.length} page${units.length === 1 ? '' : 's'} saved`, error: null });
    } catch (err) {
      setMake({ busy: false, words: '', error: `The fuel graphs could not be made: ${err?.message ?? err}` });
    }
  };

  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a date range' : null;

  return (
    <div className="frp-page">
      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker from={days.from} to={days.to} today={today} maxDays={MAX_DAYS} spans={[7]} label="Date range"
          onChange={(from, to) => setDays({ from, to: to ?? from })} />
        {groups && (
          <ChoicePicker icon="ti-users-group" label="Category" value={group}
                        options={[{ value: null, label: 'All', ...(done ? { note: allRows.length } : {}) },
                          ...groups.map((g) => ({ value: g.name, label: g.name, ...(done ? { note: counts[g.name] ?? 0 } : {}) }))]}
                        onChange={(v) => { setGroup(v); setTicked(new Set()); }} />
        )}
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={execute}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'List the units with their consumption for these days'}>
          {run.status === 'loading' ? 'Loading…' : 'Run report'}
        </button>
      </div>

      {run.status === 'idle' && (
        <EmptyNote icon="ti-chart-line" title="Fuel Graph Report">
          Pick the days and run the report, tick the units (or tick them by their rate), then make the PDF: a page per unit, its fuel graph with the day&apos;s figures under it.
        </EmptyNote>
      )}
      {run.status === 'loading' && <EmptyNote icon="ti-loader-2" tone="busy" title="Working out the fuel">Balancing each unit&apos;s fuel over the days.</EmptyNote>}
      {run.status === 'error' && <EmptyNote icon="ti-alert-circle" tone="warn" title="Could not load fuel data">{run.message}</EmptyNote>}
      {done && !rows.length && <EmptyNote icon="ti-mood-happy" title="No Data">{group ? `No ${group} units to report in this period.` : 'No units to report in this period.'}</EmptyNote>}

      {done && rows.length > 0 && (
        <>
          <div className="sp4-table-sub fgr-bar">
            <span><strong>{ticked.size}</strong> of {rows.length} units ticked</span>
            <button type="button" className="sp4-ghost-btn" onClick={() => tickWhere((r) => r.belowTarget === true)}>Tick below target</button>
            <span className="fgr-below">
              Tick below
              <input type="number" min="0" step="0.1" inputMode="decimal" value={below} onChange={(e) => setBelow(e.target.value)} aria-label="km per litre" placeholder="km/L" />
              <button type="button" className="sp4-ghost-btn" disabled={!(limit > 0)} onClick={() => tickWhere((r) => r.kmPerL != null && r.kmPerL < limit)}>Tick</button>
            </span>
            <button type="button" className="sp4-ghost-btn" onClick={() => tickWhere(() => true)}>Tick all</button>
            <button type="button" className="sp4-ghost-btn" disabled={!ticked.size} onClick={() => setTicked(new Set())}>Clear</button>
            <span className="fgr-make">
              {make.busy || make.words ? <span className="rpt-sub">{make.words}</span> : null}
              {make.error && <span className="rpt-warn">{make.error}</span>}
              <button type="button" className="sp4-submit-btn" disabled={!picked.length || make.busy} onClick={makePdf}
                      title="A page per ticked unit: its fuel graph, and its figures in the bottom quarter">
                <i className="ti ti-file-type-pdf" aria-hidden="true" /> Fuel graphs PDF{picked.length ? ` (${picked.length})` : ''}
              </button>
            </span>
          </div>
          <div className="sp4-table-scroll rpt-scroll">
            <table className="sp4-table rpt-table fcr-table">
              <thead>
                <tr>
                  <th className="fgr-tick" aria-label="Ticked" />
                  <th className="fcr-reg">Registration</th>
                  <th className="fcr-num">Target (km/L)</th>
                  <th className="fcr-num">Rate (km/L)</th>
                  <th className="fcr-num">Distance (km)</th>
                  <th className="fcr-num">Initial (L)</th>
                  <th className="fcr-num">Filled (L)</th>
                  <th className="fcr-num">Final (L)</th>
                  <th className="fcr-num">Consumed (L)</th>
                  <th className="fcr-comment">Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.vehicleId} className={`sp4-tr${ticked.has(r.vehicleId) ? ' fgr-on' : ''}`} onClick={() => flip(r.vehicleId)}>
                    <td className="fgr-tick"><input type="checkbox" checked={ticked.has(r.vehicleId)} onChange={() => flip(r.vehicleId)} onClick={(e) => e.stopPropagation()} aria-label={`Tick ${r.plate}`} /></td>
                    <td className="fcr-reg fcr-plate">{r.plate}</td>
                    <td className="fcr-num">{r.target?.kmPerL ?? r.target?.words ?? '—'}</td>
                    <td className={`fcr-num fcr-rate${r.kmPerL == null ? ' fcr-zero' : r.belowTarget ? ' fcr-below' : ' fcr-ok'}`}>{rate(r.kmPerL)}</td>
                    <td className="fcr-num">{litres(r.distanceKm)}</td>
                    <td className="fcr-num">{litres(r.startL)}</td>
                    <td className="fcr-num">{litres(r.filledL)}</td>
                    <td className="fcr-num">{litres(r.endL)}</td>
                    <td className="fcr-num">{litres(r.consumedL)}</td>
                    <td className="fcr-comment">{r.note || (r.kmPerL != null ? 'PROBE OK' : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
