/*
 * Deliveries Report (operator, 4 Nov 2026; Menengai's Finished Goods and Van
 * Sales): a tab under Movements. The operator picks a plate and inserts the
 * geofences it should deliver to (saved on the server, api/deliveries, which
 * also keeps each listed vehicle as its Planner plan for the day); a
 * run plays each route back, finds its origin (MORL or the Nairobi depot, two
 * different places), and says when it left, how many of its stops it delivered
 * to (stood 1½ minutes in the geofence, within the window), where it is, and
 * when it came back, all delivered or not. Stops are geofences, or points pasted as coordinates, and
 * the vehicle's whole route in the window is run against them. The bar is
 * Movements': the last hours or days and the same hours on each (with the first
 * day's list), a group, Run report; then JPEG, Preview, CSV and PDF over the group picked.
 * lib/deliveriesReport does the reading; this is the page, and the PDF, JPEG
 * and CSV.
 *
 * Sheets saved in the Planner (operator, 11 Nov 2026: "the planner already
 * tracks, we just need to render a report on the deliveries report") come in
 * as rows of their own: each is read exactly as the Planner reads it
 * (lib/plannerReport), over its own 48 hours from printing, and a vehicle on
 * a sheet is not checked again from the hand list.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { groupsFor, scopeUnits } from '../../lib/fleetGroups';
import { fleetDay, periodWords, dayStart, daysCovering } from '../../lib/fleetReports';
import { marksOf } from '../../lib/plannerDayMarks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDeliveryDay, saveDeliveryDay, lastDeliveryDayBefore, getDeliveryOrders, saveDeliveryOrder } from '../../api/deliveries';
import { LAST_HOURS, MAX_MOVEMENT_DAYS, movementWindows, windowsProblem } from '../../lib/movementReport';
import {
  COLUMNS, LOOKBACK_DAYS, readOrders, MAX_LOOKBACK_DAYS, STOP_MS, STAND_KMH, PASS_COUNTS, PASS_RADIUS_M, storageAt, tripOf, findStorages, customersIn, deliveryRow, rowCells, periodDays, spansDays, stopWords, csvTable, deliveriesPdfBody, backShort, matchGeofences, sheetStops,
} from '../../lib/deliveriesReport';
import { loadPlan, forgetLegacyPlan, forgetLegacyOrders, addVehicle, removeVehicle, setCustomers, setPins, setVehicleGroup, emptyPlan, loadOrders, readCoordinates, mergePins, PIN_RADIUS_M, PIN_RADIUS_MIN_M, PIN_RADIUS_MAX_M } from '../../lib/deliveryPlan';
import { loadPings } from '../../api/fleetReports';
import { loadMovementReport, makeReportPdf } from '../../api/reports';
import { TEMPLATES, loadTemplate, saveTemplate, fgLines, fgCells, fgCsv, finishedGoodsDoc, FG_HEADS, fgState, fgFill } from '../../lib/finishedGoodsReport';
import { listPlans, getPlan, fileAsBase64, previewSheet } from '../../api/planner';
import { sheetDaysFor, sheetsForReport, sheetOnDays, trackersFor, readSpan, actualFor, sheetRow, sheetWords, outcomeWords, plateKey } from '../../lib/plannerReport';
import { kmWords, isKeyed } from '../../lib/plannerActual';
import { openPlanNext } from '../../lib/planOverlay';
import { usePermissions } from '../../hooks/usePermissions';
import { useAppActions } from '../../context/AppContext';
import { loadZones } from '../../hooks/useEstateZones';
import { deliveriesDoc } from '../../lib/reportDocs';
import { useReportEditor } from './ReportEditor';
import './DeliveriesReport.css';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { saveLetterheadPdf, saveLetterheadJpeg, letterheadLogos } from '../../api/letterheadPdf';
import { docHtml } from '../../lib/docHtml';
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
function PinPaste({ orgId, vehicle, customers, onChange }) {
  const [text, setText] = useState('');
  const [radius, setRadius] = useState(PIN_RADIUS_M);
  const [told, setTold] = useState(null);                 // { added, bad } or { sheet: words, warn }
  const [reading, setReading] = useState(false);
  const pins = vehicle.pins ?? [];
  // A Sales Order Booking Delivery Sheet, read by the Planner's own reader on
  // the server (it saves nothing), its stops added as a paste's would be
  const fromSheet = async (file) => {
    if (!file || reading) return;
    setReading(true);
    setTold(null);
    try {
      if (file.size > 2_000_000) throw new Error('The file is over 2 MB.');
      const preview = await previewSheet(orgId, { fileName: file.name, data: await fileAsBase64(file) });
      const got = sheetStops(preview, customers, radius);
      if (got.pins.length || got.names.length) onChange(mergePins(pins, got.pins), got.names);
      const other = got.plate && plateKey(got.plate) !== plateKey(vehicle.plate);
      const words = [`${got.pins.length + got.names.length} added from the sheet${got.plate ? ` of ${got.plate}` : ''}`];
      if (got.unplaced.length) words.push(`${got.unplaced.length} with no point or geofence: ${got.unplaced.slice(0, 3).join(', ')}${got.unplaced.length > 3 ? ', …' : ''}`);
      if (other) words.push(`the sheet is for ${got.plate}, not ${vehicle.plate}`);
      setTold({ sheet: words.join('; '), warn: Boolean(other || got.unplaced.length || !(got.pins.length + got.names.length)) });
    } catch (err) {
      setTold({ sheet: `The sheet could not be read: ${err?.message ?? err}`, warn: true });
    } finally {
      setReading(false);
    }
  };
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
        <label className={`sp4-ghost-btn dlv-paste__sheet${reading ? ' is-busy' : ''}`}
               title="Add the stops of a Sales Order Booking Delivery Sheet (.xlsx)">
          <input type="file" accept=".xlsx,.xls" hidden disabled={reading || !orgId}
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; fromSheet(f); }} />
          <i className={`ti ${reading ? 'ti-loader-2' : 'ti-file-spreadsheet'}`} aria-hidden="true" /> {reading ? 'Reading the sheet…' : 'From an Excel sheet'}
        </label>
        {told?.sheet && <span className={told.warn ? 'rpt-warn' : 'rpt-sub'} role="status">{told.sheet}</span>}
        {told && !told.sheet && (
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
  // Van Sales (the report as it was) or Finished Goods (operator, 11 Nov 2026), kept in this browser
  const [template, setTemplate] = useState(() => loadTemplate(orgCode));
  useEffect(() => { setTemplate(loadTemplate(orgCode)); }, [orgCode]);
  const isFg = template === 'finishedGoods';
  // The day's list lives on the server, read through its Redis cache (operator, 11 Nov 2026: "we don't
  // want it to be kept in the browser"). A list this browser kept before is moved up once, then forgotten
  const qc = useQueryClient();
  const dayQuery = (d) => ({
    queryKey: ['deliveries', 'day', orgId, d],
    queryFn: async () => {
      const got = await getDeliveryDay(orgId, d);
      const kept = loadPlan(orgCode, d);
      if (!got.vehicles.length && kept.vehicles.length) {
        await saveDeliveryDay(orgId, d, kept.vehicles);
        forgetLegacyPlan(orgCode, d);
        return { vehicles: kept.vehicles };
      }
      if (kept.vehicles.length) forgetLegacyPlan(orgCode, d);
      return { vehicles: got.vehicles };
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
  const dayList = useQuery(dayQuery(day));
  const plan = dayList.data ?? emptyPlan();
  // Saves go one after another, each the whole list, so the last change is the one kept
  const saving = useRef(Promise.resolve());
  // `failedDay`: a day whose list on screen is not yet on the server. The list is kept as the operator
  // left it (never snapped back to the server's copy) until Try again, or the next change, saves it
  const [saveState, setSaveState] = useState({ busy: 0, error: null, failedDay: null });
  const change = (next) => {
    const key = ['deliveries', 'day', orgId, day];
    const forDay = day;
    qc.setQueryData(key, next);
    setSaveState((s) => ({ busy: s.busy + 1, error: null, failedDay: null }));
    saving.current = saving.current.then(() => saveDeliveryDay(orgId, forDay, next.vehicles))
      .then(() => {
        setSaveState((s) => ({ ...s, busy: s.busy - 1 }));
        // The server keeps each listed vehicle as its Planner plan for the day: the Planner reads it afresh
        qc.invalidateQueries({ queryKey: ['planner', 'plans', orgId] });
      })
      .catch((err) => setSaveState((s) => ({ busy: s.busy - 1, error: err?.message ?? String(err), failedDay: forDay })));
  };
  const retrySave = () => {
    const d = saveState.failedDay;
    const list = d && qc.getQueryData(['deliveries', 'day', orgId, d]);
    if (list && d === day) change(list);
  };
  const earlierQ = useQuery({
    queryKey: ['deliveries', 'before', orgId, day],
    queryFn: () => lastDeliveryDayBefore(orgId, day),
    enabled: Boolean(orgId) && dayList.isSuccess && !plan.vehicles.length,
    staleTime: 60_000,
  });
  const earlier = !plan.vehicles.length && earlierQ.data ? { day: earlierQ.data.day, plan: { vehicles: earlierQ.data.vehicles } } : null;

  // Every Menengai unit on the platform (operator, 4 Nov 2026: "search any
  // vehicle in Menengai"), with its group on the fleet list where it has one
  const units = useMemo(() => {
    const listed = new Map(groupsFor('MENENGAI').flatMap((g) => scopeUnits(vehicles, groupsFor('MENENGAI'), g.name).units.map((u) => [u.key, g.name])));
    return scopeUnits(vehicles, null).units.map((u) => ({ ...u, group: listed.get(u.key) ?? null, name: u.vehicles[0]?.name ?? '' }))
      .sort((a, b) => a.plate.localeCompare(b.plate, 'en', { numeric: true }));
  }, [vehicles]);
  const unitOf = (key) => units.find((u) => u.key === key);
  // The Planner's sheets for the window shown, before a run: listed, then read on Run report
  const { can } = usePermissions();
  const canSheets = can('planner:read');
  const { setDesktopActiveTab } = useAppActions();
  const findSheets = async (from, to) => {
    // Every sheet the Planner lists over the last week, for now (lib/plannerReport ALL_SHEETS)
    const d = sheetDaysFor(from, to, fleetDay);
    // Plans keyed in here are this list itself, so only uploaded sheets and itineraries come in as sheets
    return sheetsForReport((await listPlans(orgId, d.from, d.to)).filter((p) => !isKeyed(p)), from, to, dayStart);
  };
  const [sheets, setSheets] = useState({ status: 'idle', list: [] });
  const sheetSpanKey = daysOpen ? `days:${day}:${draft.toDay}` : `last:${sel.mode === 'last' ? sel.hours : ''}`;
  useEffect(() => {
    if (!orgId || !canSheets) { setSheets({ status: 'idle', list: [] }); return undefined; }
    let live = true;
    const t = Date.now();
    const from = daysOpen ? dayStart(day) : t - (sel.hours ?? 24) * 3600_000;
    const to = daysOpen ? Math.min(t, dayStart(draft.toDay) + DAY) : t;
    setSheets((x) => ({ ...x, status: 'loading' }));
    findSheets(from, to)
      .then((list) => { if (live) setSheets({ status: 'done', list }); })
      .catch((err) => { if (live) setSheets({ status: 'error', list: [], message: err?.message ?? String(err) }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, canSheets, sheetSpanKey]);
  const sheetPlates = useMemo(() => new Set(sheets.list.map((p) => plateKey(p.plate))), [sheets.list]);
  const openInPlanner = (planId) => { openPlanNext(planId); setDesktopActiveTab('planner'); };
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
  // each plate is kept on the server and comes back on the next report (operator, 5 Nov 2026; out of the
  // browser 11 Nov 2026). Counts this browser kept before are moved up once
  const ordersQuery = {
    queryKey: ['deliveries', 'orders', orgId],
    queryFn: async () => {
      const kept = Object.entries(loadOrders(orgCode));
      let all = await getDeliveryOrders(orgId);
      if (!kept.length) return all;
      for (const [plate, text] of kept) if (!all[plate]) all = await saveDeliveryOrder(orgId, plate, text);
      forgetLegacyOrders(orgCode);
      return all;
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
  };
  const orders = useQuery(ordersQuery);
  const [typed, setTyped] = useState({});
  useEffect(() => { if (orders.data) setTyped((t) => ({ ...orders.data, ...t })); }, [orders.data]);
  // One save per plate once the typing stops
  const orderTimers = useRef(new Map());
  const keepOrder = (plate, text) => {
    clearTimeout(orderTimers.current.get(plate));
    orderTimers.current.set(plate, setTimeout(() => {
      saveDeliveryOrder(orgId, plate, text)
        .then((all) => qc.setQueryData(ordersQuery.queryKey, all))
        .catch((err) => setSaveState((s) => ({ ...s, error: `The count for ${plate} was not saved: ${err?.message ?? err}` })));
    }, 600));
  };
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
  const options = useMemo(() => customers.map((c) => ({ value: c.name, label: c.label, title: c.name, note: c.nearStorage ? 'at storage' : c.kind })), [customers]);

  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const [open, setOpen] = useState(() => new Set());
  const [pasting, setPasting] = useState(() => new Set()); // vehicles with the coordinates box open
  const [showStops, setShowStops] = useState(true);       // the pick-up locations on the PDF and JPEG
  const runId = useRef(0);

  const daysProblem = windowsProblem({ mode: 'days', ...draft });
  const problem = !orgId ? 'Waiting for the organisation to load'
    : daysOpen && daysProblem ? daysProblem
      : !plan.vehicles.length && !sheets.list.length ? (sheets.status === 'loading' ? 'Looking for the Planner’s sheets' : 'Add the vehicles shared today, or upload their sheets in the Planner')
        : null;

  const execute = async (next) => {
    const windows = movementWindows(next);
    // This window's day decides the list: the page may still hold another day's
    const runPlan = orgId ? await qc.fetchQuery(dayQuery(dayOf(next))).catch(() => plan) : plan;
    setSel(next);
    if (!orgId || !windows.length) return;
    const windowFrom = windows[0].from;
    const { to } = windows[windows.length - 1];
    const id = ++runId.current;
    const live = () => id === runId.current;
    try {
      qc.fetchQuery(ordersQuery).then((o) => setTyped((t) => ({ ...o, ...t }))).catch(() => undefined);
      setRun({ status: 'loading', words: 'Finding MORL, the Nairobi depot and the customers', done: 0, total: 0 });
      // Each step says what it was doing when it fails; Movements (where each
      // vehicle is now) is help, not a need: without it the report still runs
      const step = (words, p) => p.catch((err) => { throw new Error(`${words}: ${err?.message ?? err}`); });
      const [fc, moves, sheetList] = await Promise.all([
        zones.fc ? Promise.resolve(zones.fc) : step('The geofences could not be read', loadZones(orgId)),
        loadMovementReport({ orgId, from: to - 3600_000, to }).catch(() => null),
        canSheets ? step('The Planner’s sheets could not be read', findSheets(windowFrom, to)) : Promise.resolve([]),
      ]);
      if (!live()) return;
      if (!runPlan.vehicles.length && !sheetList.length) {
        setRun({ status: 'error', message: 'No sheets were saved in the Planner for these hours, and no vehicles are on the list.' });
        return;
      }
      const storages = findStorages(fc, moves?.morl);
      const all = customersIn(fc, storages);
      const byName = new Map(all.map((c) => [c.name, c]));
      const moveRow = new Map((moves?.groups ?? []).flatMap((g) => g.rows).map((row) => [row.vehicleId, row]));
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
      // The sheets: each read as the Planner reads it, over its own span
      setRun({ status: 'loading', words: 'Reading the Planner’s sheets', done: 0, total: 0 });
      const sheetPlans = await step('A sheet could not be read', Promise.all(sheetList.map((p) => getPlan(orgId, p.id))));
      if (!live()) return;
      const sheetUnits = sheetPlans.map((p) => ({ plan: p, trackers: trackersFor(p, vehicles), span: readSpan(p, dayStart) }));
      const sheetPings = new Map();
      const sheetTrackers = [...new Set(sheetUnits.flatMap((x) => x.trackers.map((v) => v.vehicleId)))];
      if (sheetTrackers.length) {
        const r = await loadPings({
          orgId, vehicles: sheetTrackers.map((vehicleId) => ({ vehicleId })),
          from: Math.min(...sheetUnits.map((x) => x.span.from)), to: Math.max(...sheetUnits.map((x) => x.span.to)),
          onProgress: ({ done, total }) => { if (live()) setRun({ status: 'loading', words: 'Reading the sheets’ trucks', done, total }); },
        });
        if (!live()) return;
        for (const [vid, pings] of r.pings) sheetPings.set(vid, pings);
        r.failed.forEach((x) => failed.add(x));
      }
      const reportDays = daysCovering(windowFrom, to);
      const sheetRowsAll = sheetUnits.map(({ plan: p, trackers, span }) => {
        const routes = trackers.map((v) => (sheetPings.get(v.vehicleId) ?? []).filter((x) => x.t >= span.from && x.t <= span.to));
        const { actual } = actualFor(p, routes, fc, dayStart);
        const mv = trackers.map((v) => moveRow.get(v.vehicleId)).find(Boolean) ?? null;
        const unit = units.find((u) => u.vehicles.some((x) => trackers.some((v) => v.vehicleId === x.vehicleId)));
        const why = !trackers.length ? 'No tracked unit carries this plate'
          : trackers.every((v) => failed.has(v.vehicleId)) ? 'Positions could not be read' : null;
        // Where the truck is now: Movements' MORL reading, else its latest position against MORL/STO
        const latest = routes.flat().reduce((a, x) => (!a || x.t > a.t ? x : a), null);
        const nowAt = mv?.lat != null && mv?.lastAt != null && (!latest || mv.lastAt >= latest.t) ? { lat: mv.lat, lng: mv.lng } : latest;
        const atStorage = (mv?.state === 'at' ? storages.find((s) => s.key === 'morl') ?? { key: 'morl', label: 'MORL', short: 'MORL' } : null)
          ?? (nowAt ? storageAt(nowAt, storages) : null);
        // "Mark for today" on the Planner: only the stops due on the report's days count (lib/plannerDayMarks)
        const opts = { place: mv?.location ?? null, why, atStorage, days: reportDays };
        const row = sheetRow(p, actual, { ...opts, marks: marksOf(p) });
        // Kept so a mark made after the run is taken without running again (see `marked` below)
        return { ...row, group: unit?.group ?? null, ownGroup: unit?.group ?? null, remake: { plan: p, actual, opts } };
      });
      // Only the sheets this report's days ran (lib/plannerReport sheetOnDays): no earlier day carried forward
      const sheetRows = sheetRowsAll.filter((r) => sheetOnDays(r, marksOf(r.remake.plan), reportDays, fleetDay));
      // A vehicle on a kept sheet is the sheet's row: not checked again from the list
      const onSheets = new Set(sheetRows.map((r) => plateKey(r.plate)));
      const planned = runPlan.vehicles.filter((v) => !onSheets.has(plateKey(v.plate))).map((v) => ({ ...v, vehicleIds: unitOf(v.key)?.vehicles.map((x) => x.vehicleId) ?? v.vehicleIds }));
      let start = Math.min(to - LOOKBACK_DAYS * DAY, windowFrom - DAY);
      if (planned.length) await read(planned.flatMap((v) => v.vehicleIds), start, to, 'Reading each vehicle’s positions');
      if (!live()) return;
      for (let back = LOOKBACK_DAYS + 1; planned.length && back <= MAX_LOOKBACK_DAYS; back++) {
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
      rows.unshift(...sheetRows);
      setRun({ status: 'done', rows, from: windowFrom, at: to, storages: storages.map((s) => `${s.label} (${s.name})`), failed: failed.size, noMoves: !moves, sheets: sheetRows.length });
    } catch (err) {
      if (live()) setRun({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  // Planner sheets made again with the marks as they are now: marking a stop "for today" on the
  // Planner changes the counts at once, with no new run (operator, 11 Nov 2026). The Planner keeps
  // each plan in the query cache under ['planner', 'plan', orgId, id]; a change there redraws these
  const [planTick, setPlanTick] = useState(0);
  useEffect(() => qc.getQueryCache().subscribe((e) => {
    const k = e?.query?.queryKey;
    if (e?.type === 'updated' && k?.[0] === 'planner' && k?.[1] === 'plan') setPlanTick((t) => t + 1);
  }), [qc]);
  const ranRaw = run.status === 'done' ? run : null;
  const ran = useMemo(() => (ranRaw ? { ...ranRaw, rows: ranRaw.rows.map((r) => {
    if (!r.remake) return r;
    const latest = qc.getQueryData(['planner', 'plan', orgId, r.remake.plan.id]) ?? r.remake.plan;
    return { ...sheetRow(r.remake.plan, r.remake.actual, { ...r.remake.opts, marks: marksOf(latest) }),
      group: r.group, ownGroup: r.ownGroup, remake: r.remake };
  }) } : null), [ranRaw, planTick, qc, orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The rows as the PDF, JPEG and CSV print them: a typed count over the report's
  const done = useMemo(() => (ran ? { ...ran, rows: ran.rows.filter((r) => group == null || r.group === group).map((r) => {
    const t = readOrders(typed[r.plate]);
    return t ? { ...r, fulfilled: t.fulfilled, planned: t.planned, typed: true } : r;
  }) } : null), [ran, typed, group]);
  // How many on the day's list in each group
  const groupNames = useMemo(() => groupsFor('MENENGAI').map((g) => g.name), []);
  const sheetGroup = (p) => units.find((u) => plateKey(u.plate) === plateKey(p.plate))?.group ?? null;
  const groupCount = (name) => plan.vehicles.filter((v) => !sheetPlates.has(plateKey(v.plate)) && groupOfV(v) === name).length
    + sheets.list.filter((p) => sheetGroup(p) === name).length;
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
  // Finished Goods lines taken off with ✕ (operator, 11 Nov 2026), until the next run
  const [dropped, setDropped] = useState(() => new Set());
  useEffect(() => { setDropped(new Set()); }, [ranRaw]);
  const drop = (key) => setDropped((d) => new Set(d).add(key));
  const editSource = useMemo(() => (done ? { done, showStops, template, dropped } : null), [done, showStops, template, dropped]);
  const fleetName = companyName ?? orgCode ?? 'Menengai';
  const fgDoc = () => finishedGoodsDoc(done.rows, { from: done.from, at: done.at, fleet: fleetName, group, orgCode, dropped });
  const editor = useReportEditor({ orgId, source: editSource,
    build: () => (isFg ? fgDoc() : deliveriesDoc(done.rows, { from: done.from, at: done.at, fleet: fleetName, group, stops: showStops, orgCode })) });
  const fgAll = useMemo(() => (done && isFg ? fgLines(done.rows, { at: done.at }) : []), [done, isFg]);
  const fgShown = useMemo(() => fgAll.filter((l) => !dropped.has(l.key)), [fgAll, dropped]);
  // Find a unit in the table (operator, 11 Nov 2026), as on Movements: "kcw475", "KCW 475E", "475e";
  // a customer's name too on Finished Goods. The screen only: CSV, PDF and JPEG keep every line
  const [unitSearch, setUnitSearch] = useState('');
  const needle = unitSearch.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const hits = (...texts) => !needle || texts.some((t) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(needle));
  const fgVisible = useMemo(() => fgShown.filter((l) => hits(l.plate, l.customer)), [fgShown, needle]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowsVisible = useMemo(() => (done ? done.rows.filter((r) => hits(r.plate)) : []), [done, needle]); // eslint-disable-line react-hooks/exhaustive-deps

  // The server draws the PDF from the rows (reports/deliveries.pdf), as the other Movements tabs; the JPEG comes from that PDF
  // Finished Goods: always landscape, ten columns, drawn in the browser on the letterhead so its
  // day bar can be black with white words (the server's bar is always blue)
  const fgHtml = (continuous) => { const d = fgDoc(); return { d, html: docHtml(d, { logos: letterheadLogos(), landscape: true, continuous }) }; };
  const makePdf = (landscape) => (editor.edited ? editor.make(isFg ? true : landscape)
    : isFg ? (() => { const { d, html } = fgHtml(false); return saveLetterheadPdf(html, { filename: `${d.filename}.pdf`, landscape: true, keep: true }); })()
    : makeReportPdf({ orgId, kind: 'deliveries', landscape,
    body: deliveriesPdfBody(done.rows, { from: done.from, at: done.at, fleet: companyName ?? orgCode ?? 'Menengai', group, stops: showStops }) }));
  const save = async (as, landscape = false) => {
    if (!done || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      if (isFg && !editor.edited && as === 'jpeg') {
        const { d, html } = fgHtml(true);
        await saveLetterheadJpeg(html, { filename: `${d.filename}.pdf`, landscape: true, continuous: true });
        setFile({ busy: false, error: null });
        return;
      }
      const { blob, filename } = await makePdf(landscape);
      if (as === 'jpeg') await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === 'jpeg' ? 'JPEG' : 'PDF'} could not be made: ${err?.message ?? err}` });
    }
  };
  const preview = usePdfPreview(makePdf);
  const saveCsv = () => done && (isFg
    ? downloadTableCsv({ ...fgCsv(fgShown), filenameSlug: `deliveries-finished-goods-${fleetDay(done.at)}` })
    : downloadTableCsv({ ...csvTable(done.rows, { withDay: spansDays(done.from, done.at) }), filenameSlug: `deliveries-${fleetDay(done.at)}` }));
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
                      options={[{ value: null, label: 'All groups', note: plan.vehicles.filter((v) => !sheetPlates.has(plateKey(v.plate))).length + sheets.list.length },
                        ...groupNames.map((name) => ({ value: name, label: name, note: groupCount(name) }))]}
                      onChange={(g) => editor.guard('Show another group', () => setGroup(g))} />

        <ChoicePicker icon="ti-template" label="Template" align="right" value={template}
                      options={TEMPLATES.map((t) => ({ value: t.value, label: `${t.label} template` }))}
                      onChange={(t) => editor.guard('Use another template', () => { setTemplate(t); saveTemplate(orgCode, t); })} />

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
            <span className={`dlv-plan__keep${saveState.error || dayList.isError ? ' dlv-plan__keep--error' : ''}`} role="status">
              {dayList.isError ? <><i className="ti ti-alert-triangle" aria-hidden="true" /> The list could not be read: {dayList.error?.message}</>
                : saveState.error ? <><i className="ti ti-alert-triangle" aria-hidden="true" /> Not saved: {saveState.error}
                  {saveState.failedDay === day && (
                    <button type="button" className="sp4-ghost-btn dlv-plan__retry" onClick={retrySave}>
                      <i className="ti ti-refresh" aria-hidden="true" /> Try again
                    </button>
                  )}</>
                  : dayList.isLoading ? 'Reading the list…'
                    : saveState.busy > 0 ? 'Saving…'
                      : <><i className="ti ti-cloud-check" aria-hidden="true" /> Saved for everyone in {companyName ?? orgCode ?? 'the organisation'}</>}
            </span>
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
          {sheets.status === 'error' && <p className="rpt-warn dlv-plan__warn">The Planner’s sheets could not be read: {sheets.message}</p>}
          {sheets.list.length > 0 && (
            <div className="dlv-sheets">
              <p className="rpt-sub dlv-sheets__lede">
                From the Planner: {sheets.list.length} sheet{sheets.list.length === 1 ? '' : 's'}, each read as the Planner reads it. Change a sheet’s stops in the Planner.
              </p>
              <ul className="dlv-plan__list dlv-roster">
                {sheets.list.map((p) => (
                  <li key={p.id} className="dlv-plan__veh dlv-roster__row">
                    <span className="dlv-plan__plate">{p.plate}</span>
                    <span className="rpt-sub">{sheetWords({ sheet: { planDate: p.planDate, driverName: p.driverName } }, kmWords)}, {p.stopCount} stop{p.stopCount === 1 ? '' : 's'}</span>
                    <button type="button" className="sp4-ghost-btn" onClick={() => openInPlanner(p.id)}>
                      <i className="ti ti-calendar-time" aria-hidden="true" /> Open in Planner
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.vehicles.length > 0 && (
            <>
            <div className="dlv-roster__head" aria-hidden="true">
              <span>Vehicle</span><span>Group</span><span>Stops</span><span /><span className="dlv-roster__count">Picked</span><span />
            </div>
            <ul className="dlv-plan__list dlv-roster">
              {plan.vehicles.map((v) => {
                const picked = v.customers.length + (v.pins?.length ?? 0);
                const isPasting = pasting.has(v.key);
                const near = v.customers.filter((n) => customers.find((c) => c.name === n)?.nearStorage).length;
                return (
                  <li key={v.key} className="dlv-plan__veh dlv-roster__row">
                    <span className="dlv-plan__plate">{v.plate}</span>
                    <span className="dlv-roster__group">
                    <select className="rpt-select dlv-plan__group" value={groupOfV(v) ?? ''} aria-label={`Group ${v.plate} is reported under`}
                            title={v.group && v.group !== ownGroup(v.key) ? `Assigned here today; on the fleet list it is ${ownGroup(v.key) ?? 'in no group'}` : 'The group it is reported under'}
                            onChange={(e) => e.target.value && moveTo(v, e.target.value)}>
                      {!groupOfV(v) && <option value="">No group</option>}
                      {groupNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    {v.group && v.group !== ownGroup(v.key) && <span className="dlv-plan__moved">from {ownGroup(v.key) ?? 'no group'}</span>}
                    </span>
                    <span className="dlv-roster__stops">
                    <CheckPicker icon="ti-map-pin" label={`Stops for ${v.plate}`} noun="geofences" search noAll
                                 options={options} picked={v.customers} startOpen={justAdded === v.key}
                                 onChange={(names) => change(setCustomers(plan, v.key, names ?? []))} />
                    </span>
                    <button type="button" className="sp4-ghost-btn dlv-roster__paste" aria-expanded={isPasting} onClick={() => setPasting((s) => flip(s, v.key))}>
                      <i className="ti ti-clipboard-text" aria-hidden="true" /> Paste stops{v.pins?.length ? ` (${v.pins.length})` : ''}
                    </button>
                    <span className="dlv-roster__count">
                      <span><b>{picked}</b> stop{picked === 1 ? '' : 's'}{near ? `, ${near} at storage` : ''}</span>
                      {picked > 0 && (
                        <span className={`dlv-meter${picked > 24 ? ' is-dense' : ''}`} aria-hidden="true">
                          {v.customers.map((name) => <i key={name} title={name} className={customers.find((c) => c.name === name)?.nearStorage ? 'is-storage' : undefined} />)}
                          {(v.pins ?? []).map((pin, i) => <i key={`pin${i}`} className="is-pin" title={pin.name || `${pin.lat}, ${pin.lng}`} />)}
                        </span>
                      )}
                    </span>
                    <button type="button" className="sp4-ghost-btn dlv-plan__x" onClick={() => change(removeVehicle(plan, v.key))}
                            aria-label={`Remove ${v.plate}`} title="Remove this vehicle from today’s list">
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                    {sheetPlates.has(plateKey(v.plate)) && <span className="rpt-warn dlv-roster__wide">On a Planner sheet: the sheet is reported instead</span>}
                    {isPasting && <div className="dlv-roster__wide"><PinPaste orgId={orgId} vehicle={v} customers={customers} onChange={(pins, names = []) => change(setCustomers(setPins(plan, v.key, pins), v.key, [...v.customers, ...names]))} /></div>}
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </section>

        {run.status === 'idle' && (plan.vehicles.length > 0 || sheets.list.length > 0) && (
          <EmptyNote icon="ti-truck-delivery" title="Deliveries">
            {sheets.list.length ? 'The Planner’s sheets come in as they are. ' : ''}Give each listed vehicle the geofences it should deliver to, choose the window, then press Run report. Its origin, MORL or the Nairobi depot, comes from its route.
          </EmptyNote>
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
                <span className="rpt-sub dlv-sum__part">{periodWords(done.from, done.at)}</span>
                {done.failed > 0 && <span className="rpt-warn dlv-sum__part">{done.failed} tracker{done.failed === 1 ? '' : 's'} could not be read</span>}
                {done.rows.some((r) => backShort(r) > 0) && <span className="rpt-warn dlv-sum__part">{done.rows.filter((r) => backShort(r) > 0).length} back with stops undelivered</span>}
                {done.noMoves && <span className="rpt-warn dlv-sum__part">Movements could not be read, so current locations are missing</span>}
              </>}
              onCsv={done.rows.length ? saveCsv : undefined}
              onPdf={file.busy || !done.rows.length ? undefined : (landscape) => save('pdf', landscape)} pdfWays
              actions={<>
                {editor.button}
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                {!isFg && <label className="dlv-stops-opt" title="The list of each vehicle's pick-up locations, ticked or not, under the table">
                  <input type="checkbox" checked={showStops} onChange={(e) => { const on = e.target.checked; editor.guard(on ? 'Show the pick-up locations' : 'Leave the pick-up locations out', () => setShowStops(on)); }} /> Show pick-up locations
                </label>}
                <JpegButton className="sp4-ghost-btn rpt-log" onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy) || !done.rows.length} title="The PDF report as an image" />
                <PreviewButton className="sp4-ghost-btn rpt-log" onPreview={preview.open} disabled={!done.rows.length} />
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Deliveries report" caption={periodWords(done.from, done.at)} onRetry={preview.retry} onClose={preview.close} />}
            <dl className="dlv-rules" role="note" aria-label="How the report reads each route">
              <dt>Delivered</dt>
              {PASS_COUNTS
                ? <dd>The vehicle came inside the stop’s geofence, or within {PASS_RADIUS_M} m of it, anywhere on the route in the hours picked. No stop needed for now.</dd>
                : <dd>Stood {STOP_MS / 60_000 === 1.5 ? '1½' : STOP_MS / 60_000} min at {STAND_KMH} km/h or under, inside the stop’s geofence or within its pasted distance, anywhere on the route in the hours picked.</dd>}
              <dt>Origin</dt>
              <dd>The first of these the route was at, and a trip ends only back there: {done.storages.join(', ') || 'none found'}.</dd>
              {done.sheets > 0 && <><dt>Planner sheets</dt><dd>Each read over the 48 hours from its printing, as on the Planner, so its rows match the plan there.</dd></>}
              {done.sheets > 0 && <><dt>Orders fulfilled on a sheet</dt><dd>When stops on it are marked for a day in the Planner (“Mark for today”), only those count on that day’s report; on a later day with no marks, the stops left over count.</dd></>}
            </dl>
            <div className="mvr-find dlv-search">
              <div className="sp4-search-wrap mvr-find__box">
                <i className="ti ti-search sp4-search-icon" aria-hidden="true" />
                <input className="sp4-search" type="search" value={unitSearch}
                       placeholder={isFg ? 'Find a unit or customer, e.g. KCW 475E' : 'Find a unit by plate, e.g. KCW 475E'}
                       aria-label={isFg ? 'Find a unit by its plate, or a customer by name' : 'Find a unit by its registration plate'}
                       onChange={(e) => setUnitSearch(e.target.value)} />
                {unitSearch && <button type="button" className="sp4-search-clear" aria-label="Clear the search" onClick={() => setUnitSearch('')}>✕</button>}
              </div>
              {needle && (() => {
                const [n, of, what] = isFg ? [fgVisible.length, fgShown.length, 'lines'] : [rowsVisible.length, done.rows.length, 'units'];
                return (
                  <span className={`mvr-find__note${n ? '' : ' mvr-find__note--none'}`} role="status">
                    {n ? `${n} of ${of} ${what} shown. CSV, PDF and JPEG keep them all.` : isFg ? 'No unit or customer matches that.' : 'No unit matches that plate.'}
                  </span>
                );
              })()}
            </div>
            {isFg ? (
              <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
                <table className="sp4-table rpt-table dlv-table dlv-fg">
                  <thead>
                    <tr><th colSpan={FG_HEADS.length + 1} className="dlv-day">{periodDays(done.from, done.at)} · Finished Goods · {fgShown.filter((l) => l.delivered).length}/{fgShown.length} customers reached
                      {dropped.size > 0 && (
                        <button type="button" className="dlv-fg__undo" onClick={() => editor.guard('Put the dropped lines back', () => setDropped(new Set()))}>
                          Put back {dropped.size} dropped line{dropped.size === 1 ? '' : 's'}
                        </button>
                      )}
                    </th></tr>
                    <tr>{FG_HEADS.map((h) => <th key={h} scope="col">{h}</th>)}<th scope="col"><span className="mvr-sr">Drop</span></th></tr>
                  </thead>
                  <tbody>
                    {fgVisible.map((l) => (
                      <tr key={l.key} className={`sp4-tr dlv-fg__row dlv-fg__row--${fgState(l)}`}
                          style={{ '--dlv-fg-fill': fgFill(l) }}>
                        {fgCells(l).map((v, i) => <td key={i} className={i === 1 ? 'rpt-unit' : undefined}>{v}</td>)}
                        <td className="dlv-fg__x">
                          <button type="button" aria-label={`Drop ${l.customer} (${l.plate}) from the report`} title="Leave this line out of the table, CSV, PDF and JPEG"
                                  onClick={() => editor.guard('Drop a line', () => drop(l.key))}>
                            <i className="ti ti-x" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table dlv-table">
                <thead>
                  <tr><th colSpan={COLUMNS.length + 1} className="dlv-day">{periodDays(done.from, done.at)}</th></tr>
                  <tr>{COLUMNS.map((h) => <th key={h} scope="col">{h}</th>)}<th scope="col"><span className="mvr-sr">Customers</span></th></tr>
                </thead>
                <tbody>
                  {rowsVisible.map((r) => {
                    const cellsOf = rowCells(r);
                    const rowKey = r.key ?? r.plate;
                    const isOpen = open.has(rowKey);
                    return (
                      <Fragment key={rowKey}>
                        <tr className="sp4-tr">
                          {cellsOf.map((v, i) => (
                            <td key={i} className={i === 0 ? 'rpt-unit' : undefined}>
                              {i === 2 ? (
                                <input type="text" inputMode="numeric" className={`mvr-edit dlv-orders${r.typed ? ' mvr-edit--changed' : ''}${typed[r.plate] && !readOrders(typed[r.plate]) ? ' dlv-orders--bad' : ''}`}
                                       value={typed[r.plate] ?? v} readOnly={editor.edited} aria-label={`Orders fulfilled by ${r.plate}, e.g. 8/10`}
                                       title={editor.edited ? 'The report has been edited: change this on the sheet, or undo the edits' : 'Type the orders fulfilled, e.g. 8/10. It is saved for everyone in the organisation for the next report; clear it to use the report’s own count.'}
                                       onChange={(e) => {
                                         const text = e.target.value;
                                         setTyped((t) => ({ ...t, [r.plate]: text }));
                                         // Kept once it reads as a count, or forgotten when cleared
                                         if (!text.trim() || readOrders(text)) keepOrder(r.plate, text);
                                       }} />
                              ) : i === 0 && r.sheet ? (
                                <>{v}<span className="rpt-sub dlv-sheet-line">{sheetWords(r, kmWords)}</span></>
                              ) : v}
                            </td>
                          ))}
                          <td>
                            <button type="button" className="sp4-ghost-btn dlv-more" onClick={() => toggle(rowKey)} aria-expanded={isOpen}>
                              {isOpen ? 'Hide' : 'Customers'}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="dlv-cust">
                            <td colSpan={COLUMNS.length + 1}>
                              {r.sheet && (
                                <div className="dlv-sheet-head">
                                  <span className="rpt-sub">Office marks: {outcomeWords(r) || 'none yet'}</span>
                                  <button type="button" className="sp4-ghost-btn" onClick={() => openInPlanner(r.sheet.planId)}>
                                    <i className="ti ti-calendar-time" aria-hidden="true" /> Open in Planner
                                  </button>
                                </div>
                              )}
                              {!r.customers.length ? <span className="rpt-sub">No customers given.</span> : (
                                <ul>
                                  {r.customers.map((c) => (
                                    <li key={c.name} className={c.at ? 'dlv-cust--done' : c.reachedAt ? 'dlv-cust--near' : 'dlv-cust--no'}>
                                      <i className={`ti ${c.at ? 'ti-circle-check' : c.reachedAt ? 'ti-alert-circle' : 'ti-circle-x'}`} aria-hidden="true" />
                                      {c.sequence != null ? `${c.sequence}. ` : ''}{c.label}
                                      <span className="rpt-sub"> {stopWords(c, spansDays(done.from, done.at))}{c.nearStorage ? ' · at storage' : ''}{c.remarks ? `. ${c.remarks}` : ''}</span>
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
            )}
          </>
        )}
      </div>
    </>
  );
}
