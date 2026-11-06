/*
 * Deliveries Report (operator, 4 Nov 2026; Menengai's Finished Goods and Van
 * Sales): a tab under Movements. The operator picks a plate and inserts the
 * geofences it should deliver to (kept in this browser, lib/deliveryPlan); a
 * run plays each route back, finds its origin (MORL or the Nairobi depot, two
 * different places), and says when it left, how many of its stops it delivered
 * to (stood 1½ minutes in the geofence, within the window), where it is, and
 * when it came back, all delivered or not. Stops are geofences, or points pasted as coordinates, and
 * the vehicle's whole route in the window is run against them. The bar is
 * Movements': the last hours or days and the same hours on each (with the first
 * day's list), a group, Run report; then JPEG, Preview, CSV and PDF over the group picked.
 * lib/deliveriesReport does the reading; this is the page, and the PDF, JPEG
 * and CSV.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { groupsFor, scopeUnits } from '../../lib/fleetGroups';
import { fleetDay, periodWords } from '../../lib/fleetReports';
import { LAST_HOURS, MAX_MOVEMENT_DAYS, movementWindows, windowsProblem } from '../../lib/movementReport';
import {
  COLUMNS, LOOKBACK_DAYS, readOrders, MAX_LOOKBACK_DAYS, STOP_MS, STAND_KMH, tripOf, findStorages, customersIn, deliveryRow, rowCells, periodDays, spansDays, stopWords, csvTable, deliveriesPdfBody, backShort, matchGeofences,
} from '../../lib/deliveriesReport';
import { loadPlan, savePlan, lastPlanBefore, addVehicle, removeVehicle, setCustomers, setPins, setVehicleGroup, emptyPlan, loadOrders, saveOrder, readCoordinates, mergePins, PIN_RADIUS_M, PIN_RADIUS_MIN_M, PIN_RADIUS_MAX_M } from '../../lib/deliveryPlan';
import { loadPings } from '../../api/fleetReports';
import { loadMovementReport, makeReportPdf } from '../../api/reports';
import { loadZones } from '../../hooks/useEstateZones';
import { deliveriesDoc } from '../../lib/reportDocs';
import { useReportEditor } from './ReportEditor';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { saveFile } from '../../api/tripReport';
import { downloadTableCsv } from '../../utils/tableExport';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import PdfPreview from '../shared/PdfPreview';
import DateRangePicker, { pickedText } from '../layout/DateRangePicker';
import HourWindow, { hoursText } from './HourWindow';
import ChoicePicker from './ChoicePicker';
import TableToolbar from '../body/TableToolbar';
import EmptyNote from '../shared/EmptyNote';
import CheckPicker from './CheckPicker';

const DAY = 86_400_000;
const lastWords = (h) => (h === 1 ? 'Last hour' : `Last ${h} hours`);

function Kpi({ value, label, tone }) {
  return (
    <div className={`sp4-kpi${tone ? ` sp4-kpi--${tone}` : ''}`}>
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

/** Stops pasted for one vehicle, geofence names or coordinates: the box, what it could not read, and the points held. */
function PinPaste({ vehicle, customers, onChange }) {
  const [text, setText] = useState('');
  const [radius, setRadius] = useState(PIN_RADIUS_M);
  const [told, setTold] = useState(null);                 // { added, bad }
  const pins = vehicle.pins ?? [];
  const add = () => {
    const { pins: read, bad } = readCoordinates(text, radius);
    const { names, rest } = matchGeofences(bad, customers);
    if (read.length || names.length) onChange(mergePins(pins, read), names);
    setTold({ added: read.length + names.length, bad: rest.length });
    setText(rest.join('\n'));                             // what did not read stays, to be put right
  };
  return (
    <div className="dlv-paste">
      <textarea className="dlv-paste__box" rows={4} value={text} spellCheck={false}
                aria-label={`Delivery stops for ${vehicle.plate}`}
                placeholder={'One stop a line, a geofence’s name or coordinates from a sheet or a map:\nJOJAC INVESTMENTS\nNaivas Nakuru, -0.28802, 36.04494'}
                onChange={(e) => { setText(e.target.value); setTold(null); }} />
      <div className="dlv-paste__foot">
        <label className="dlv-paste__radius">
          Within
          <input type="number" min={PIN_RADIUS_MIN_M} max={PIN_RADIUS_MAX_M} step={10} value={radius}
                 onChange={(e) => setRadius(e.target.value)} /> m
        </label>
        <button type="button" className="sp4-ghost-btn" disabled={!text.trim()} onClick={add}>
          <i className="ti ti-plus" aria-hidden="true" /> Add stops
        </button>
        {told && (
          <span className={told.bad ? 'rpt-warn' : 'rpt-sub'} role="status">
            {told.added} added{told.bad ? `; ${told.bad} line${told.bad === 1 ? '' : 's'} left in the box matched no geofence and had no coordinates` : ''}
          </span>
        )}
        {pins.length > 0 && (
          <button type="button" className="sp4-ghost-btn dlv-paste__clear" onClick={() => onChange([])}>Remove all {pins.length}</button>
        )}
      </div>
      {pins.length > 0 && (
        <ul className="dlv-paste__pins">
          {pins.map((p) => (
            <li key={`${p.lat},${p.lng}`} className="dlv-paste__pin" title={`${p.lat}, ${p.lng}, within ${p.radiusM} m`}>
              <span>{p.name || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}</span>
              <span className="rpt-sub">{p.radiusM} m</span>
              <button type="button" aria-label={`Remove ${p.name || 'this point'}`} onClick={() => onChange(pins.filter((x) => x !== p))}>
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DeliveriesReport({ orgId, vehicles, orgCode, companyName }) {
  const now = Date.now();
  const today = fleetDay(now);
  // The window, as Movements': the last hours, or days and hours. The list of
  // vehicles is a day's: a range of days runs its first day's list
  const [sel, setSel] = useState({ mode: 'last', hours: LAST_HOURS[0] });
  const [draft, setDraft] = useState({ fromDay: today, toDay: today, start: 7, end: 20 });
  const [daysOpen, setDaysOpen] = useState(true);
  const dayOf = (next) => (next.mode === 'days' ? next.fromDay : today);
  const day = daysOpen ? draft.fromDay : today;
  const [group, setGroup] = useState(null);               // one group of the fleet list, or all
  const [plan, setPlan] = useState(() => loadPlan(orgCode, day));
  useEffect(() => { setPlan(loadPlan(orgCode, day)); }, [orgCode, day]);
  const change = (next) => { setPlan(next); savePlan(orgCode, day, next); };
  const earlier = useMemo(() => (plan.vehicles.length ? null : lastPlanBefore(orgCode, day)), [plan.vehicles.length, orgCode, day]);

  // Every Menengai unit on the platform (operator, 4 Nov 2026: "search any
  // vehicle in Menengai"), with its group on the fleet list where it has one
  const units = useMemo(() => {
    const listed = new Map(groupsFor('MENENGAI').flatMap((g) => scopeUnits(vehicles, groupsFor('MENENGAI'), g.name).units.map((u) => [u.key, g.name])));
    return scopeUnits(vehicles, null).units.map((u) => ({ ...u, group: listed.get(u.key) ?? null, name: u.vehicles[0]?.name ?? '' }))
      .sort((a, b) => a.plate.localeCompare(b.plate, 'en', { numeric: true }));
  }, [vehicles]);
  const unitOf = (key) => units.find((u) => u.key === key);
  const [find, setFind] = useState('');
  const [justAdded, setJustAdded] = useState(null);       // its stops picker opens, as the geofences come next
  // A unit put under another group than its own asks first (operator, 5 Nov 2026: "before putting
  // there can be a prompt like: this unit belongs to VS, assign it anyway?")
  const [assign, setAssign] = useState(null);             // { words, yes, go }
  const ownGroup = (key) => unitOf(key)?.group ?? null;
  const groupOfV = (v) => v.group ?? ownGroup(v.key);
  const addUnit = (u) => {
    const put = () => {
      const next = addVehicle(plan, u);
      change(group && group !== u.group ? setVehicleGroup(next, u.key, group) : next);
      setJustAdded(u.key); setFind('');
    };
    if (group && u.group && group !== u.group && !plan.vehicles.some((v) => v.key === u.key)) {
      setAssign({ words: `${u.plate} belongs to ${u.group}. Assign it to ${group} anyway?`, yes: `Assign to ${group}`, go: put });
    } else put();
  };
  const moveTo = (v, g) => {
    const own = ownGroup(v.key);
    const go = () => change(setVehicleGroup(plan, v.key, g === own ? null : g));
    if (own && g !== own) setAssign({ words: `${v.plate} belongs to ${own}. Assign it to ${g} anyway?`, yes: `Assign to ${g}`, go });
    else go();
  };
  // Orders fulfilled typed over the report's own count (operator, 4 Nov 2026: "the user should have the
  // option to edit the delivered like 8/10 and generate the report"), by plate; the last value typed for
  // each plate is kept in this browser and comes back on the next report (operator, 5 Nov 2026)
  const [typed, setTyped] = useState(() => loadOrders(orgCode));
  const findHits = useMemo(() => {
    const q = find.replace(/\s+/g, '').toUpperCase();
    if (!q) return [];
    return units.filter((u) => !plan.vehicles.some((v) => v.key === u.key)
      && (u.plate.replace(/\s+/g, '').toUpperCase().includes(q) || String(u.name).replace(/\s+/g, '').toUpperCase().includes(q))).slice(0, 12);
  }, [find, units, plan.vehicles]);

  // The geofences: storages and customers
  const [zones, setZones] = useState({ status: 'idle' });
  useEffect(() => {
    if (!orgId) return undefined;
    let live = true;
    setZones({ status: 'loading' });
    loadZones(orgId).then((z) => {
      if (!live) return;
      const storages = findStorages(z);
      setZones({ status: 'done', fc: z, storages, customers: customersIn(z, storages) });
    }).catch((err) => { if (live) setZones({ status: 'error', message: err?.message ?? String(err) }); });
    return () => { live = false; };
  }, [orgId]);
  const customers = useMemo(() => zones.customers ?? [], [zones.customers]);
  const options = useMemo(() => customers.map((c) => ({ value: c.name, label: c.label, note: c.nearStorage ? 'at storage' : c.kind })), [customers]);

  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const [open, setOpen] = useState(() => new Set());
  const [pasting, setPasting] = useState(() => new Set()); // vehicles with the coordinates box open
  const [showStops, setShowStops] = useState(true);       // the pick-up locations on the PDF and JPEG
  const runId = useRef(0);

  const daysProblem = windowsProblem({ mode: 'days', ...draft });
  const problem = !orgId ? 'Waiting for the organisation to load'
    : daysOpen && daysProblem ? daysProblem
      : !plan.vehicles.length ? 'Add the vehicles shared today'
        : null;

  const execute = async (next) => {
    const windows = movementWindows(next);
    // This window's day decides the list: the page may still hold another day's
    const runPlan = loadPlan(orgCode, dayOf(next));
    setSel(next);
    if (!orgId || !windows.length || !runPlan.vehicles.length) return;
    const windowFrom = windows[0].from;
    const { to } = windows[windows.length - 1];
    const id = ++runId.current;
    const live = () => id === runId.current;
    try {
      setTyped(loadOrders(orgCode));
      setRun({ status: 'loading', words: 'Finding MORL, the Nairobi depot and the customers', done: 0, total: 0 });
      // Each step says what it was doing when it fails; Movements (where each
      // vehicle is now) is help, not a need: without it the report still runs
      const step = (words, p) => p.catch((err) => { throw new Error(`${words}: ${err?.message ?? err}`); });
      const [fc, moves] = await Promise.all([
        zones.fc ? Promise.resolve(zones.fc) : step('The geofences could not be read', loadZones(orgId)),
        loadMovementReport({ orgId, from: to - 3600_000, to }).catch(() => null),
      ]);
      if (!live()) return;
      const storages = findStorages(fc, moves?.morl);
      const all = customersIn(fc, storages);
      const byName = new Map(all.map((c) => [c.name, c]));
      const moveRow = new Map((moves?.groups ?? []).flatMap((g) => g.rows).map((row) => [row.vehicleId, row]));
      const planned = runPlan.vehicles.map((v) => ({ ...v, vehicleIds: unitOf(v.key)?.vehicles.map((x) => x.vehicleId) ?? v.vehicleIds }));
      // Every reading of the last days, then a day further back at a time for
      // the vehicles not yet seen leaving a storage, up to MAX_LOOKBACK_DAYS
      const held = new Map();
      const failed = new Set();
      const read = async (ids, a, b, words) => {
        const r = await loadPings({
          orgId, vehicles: ids.map((vehicleId) => ({ vehicleId })), from: a, to: b,
          onProgress: ({ done, total }) => { if (live()) setRun({ status: 'loading', words, done, total }); },
        });
        for (const [vid, pings] of r.pings) held.set(vid, [...pings, ...(held.get(vid) ?? [])].sort((x, y) => x.t - y.t));
        r.failed.forEach((x) => failed.add(x));
      };
      // A vehicle with two trackers: the one that reported most
      const best = (v) => [...v.vehicleIds].sort((a, b) => (held.get(b)?.length ?? 0) - (held.get(a)?.length ?? 0))[0];
      let start = Math.min(to - LOOKBACK_DAYS * DAY, windowFrom - DAY);
      await read(planned.flatMap((v) => v.vehicleIds), start, to, 'Reading each vehicle’s positions');
      if (!live()) return;
      for (let back = LOOKBACK_DAYS + 1; back <= MAX_LOOKBACK_DAYS; back++) {
        const need = planned.filter((v) => tripOf(held.get(best(v)) ?? [], storages, { to }).need);
        if (!need.length) break;
        await read(need.flatMap((v) => v.vehicleIds), start - DAY, start - 1, `Finding when ${need.length === 1 ? need[0].plate : `${need.length} vehicles`} left MORL or the depot, ${back} days back`);
        if (!live()) return;
        start -= DAY;
      }
      const rows = planned.map((v) => {
        // The tracker Movements reads for it, else the one that reported most
        const mv = v.vehicleIds.map((id) => moveRow.get(id)).find(Boolean) ?? null;
        const id = mv?.vehicleId ?? best(v);
        const row = deliveryRow(v, held.get(id) ?? [], storages, byName, {
          from: windowFrom, to, windows, routes: v.vehicleIds.map((x) => held.get(x) ?? []), place: mv?.location ?? null, atMorl: mv?.state === 'at', unread: v.vehicleIds.every((x) => failed.has(x)),
          lastFix: mv?.lat != null && mv?.lastAt != null ? { t: mv.lastAt, lat: mv.lat, lng: mv.lng } : null,
        });
        return { ...row, group: groupOfV(v), ownGroup: ownGroup(v.key) };
      });
      setRun({ status: 'done', rows, from: windowFrom, at: to, storages: storages.map((s) => `${s.label} (${s.name})`), failed: failed.size, noMoves: !moves });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const ran = run.status === 'done' ? run : null;
  // The rows as the PDF, JPEG and CSV print them: a typed count over the report's
  const done = useMemo(() => (ran ? { ...ran, rows: ran.rows.filter((r) => group == null || r.group === group).map((r) => {
    const t = readOrders(typed[r.plate]);
    return t ? { ...r, fulfilled: t.fulfilled, planned: t.planned, typed: true } : r;
  }) } : null), [ran, typed, group]);
  // How many on the day's list in each group
  const groupNames = useMemo(() => groupsFor('MENENGAI').map((g) => g.name), []);
  const groupCount = (name) => plan.vehicles.filter((v) => groupOfV(v) === name).length;
  const sums = done ? {
    out: done.rows.filter((x) => x.trip.leftAt != null && x.trip.arrivedAt == null).length,
    back: done.rows.filter((x) => x.trip.arrivedAt != null).length,
    fulfilled: done.rows.reduce((s, x) => s + x.fulfilled, 0),
    planned: done.rows.reduce((s, x) => s + x.planned, 0),
  } : null;
  const kpis = [
    { label: 'Vehicles', value: done ? String(done.rows.length) : null },
    { label: 'Out on delivery', value: sums ? String(sums.out) : null, tone: sums?.out ? 'live' : undefined },
    { label: 'Back at storage', value: sums ? String(sums.back) : null },
    { label: 'Orders fulfilled', value: sums ? `${sums.fulfilled}/${sums.planned}` : null },
  ];

  // Edit (operator, 4 Nov 2026), as the other reports: a new run, group or choice of stops starts the sheet over
  const editSource = useMemo(() => (done ? { done, showStops } : null), [done, showStops]);
  const editor = useReportEditor({ orgId, source: editSource,
    build: () => deliveriesDoc(done.rows, { from: done.from, at: done.at, fleet: companyName ?? orgCode ?? 'Menengai', group, stops: showStops, orgCode }) });

  // The server draws the PDF from the rows (reports/deliveries.pdf), as the other Movements tabs; the JPEG comes from that PDF
  const makePdf = (landscape) => (editor.edited ? editor.make(landscape) : makeReportPdf({ orgId, kind: 'deliveries', landscape,
    body: deliveriesPdfBody(done.rows, { from: done.from, at: done.at, fleet: companyName ?? orgCode ?? 'Menengai', group, stops: showStops }) }));
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
  const preview = usePdfPreview(makePdf);
  const saveCsv = () => done && downloadTableCsv({ ...csvTable(done.rows, { withDay: spansDays(done.from, done.at) }), filenameSlug: `deliveries-${fleetDay(done.at)}` });
  const flip = (s, k) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const toggle = (k) => setOpen((s) => flip(s, k));


  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} tone={k.tone} value={k.value ?? <span className="frp-kpi-none">-</span>} />
          ))}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <div className="sp4-filter-group" role="group" aria-label="Window">
          {LAST_HOURS.map((h) => {
            const on = !daysOpen && sel.mode === 'last' && sel.hours === h;
            return (
              <button key={h} type="button" aria-pressed={on}
                      className={`sp4-filter-chip${on ? ' sp4-filter-chip--on' : ''}`}
                      onClick={() => editor.guard('Make the report again', () => { setDaysOpen(false); execute({ mode: 'last', hours: h }); })}>
                {lastWords(h)}
              </button>
            );
          })}
        </div>

        <DateRangePicker
          from={draft.fromDay} to={draft.toDay} today={today} maxDays={MAX_MOVEMENT_DAYS} quickPicks={false}
          label="Days and hours" on={daysOpen} disabled={!orgId}
          text={`${pickedText(draft.fromDay, draft.toDay, today)} · ${hoursText(draft.start, draft.end)}`}
          onChange={(f, t) => { setDaysOpen(true); setDraft((d) => ({ ...d, fromDay: f, toDay: t ?? f })); }}
        >
          {({ close }) => (
            <>
              <HourWindow start={draft.start} end={draft.end}
                          onChange={(s, e) => { setDaysOpen(true); setDraft((d) => ({ ...d, start: s, end: e })); }} />
              <div className="mvr-hours__foot">
                {daysProblem && <span className="rpt-problem" role="status">{daysProblem}</span>}
                <button type="button" className="sp4-submit-btn frp-run"
                        disabled={run.status === 'loading' || Boolean(problem)} title={problem ?? 'Make the report'}
                        onClick={() => { close(); editor.guard('Make the report again', () => execute({ mode: 'days', ...draft })); }}>
                  {run.status === 'loading' ? 'Running…' : 'Run report'}
                </button>
              </div>
            </>
          )}
        </DateRangePicker>

        <ChoicePicker icon="ti-users-group" label="Group" align="right" value={group}
                      options={[{ value: null, label: 'All groups', note: plan.vehicles.length },
                        ...groupNames.map((name) => ({ value: name, label: name, note: groupCount(name) }))]}
                      onChange={(g) => editor.guard('Show another group', () => setGroup(g))} />

        <button type="button" className="sp4-submit-btn frp-run rpt-run"
                onClick={() => editor.guard('Make the report again', () => execute(daysOpen ? { mode: 'days', ...draft } : sel))}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      {editor.overlay}

      <div className="sp4-body rpt-body">
        {/* The day's list: the vehicles shared, each with its customers */}
        <section className="dlv-plan" aria-label="Today’s vehicles">
          <div className="dlv-plan__head">
            <h3 className="dlv-plan__title">
              {daysOpen && draft.toDay !== draft.fromDay ? 'Vehicles and stops for ' : 'Vehicles shared on '}
              {periodDays(Date.parse(`${day}T09:00:00+03:00`), Date.parse(`${daysOpen ? draft.toDay : day}T09:00:00+03:00`))}
            </h3>
            <span className="rpt-sub">Kept in this browser.</span>
          </div>
          {zones.status === 'done' && !customers.length && (
            <p className="rpt-warn dlv-plan__warn">No geofences are on the platform for Menengai yet, so stops cannot be picked.</p>
          )}
          {zones.status === 'error' && <p className="rpt-warn dlv-plan__warn">The geofences could not be read: {zones.message}</p>}
          <div className="dlv-plan__add">
            <div className="dlv-find">
              <div className="sp4-search-wrap">
                <i className="ti ti-search sp4-search-icon" aria-hidden="true" />
                <input className="sp4-search" type="search" value={find} placeholder="Add a vehicle: type its plate, e.g. KDE 127E"
                       aria-label="Find a vehicle to add" onChange={(e) => setFind(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter' && findHits[0]) addUnit(findHits[0]); }} />
              </div>
              {find.trim() && (
                <ul className="dlv-find__list" role="listbox" aria-label="Vehicles found">
                  {findHits.map((u) => (
                    <li key={u.key}>
                      <button type="button" role="option" aria-selected="false" className="dlv-find__hit"
                              onClick={() => addUnit(u)}>
                        <b>{u.plate}</b><span className="rpt-sub">{u.group ?? u.name}</span>
                      </button>
                    </li>
                  ))}
                  {!findHits.length && <li className="rpt-sub dlv-find__none">No Menengai vehicle matches.</li>}
                </ul>
              )}
            </div>
            {earlier && (
              <button type="button" className="sp4-ghost-btn" onClick={() => change({ ...emptyPlan(), ...earlier.plan })}
                      title={`Copy the list of ${earlier.day}`}>
                <i className="ti ti-copy" aria-hidden="true" /> Copy {earlier.day}’s list
              </button>
            )}
          </div>
          {assign && (
            <div className="mvr-confirm dlv-assign" role="alertdialog" aria-labelledby="dlv-assign-words">
              <span id="dlv-assign-words">{assign.words}</span>
              <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setAssign(null)} autoFocus>Cancel</button>
              <button type="button" className="sp4-submit-btn frp-run mvr-confirm__go"
                      onClick={() => { const { go } = assign; setAssign(null); go(); }}>{assign.yes}</button>
            </div>
          )}
          {plan.vehicles.length > 0 && (
            <ul className="dlv-plan__list">
              {plan.vehicles.map((v) => {
                const picked = v.customers.length + (v.pins?.length ?? 0);
                const isPasting = pasting.has(v.key);
                const near = v.customers.filter((n) => customers.find((c) => c.name === n)?.nearStorage).length;
                return (
                  <li key={v.key} className="dlv-plan__veh">
                    <span className="dlv-plan__plate">{v.plate}</span>
                    <select className="rpt-select dlv-plan__group" value={groupOfV(v) ?? ''} aria-label={`Group ${v.plate} is reported under`}
                            title={v.group && v.group !== ownGroup(v.key) ? `Assigned here today; on the fleet list it is ${ownGroup(v.key) ?? 'in no group'}` : 'The group it is reported under'}
                            onChange={(e) => e.target.value && moveTo(v, e.target.value)}>
                      {!groupOfV(v) && <option value="">No group</option>}
                      {groupNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    {v.group && v.group !== ownGroup(v.key) && <span className="rpt-sub dlv-plan__moved">from {ownGroup(v.key) ?? 'no group'}</span>}
                    <CheckPicker icon="ti-map-pin" label={`Stops for ${v.plate}`} noun="geofences" search noAll
                                 options={options} picked={v.customers} startOpen={justAdded === v.key}
                                 onChange={(names) => change(setCustomers(plan, v.key, names ?? []))} />
                    <button type="button" className="sp4-ghost-btn" aria-expanded={isPasting} onClick={() => setPasting((s) => flip(s, v.key))}>
                      <i className="ti ti-clipboard-text" aria-hidden="true" /> Paste stops{v.pins?.length ? ` (${v.pins.length})` : ''}
                    </button>
                    <span className="rpt-sub">{picked} stop{picked === 1 ? '' : 's'}{near ? ` · ${near} at storage` : ''}</span>
                    <button type="button" className="sp4-ghost-btn dlv-plan__x" onClick={() => change(removeVehicle(plan, v.key))}
                            aria-label={`Remove ${v.plate}`} title="Remove this vehicle from today’s list">
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                    {isPasting && <PinPaste vehicle={v} customers={customers} onChange={(pins, names = []) => change(setCustomers(setPins(plan, v.key, pins), v.key, [...v.customers, ...names]))} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {run.status === 'idle' && plan.vehicles.length > 0 && (
          <EmptyNote icon="ti-truck-delivery" title="Deliveries">Give each vehicle the geofences it should deliver to, choose the window, then press Run report. Its origin, MORL or the Nairobi depot, comes from its route.</EmptyNote>
        )}
        {run.status === 'loading' && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report" progress={run.total ? run.done / run.total : null}>
            {run.total ? `${run.words}: ${Math.min(run.done + 1, run.total)} of ${run.total}.` : `${run.words}…`}
          </EmptyNote>
        )}
        {run.status === 'error' && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: () => execute(daysOpen ? { mode: 'days', ...draft } : sel) }}>
            {run.message}
          </EmptyNote>
        )}

        {done && (
          <>
            <TableToolbar
              summary={<>
                <strong>{done.rows.length}</strong> vehicle{done.rows.length === 1 ? '' : 's'}
                <span className="rpt-sub"> · {periodWords(done.from, done.at)}</span>
                {done.failed > 0 && <span className="rpt-warn"> · {done.failed} tracker{done.failed === 1 ? '' : 's'} could not be read</span>}
                {done.rows.some((r) => backShort(r) > 0) && <span className="rpt-warn"> · {done.rows.filter((r) => backShort(r) > 0).length} back with stops undelivered</span>}
                {done.noMoves && <span className="rpt-warn"> · Movements could not be read, so current locations are missing</span>}
              </>}
              onCsv={done.rows.length ? saveCsv : undefined}
              onPdf={file.busy || !done.rows.length ? undefined : (landscape) => save('pdf', landscape)} pdfWays
              actions={<>
                {editor.button}
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <label className="dlv-stops-opt" title="The list of each vehicle's pick-up locations, ticked or not, under the table">
                  <input type="checkbox" checked={showStops} onChange={(e) => { const on = e.target.checked; editor.guard(on ? 'Show the pick-up locations' : 'Leave the pick-up locations out', () => setShowStops(on)); }} /> Show pick-up locations
                </label>
                <JpegButton className="sp4-ghost-btn rpt-log" onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy) || !done.rows.length} title="The PDF report as an image" />
                <PreviewButton className="sp4-ghost-btn rpt-log" onPreview={preview.open} disabled={!done.rows.length} />
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Deliveries report" caption={periodWords(done.from, done.at)} onRetry={preview.retry} onClose={preview.close} />}
            <p className="mvr-depots" role="note">
              <span>Delivered: stood {STOP_MS / 60_000 === 1.5 ? '1½' : STOP_MS / 60_000} min at {STAND_KMH} km/h or under, inside the stop’s geofence or within its pasted distance, anywhere on the route in the hours picked.</span>
              <span>Origin: the first of these the route was at, and a trip ends only back there: {done.storages.join(', ') || 'none found'}.</span>
            </p>
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table dlv-table">
                <thead>
                  <tr><th colSpan={COLUMNS.length + 1} className="dlv-day">{periodDays(done.from, done.at)}</th></tr>
                  <tr>{COLUMNS.map((h) => <th key={h} scope="col">{h}</th>)}<th scope="col"><span className="mvr-sr">Customers</span></th></tr>
                </thead>
                <tbody>
                  {done.rows.map((r) => {
                    const cellsOf = rowCells(r);
                    const isOpen = open.has(r.plate);
                    return (
                      <Fragment key={r.plate}>
                        <tr className="sp4-tr">
                          {cellsOf.map((v, i) => (
                            <td key={i} className={i === 0 ? 'rpt-unit' : undefined}>
                              {i === 2 ? (
                                <input type="text" inputMode="numeric" className={`mvr-edit dlv-orders${r.typed ? ' mvr-edit--changed' : ''}${typed[r.plate] && !readOrders(typed[r.plate]) ? ' dlv-orders--bad' : ''}`}
                                       value={typed[r.plate] ?? v} readOnly={editor.edited} aria-label={`Orders fulfilled by ${r.plate}, e.g. 8/10`}
                                       title={editor.edited ? 'The report has been edited: change this on the sheet, or undo the edits' : 'Type the orders fulfilled, e.g. 8/10. It is kept in this browser for the next report; clear it to use the report’s own count.'}
                                       onChange={(e) => {
                                         const text = e.target.value;
                                         setTyped((t) => ({ ...t, [r.plate]: text }));
                                         // Kept once it reads as a count, or forgotten when cleared
                                         if (!text.trim() || readOrders(text)) saveOrder(orgCode, r.plate, text);
                                       }} />
                              ) : v}
                            </td>
                          ))}
                          <td>
                            <button type="button" className="sp4-ghost-btn dlv-more" onClick={() => toggle(r.plate)} aria-expanded={isOpen}>
                              {isOpen ? 'Hide' : 'Customers'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="dlv-cust">
                            <td colSpan={COLUMNS.length + 1}>
                              {!r.customers.length ? <span className="rpt-sub">No customers given.</span> : (
                                <ul>
                                  {r.customers.map((c) => (
                                    <li key={c.name} className={c.at ? 'dlv-cust--done' : c.reachedAt ? 'dlv-cust--near' : 'dlv-cust--no'}>
                                      <i className={`ti ${c.at ? 'ti-circle-check' : c.reachedAt ? 'ti-alert-circle' : 'ti-circle-x'}`} aria-hidden="true" />
                                      {c.label}
                                      <span className="rpt-sub"> {stopWords(c, spansDays(done.from, done.at))}{c.nearStorage ? ' · at storage' : ''}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
