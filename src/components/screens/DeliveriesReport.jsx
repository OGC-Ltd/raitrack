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
 * Movements': the last hours or days and the same hours on each (each day with
 * its own list), a group, Run report; then JPEG, Preview, CSV and PDF over the group picked.
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
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDeliveryDay, getDeliveryDays, saveDeliveryDay, lastDeliveryDayBefore, getDeliveryOrders, saveDeliveryOrder } from '../../api/deliveries';
import { LAST_HOURS, MAX_MOVEMENT_DAYS, windowsProblem } from '../../lib/movementReport';
import {
  COLUMNS, stamp, LOOKBACK_DAYS, readOrders, MAX_LOOKBACK_DAYS, STOP_MS, STAND_KMH, PASS_COUNTS, PASS_RADIUS_M, middleOf, storageAt, tripOf, dayRuns, daysFrom, findStorages, customersIn, deliveryRow, rowCells, periodDays, spansDays, stopWords, csvTable, deliveriesPdfBody, backShort, matchGeofences, sheetStops, pinCode, fencedPinNames,
} from '../../lib/deliveriesReport';
import { loadPlan, forgetLegacyPlan, forgetLegacyOrders, addVehicle, removeVehicle, setCustomers, setPins, setVehicleGroup, emptyPlan, loadOrders, mergePins, PIN_RADIUS_MIN_M, PIN_RADIUS_MAX_M } from '../../lib/deliveryPlan';
import { loadPings } from '../../api/fleetReports';
import { loadMovementReport, makeReportPdf } from '../../api/reports';
import { TEMPLATES, loadTemplate, saveTemplate, fgLines, fgCells, fgCsv, finishedGoodsDoc, FG_HEADS, fgState, fgFill, fgColour, FG_COLOURS, FG_FILL, NOT_GEOFENCED } from '../../lib/finishedGoodsReport';
import { listPlans, getPlan, fileAsBase64, previewSheet, listCustomers } from '../../api/planner';
import { sheetDaysFor, sheetsForReport, sheetOnDays, sheetListed, sheetRunDays, trackersFor, readSpan, actualFor, sheetRow, sheetWords, outcomeWords, plateKey, sheetDays, planForDay, planStopsForList } from '../../lib/plannerReport';
import { kmWords, isKeyed } from '../../lib/plannerActual';
import { openPlanNext } from '../../lib/planOverlay';
import { usePermissions } from '../../hooks/usePermissions';
import { useAppActions } from '../../context/AppContext';
import { loadZones, reloadEstateZones } from '../../hooks/useEstateZones';
import { createFence } from '../../api/geofences';
import { pinFencePlan, drawPinFences, readNamedPaste, FENCE_RADIUS_M } from '../../lib/pinFences';
import { deliveriesDoc } from '../../lib/reportDocs';
import { customerVisits, visitCustomers, visitLength, nameLike, closestPass, customersNear, distanceWords, coordWords, metresApart, NEAR_TARGET_M } from '../../lib/customerVisits';
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
// When the day's list was last saved: " 09:41" today, " 12 Nov, 09:41" before; '' when never
const SAVED_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
const SAVED_TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' });
const savedAt = (iso) => {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const day = SAVED_DAY.format(t);
  return ` ${day === SAVED_DAY.format(Date.now()) ? '' : `${day}, `}${SAVED_TIME.format(t)}`;
};
// A day as the date picker writes it, "13 Nov", never the ISO key
const dayWords = (key) => pickedText(key, key, null).replace(/ /g, ' ');
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

/** "3 new geofences drawn; 1 point kept: Forbidden": what fencing the points did, or null when there were none. */
function fencedWords(f) {
  if (!f) return null;
  const parts = [];
  if (f.drawn) parts.push(`${f.drawn} new geofence${f.drawn === 1 ? '' : 's'} drawn`);
  if (f.kept) parts.push(`${f.kept} point${f.kept === 1 ? '' : 's'} kept without a geofence${f.error ? `: ${f.error}` : ''}`);
  if (f.unnamed) parts.push(`${f.unnamed} point${f.unnamed === 1 ? '' : 's'} with no name, not fenced: name ${f.unnamed === 1 ? 'it' : 'them'} under Paste stops`);
  return parts.length ? parts.join('; ') : null;
}

/** A point listed with no name: a box for the customer's name, and its geofence drawn once named. */
function NamePin({ pin, onName }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onName(pin, name.trim()); } finally { setBusy(false); }
  };
  return (
    <span className="dlv-paste__name">
      <input type="text" value={name} maxLength={120} placeholder="Customer name" disabled={busy}
             aria-label={`Customer name for the point ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`}
             onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
      <button type="button" className="sp4-ghost-btn" disabled={!name.trim() || busy} onClick={go}
              title="Name the point and give it a geofence">
        <i className={`ti ${busy ? 'ti-loader-2' : 'ti-shape'}`} aria-hidden="true" /> {busy ? 'Drawing…' : 'Fence'}
      </button>
    </span>
  );
}

/**
 * Stops added to one vehicle, geofence names or coordinates: the box, what it
 * could not read, and the points held. Points go to `onAdd`, which gives each
 * a geofence (operator, 13 Nov 2026) and answers what it did. Coordinates come
 * with the customer's name on the same line (operator, 13 Nov 2026: "pasting
 * coordinates but also the name should be provided"): a line without one stays
 * in the box until it has one.
 */
function PinPaste({ orgId, vehicle, customers, onAdd, onRemovePins }) {
  const [text, setText] = useState('');
  const [radius, setRadius] = useState(FENCE_RADIUS_M);
  const [told, setTold] = useState(null);                 // { added, bad, fenced } or { sheet: words, warn }
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
      const fenced = got.pins.length || got.names.length ? await onAdd(got.pins, got.names) : null;
      const other = got.plate && plateKey(got.plate) !== plateKey(vehicle.plate);
      const words = [`${got.pins.length + got.names.length} added from the sheet${got.plate ? ` of ${got.plate}` : ''}`];
      if (fencedWords(fenced)) words.push(fencedWords(fenced));
      if (got.unplaced.length) words.push(`${got.unplaced.length} with no point or geofence: ${got.unplaced.slice(0, 3).join(', ')}${got.unplaced.length > 3 ? ', …' : ''}`);
      if (other) words.push(`the sheet is for ${got.plate}, not ${vehicle.plate}`);
      setTold({ sheet: words.join('; '), warn: Boolean(other || got.unplaced.length || fenced?.kept || !(got.pins.length + got.names.length)) });
    } catch (err) {
      setTold({ sheet: `The sheet could not be read: ${err?.message ?? err}`, warn: true });
    } finally {
      setReading(false);
    }
  };
  const add = async () => {
    if (reading) return;
    const { pins: read, bad, nameless } = readNamedPaste(text, radius);
    const { names, rest } = matchGeofences(bad, customers);
    setText([...nameless, ...rest].join('\n'));          // what did not read, or has no name, stays to be put right
    setReading(true);
    try {
      const fenced = read.length || names.length ? await onAdd(read, names) : null;
      setTold({ added: read.length + names.length, bad: rest.length, nameless: nameless.length, fenced });
    } finally {
      setReading(false);
    }
  };
  return (
    <div className="dlv-paste">
      <textarea className="dlv-paste__box" rows={4} value={text} spellCheck={false}
                aria-label={`Delivery stops for ${vehicle.plate}`}
                placeholder={'One stop a line, a geofence’s name, or the customer’s name and its coordinates:\nJOJAC INVESTMENTS\nNaivas Nakuru, -0.28802, 36.04494'}
                onChange={(e) => { setText(e.target.value); setTold(null); }} />
      <div className="dlv-paste__foot">
        <label className="dlv-paste__radius">
          Within
          <input type="number" min={PIN_RADIUS_MIN_M} max={PIN_RADIUS_MAX_M} step={10} value={radius}
                 onChange={(e) => setRadius(e.target.value)} /> m
        </label>
        <button type="button" className="sp4-ghost-btn" disabled={!text.trim() || reading} onClick={add}>
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
          <span className={told.bad || told.nameless || told.fenced?.kept ? 'rpt-warn' : 'rpt-sub'} role="status">
            {told.added} added{fencedWords(told.fenced) ? `; ${fencedWords(told.fenced)}` : ''}{told.nameless ? `; ${told.nameless} line${told.nameless === 1 ? ' has' : 's have'} coordinates but no name: write the customer’s name before the coordinates, then Add stops` : ''}{told.bad ? `; ${told.bad} line${told.bad === 1 ? '' : 's'} left in the box matched no geofence and had no coordinates` : ''}
          </span>
        )}
        {pins.length > 0 && (
          <button type="button" className="sp4-ghost-btn dlv-paste__clear" onClick={() => onRemovePins(pins)}>Remove all {pins.length}</button>
        )}
      </div>
      {pins.length > 0 && (
        <ul className="dlv-paste__pins">
          {pins.map((p) => (
            <li key={`${p.lat},${p.lng}`} className="dlv-paste__pin" title={`${p.lat}, ${p.lng}, within ${p.radiusM} m`}>
              <span>{p.name || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}</span>
              {!p.name?.trim() && <NamePin pin={p} onName={(pin, name) => onAdd([{ ...pin, name }], [])} />}
              <span className="rpt-sub">{p.radiusM} m</span>
              <button type="button" aria-label={`Remove ${p.name || 'this point'}`} onClick={() => onRemovePins([p])}>
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How far past a window's end the report reads, to see its trips back at the yard (operator, 12 Nov 2026). */
const RETURN_DAYS = 2;

/** The report's own template (operator, 12 Nov 2026: Van Sales and Finished Goods kept apart; 13 Nov: one
 *  Deliveries tab, the two picked inside it): it opens on that template's group, with no template to pick. */
const TAB_GROUP = { vanSales: 'Van Sales', finishedGoods: 'Finished Goods' };
/** Each report's own list on the day (operator, 12 Nov 2026): a vehicle without `list` is FG's, as every list kept before. */
const TAB_LIST = { vanSales: 'vs', finishedGoods: 'fg' };
const listOf = (v) => (v?.list === 'vs' ? 'vs' : 'fg');
const tagList = (v, list) => { const { list: _was, ...rest } = v; return list === 'vs' ? { ...rest, list: 'vs' } : rest; }; // eslint-disable-line no-unused-vars

/** The two Deliveries reports, in the order the switch offers them. */
const REPORT_KINDS = [
  { value: 'vanSales', label: 'Van Sales' },
  { value: 'finishedGoods', label: 'Finished Goods' },
];

/**
 * The Deliveries tab (operator, 13 Nov 2026: "instead of having tabs for delivery fg and delivery vs we
 * keep our deliveries tab and within the deliveries we have a breadcrumb that gives the two options"):
 * Deliveries › Van Sales | Finished Goods. Both reports stay mounted, so each keeps its list, run and
 * edits while the other is shown; the one picked last is kept in this browser.
 */
export function DeliveriesReports(props) {
  const { orgCode } = props;
  const [kind, setKind] = useState(() => loadTemplate(orgCode));
  useEffect(() => { setKind(loadTemplate(orgCode)); }, [orgCode]);
  const pick = (k) => { setKind(k); saveTemplate(orgCode, k); };
  const crumbs = (
    <nav className="dlv-crumbs" aria-label="Deliveries reports">
      <span className="dlv-crumbs__root">Deliveries</span>
      <i className="ti ti-chevron-right dlv-crumbs__sep" aria-hidden="true" />
      <span className="sp4-filter-group dlv-crumbs__kinds" role="group" aria-label="Report">
        {REPORT_KINDS.map((k) => (
          <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => pick(k.value)}
                  className={`sp4-filter-chip${kind === k.value ? ' sp4-filter-chip--on' : ''}`}>
            {k.label}
          </button>
        ))}
      </span>
    </nav>
  );
  return REPORT_KINDS.map((k) => (
    <div key={k.value} className="mvt-panel" hidden={kind !== k.value}>
      <DeliveriesReport {...props} template={k.value} crumbs={crumbs} />
    </div>
  ));
}

/** "34 km/h" at the closest reading; a reading without a speed says so. */
const speedWords = (kmh) => (Number.isFinite(kmh) ? `${Math.round(kmh)} km/h` : 'speed not read');

/** A fence's middle as coordinates, opening the place on Google Maps in a new tab. */
function CoordLink({ at }) {
  return (
    <a className="dlv-coord" href={`https://www.google.com/maps?q=${at.lat.toFixed(6)},${at.lng.toFixed(6)}`} target="_blank" rel="noopener noreferrer"
       title="Open on Google Maps" onClick={(e) => e.stopPropagation()}>
      <i className="ti ti-map-pin" aria-hidden="true" />{coordWords(at)}
    </a>
  );
}

export default function DeliveriesReport({ orgId, vehicles, orgCode, companyName, template: fixedTemplate = null, crumbs = null }) {
  const now = Date.now();
  const today = fleetDay(now);
  // The window, as Movements': the last hours, or days and hours. The list of
  // vehicles is a day's: a range runs each day's own list over that day's hours
  // (operator, 12 Nov 2026: "11/11/2026 to 12/11/2026 should show both days in full")
  const [sel, setSel] = useState({ mode: 'last', hours: LAST_HOURS[0] });
  // Today, midnight to midnight, until the operator picks other hours (operator, 13 Nov 2026)
  const [draft, setDraft] = useState({ fromDay: today, toDay: today, start: 0, end: 24 });
  const [daysOpen, setDaysOpen] = useState(true);
  const rangeDays = useMemo(() => (daysOpen ? daysFrom(draft.fromDay, draft.toDay) : [today]), [daysOpen, draft.fromDay, draft.toDay, today]);
  // The day whose list is open for editing: one of the range's, the first until another is picked
  const [pickDay, setPickDay] = useState(null);
  const day = daysOpen ? (rangeDays.includes(pickDay) ? pickDay : rangeDays[rangeDays.length - 1]) : today;
  const [group, setGroup] = useState(() => TAB_GROUP[fixedTemplate] ?? null);   // one group of the fleet list, or all
  // Van Sales (the report as it was) or Finished Goods (operator, 11 Nov 2026), kept in this browser
  const [pickedTemplate, setTemplate] = useState(() => loadTemplate(orgCode));
  useEffect(() => { setTemplate(loadTemplate(orgCode)); }, [orgCode]);
  const template = fixedTemplate ?? pickedTemplate;
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
        const stored = await saveDeliveryDay(orgId, d, kept.vehicles);
        forgetLegacyPlan(orgCode, d);
        return { vehicles: kept.vehicles, updatedAt: stored?.updatedAt ?? null };
      }
      if (kept.vehicles.length) forgetLegacyPlan(orgCode, d);
      // `updatedAt`: when the list was last saved, for the header's "Saved 09:41"
      return { vehicles: got.vehicles, updatedAt: got.updatedAt ?? null };
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
  const dayList = useQuery(dayQuery(day));
  // Each tab keeps its own list (operator, 12 Nov 2026: "in this VS, the page should be blank until we
  // feed data for VS, only the FG to maintain the current data"). The day's list on the server holds
  // both: a vehicle added on Deliveries VS carries list 'vs'; one without (every list kept before) is FG's
  const tabList = TAB_LIST[fixedTemplate] ?? null;
  const mine = (v) => !tabList || listOf(v) === tabList;
  const fullPlan = dayList.data ?? emptyPlan();
  const plan = useMemo(() => (tabList ? { ...fullPlan, vehicles: fullPlan.vehicles.filter(mine) } : fullPlan), [fullPlan, tabList]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every day of a range, for its count and so a range with vehicles on a later day only can run
  const rangeLists = useQueries({ queries: rangeDays.length > 1 ? rangeDays.map((d) => dayQuery(d)) : [] });
  const listedOn = (i) => (rangeLists[i]?.data ? rangeLists[i].data.vehicles.filter(mine).length : null);
  const anyListed = rangeDays.length > 1 ? rangeLists.some((q) => q.data?.vehicles.some(mine)) : plan.vehicles.length > 0;
  // Every day of the range in one list, each vehicle with its day (operator, 12 Nov 2026: "I want to see
  // units for both 11th and 12th in one list if I have picked the dates, not separately")
  const multiDay = rangeDays.length > 1;
  // The vehicle list open or folded away, remembered in this browser (operator, 13 Nov 2026)
  const [listOpen, setListOpenState] = useState(() => { try { return localStorage.getItem('dlv.listOpen') !== '0'; } catch { return true; } });
  const setListOpen = (on) => { setListOpenState(on); try { localStorage.setItem('dlv.listOpen', on ? '1' : '0'); } catch { /* storage blocked: open for this visit only */ } };
  const listRows = multiDay
    ? rangeDays.flatMap((d, i) => (rangeLists[i]?.data?.vehicles ?? []).filter(mine).map((v) => ({ ...v, day: d })))
    : plan.vehicles.map((v) => ({ ...v, day }));
  // A day's list for this tab, as it is now
  const planOn = (d) => {
    const full = qc.getQueryData(['deliveries', 'day', orgId, d]) ?? (d === day ? fullPlan : emptyPlan());
    return tabList ? { ...full, vehicles: full.vehicles.filter(mine) } : full;
  };
  // Saves go one after another, each the whole list, so the last change is the one kept
  const saving = useRef(Promise.resolve());
  // `failedDay`: a day whose list on screen is not yet on the server. The list is kept as the operator
  // left it (never snapped back to the server's copy) until Try again, or the next change, saves it
  const [saveState, setSaveState] = useState({ busy: 0, error: null, failedDay: null });
  // `next`: this tab's list for the day; the other tab's vehicles are kept as they are
  const changeOn = (d, next) => {
    const key = ['deliveries', 'day', orgId, d];
    if (!tabList) { saveFullOn(d, next); return; }
    const others = (qc.getQueryData(key) ?? (d === day ? fullPlan : emptyPlan())).vehicles.filter((v) => !mine(v));
    saveFullOn(d, { ...next, vehicles: [...others, ...next.vehicles.map((v) => tagList(v, tabList))] });
  };
  const change = (next, forDay = day) => changeOn(forDay, next);
  const saveFull = (next) => saveFullOn(day, next);
  const saveFullOn = (forDay, next) => {
    const key = ['deliveries', 'day', orgId, forDay];
    qc.setQueryData(key, next);
    setSaveState((s) => ({ busy: s.busy + 1, error: null, failedDay: null }));
    saving.current = saving.current.then(() => saveDeliveryDay(orgId, forDay, next.vehicles))
      .then((stored) => {
        // The list's saved time, from the server: the header's "Saved 09:41" follows each save
        const at = stored?.updatedAt ?? new Date().toISOString();
        qc.setQueryData(key, (cur) => (cur ? { ...cur, updatedAt: at } : cur));
        setSaveState((s) => ({ ...s, busy: s.busy - 1 }));
        // The server keeps each listed vehicle as its Planner plan for the day: the Planner reads it afresh
        qc.invalidateQueries({ queryKey: ['planner', 'plans', orgId] });
      })
      .catch((err) => setSaveState((s) => ({ busy: s.busy - 1, error: err?.message ?? String(err), failedDay: forDay })));
  };
  const retrySave = () => {
    const d = saveState.failedDay;
    const list = d && qc.getQueryData(['deliveries', 'day', orgId, d]);
    if (list) saveFullOn(d, list);
  };
  const earlierQ = useQuery({
    queryKey: ['deliveries', 'before', orgId, day],
    queryFn: () => lastDeliveryDayBefore(orgId, day),
    enabled: Boolean(orgId) && dayList.isSuccess && !plan.vehicles.length,
    staleTime: 60_000,
  });
  const earlierMine = (earlierQ.data?.vehicles ?? []).filter(mine);
  const earlier = !plan.vehicles.length && earlierMine.length ? { day: earlierQ.data.day, plan: { vehicles: earlierMine } } : null;

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
  const [sheetsRead, setSheets] = useState({ status: 'idle', list: [] });
  // On a tab, the Planner's sheets of its own units: Van Sales units' on VS, the rest on FG
  const sheetTab = (g) => !tabList || (g === TAB_GROUP.vanSales ? 'vs' : 'fg') === tabList;
  const sheets = useMemo(() => (tabList ? { ...sheetsRead, list: sheetsRead.list.filter((p) => sheetTab(units.find((u) => plateKey(u.plate) === plateKey(p.plate))?.group ?? null)) } : sheetsRead), [sheetsRead, tabList, units]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetSpanKey = daysOpen ? `days:${draft.fromDay}:${draft.toDay}` : `last:${sel.mode === 'last' ? sel.hours : ''}`;
  useEffect(() => {
    if (!orgId || !canSheets) { setSheets({ status: 'idle', list: [] }); return undefined; }
    let live = true;
    const t = Date.now();
    const from = daysOpen ? dayStart(draft.fromDay) : t - (sel.hours ?? 24) * 3600_000;
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
    const there = tabList && fullPlan.vehicles.find((v) => v.key === u.key && !mine(v));
    if (there) {
      const name = tabList === 'vs' ? 'Finished Goods' : 'Van Sales';
      setAssign({ plate: u.plate, icon: 'ti-arrows-exchange', words: `${u.plate} is on the ${name} list for ${dayWords(day)}. Move it to this list?`, yes: 'Move it here',
        go: () => { saveFull({ ...fullPlan, vehicles: fullPlan.vehicles.map((v) => (v.key === u.key ? tagList(v, tabList) : v)) }); setFind(''); } });
      return;
    }
    const put = () => {
      const next = addVehicle(plan, u);
      change(group && group !== u.group ? setVehicleGroup(next, u.key, group) : next);
      setJustAdded(`${day}|${u.key}`); setFind('');
      takePlannerStops(u.key, u.plate);                   // its Planner plan's geofences, ticked
    };
    if (group && u.group && group !== u.group && !plan.vehicles.some((v) => v.key === u.key)) {
      setAssign({ plate: u.plate, icon: 'ti-users-group', words: `${u.plate} belongs to ${u.group}. Assign it to ${group} anyway?`, yes: `Assign to ${group}`, go: put });
    } else put();
  };
  const moveTo = (v, g) => {
    const own = ownGroup(v.key);
    const go = () => changeOn(v.day, setVehicleGroup(planOn(v.day), v.key, g === own ? null : g));
    if (own && g !== own) setAssign({ plate: v.plate, icon: 'ti-users-group', words: `${v.plate} belongs to ${own}. Assign it to ${g} anyway?`, yes: `Assign to ${g}`, go });
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

  // Pasted points fenced in the Planner take their fence's name (operator, 12 Nov 2026)
  const fencedPinsQuery = {
    queryKey: ['planner', 'customers', 'fenced-pins', orgId],
    queryFn: () => listCustomers(orgId, { q: 'PIN:', fenced: true }),
    enabled: Boolean(orgId && canSheets),
    staleTime: 60_000,
  };
  const fencedPins = useQuery(fencedPinsQuery);
  const pinNames = useMemo(() => fencedPinNames(fencedPins.data, zones.fc), [fencedPins.data, zones.fc]);
  const pinLabel = (pin) => pinNames.get(pinCode(pin)) || pin.name || `${pin.lat}, ${pin.lng}`;

  // Every stop on the list a geofence (operator, 13 Nov 2026: "the selected vehicles to run a report on
  // have the geofences configured"): a point added from an Excel sheet or pasted takes the fence it
  // already has, else a circle is drawn at it named after the customer (lib/pinFences). The list then
  // carries the fence's name, and the Planner plan made from it is fenced too. A point whose fence
  // cannot be drawn (no geofence:create, or the server said no) stays a point, judged as one.
  const canFence = can('geofence:create');
  const [fencing, setFencing] = useState(() => new Set()); // vehicles whose points are being fenced
  const fenceStops = async (key, pins, names = [], forDay = day) => {
    const { use, draw, unnamed } = pinFencePlan(pins, customers, pinNames);
    setFencing((s) => new Set(s).add(key));
    let drawn = { names: [], kept: draw.map((d) => d.pin), error: draw.length ? 'you have no permission to draw geofences' : null };
    try {
      if (canFence && draw.length) {
        drawn = await drawPinFences(draw, (body) => createFence(orgId, body));
        if (drawn.names.length) {
          // The new fences must be in the stops picker and the report's geofences before they are listed
          const fc = await reloadEstateZones(orgId).catch(() => null);
          if (fc) {
            const storages = findStorages(fc);
            setZones({ status: 'done', fc, storages, customers: customersIn(fc, storages) });
          }
        }
      }
    } finally {
      setFencing((s) => { const n = new Set(s); n.delete(key); return n; });
    }
    const latest = planOn(forDay);                       // this tab's list: change() keeps the other's
    const v = latest.vehicles.find((x) => x.key === key);
    if (v) {
      const gone = new Set(pins.map(pinCode));
      // Points not fenced stay points: those that could not be drawn, and those with no name yet
      const left = mergePins((v.pins ?? []).filter((p) => !gone.has(pinCode(p))), [...drawn.kept, ...unnamed]);
      change(setCustomers(setPins(latest, key, left), key, [...v.customers, ...names, ...use, ...drawn.names]), forDay);
    }
    return { reused: use.length, drawn: drawn.names.length, kept: drawn.kept.length, unnamed: unnamed.length, error: drawn.error };
  };
  // The Planner's plan for a vehicle on the list (operator, 13 Nov 2026: KDM 138L's itinerary "with the
  // routes configured" should tick its geofences on Deliveries): its stops' geofences ticked in route
  // order when the vehicle is added, or on From the Planner; a stop whose fence is gone is fenced as an
  // added point is. `fromPlanner`: what it did, by vehicle
  const [fromPlanner, setFromPlanner] = useState({});
  const tell = (key, words, warn = false) => setFromPlanner((m) => ({ ...m, [key]: words ? { words, warn } : null }));
  const takePlannerStops = async (key, plate, forDay = day) => {
    if (!orgId || !canSheets) return;
    tell(key, 'Looking for its plan in the Planner…');
    try {
      const d = sheetDays(dayStart(forDay), dayStart(forDay) + DAY - 1, fleetDay);
      const p = planForDay(await listPlans(orgId, d.from, d.to), plate, forDay, dayStart);
      if (!p) { tell(key, `No plan for ${plate} on ${dayWords(forDay)} in the Planner`); return; }
      const [full, fc] = await Promise.all([getPlan(orgId, p.id), zones.fc ? Promise.resolve(zones.fc) : loadZones(orgId)]);
      const pickable = new Set(customersIn(fc, findStorages(fc)).map((c) => c.name));
      const { names, pins } = planStopsForList(full, fc, pickable, FENCE_RADIUS_M);
      const what = full.source === 'itinerary' ? 'Wialon itinerary' : 'delivery sheet';
      if (!names.length && !pins.length) { tell(key, `The Planner’s ${what} for ${plate} has no stops with a place`, true); return; }
      const r = await fenceStops(key, pins, names, forDay);
      const ticked = names.length + pins.length - r.kept - r.unnamed;
      const words = [`${ticked} stop${ticked === 1 ? '' : 's'} ticked from the Planner’s ${what} of ${dayWords(full.planDate)}`];
      if (fencedWords(r)) words.push(fencedWords(r));
      tell(key, words.join('; '), Boolean(r.kept || r.unnamed));
    } catch (err) {
      tell(key, `The Planner’s stops could not be read: ${err?.message ?? err}`, true);
    }
  };
  const removePins = (key, pins, forDay = day) => {
    const list = planOn(forDay);
    const v = list.vehicles.find((x) => x.key === key);
    if (!v) return;
    const gone = new Set(pins.map(pinCode));
    change(setPins(list, key, (v.pins ?? []).filter((p) => !gone.has(pinCode(p)))), forDay);
  };

  const [run, setRun] = useState({ status: 'idle' });
  const [file, setFile] = useState({ busy: false, error: null });
  const [open, setOpen] = useState(() => new Set());
  const [pasting, setPasting] = useState(() => new Set()); // vehicles with the coordinates box open
  const [showStops, setShowStops] = useState(false);      // the pick-up locations on the PDF and JPEG; off until ticked (operator, 13 Nov 2026)
  const runId = useRef(0);

  const daysProblem = windowsProblem({ mode: 'days', ...draft });
  const problem = !orgId ? 'Waiting for the organisation to load'
    : daysOpen && daysProblem ? daysProblem
      : !anyListed && !sheets.list.length ? (sheets.status === 'loading' ? 'Looking for the Planner’s sheets' : 'Add the vehicles shared today, or upload their sheets in the Planner')
        : null;
  // An empty list keeps Run report off, its reason on the button's hover only: not written beside it
  // (operator, 13 Nov 2026: "remove the advisory text")
  const problemShown = !anyListed && !sheets.list.length && sheets.status !== 'loading' && !(daysOpen && daysProblem) ? null : problem;

  // Each day's list for a run, as the server has it now: one read for a range (GET days?from=&to=),
  // each day's own read for one day, or when the server cannot read a range yet
  const listsFor = async (days) => {
    await saving.current.catch(() => undefined);          // a save under way reaches the server first
    const own = (d) => (d === saveState.failedDay && qc.getQueryData(['deliveries', 'day', orgId, d])) // not saved: as on screen
      || qc.fetchQuery(dayQuery(d));
    let got;
    if (days.length > 1) {
      try {
        const all = await getDeliveryDays(orgId, days[0], days[days.length - 1]);
        got = await Promise.all(days.map((d) => {
          const listed = all.find((x) => x.day === d)?.vehicles ?? [];
          // A list this browser kept before the server, or has not saved, goes through the day's own read
          return d === saveState.failedDay || (!listed.length && loadPlan(orgCode, d).vehicles.length) ? own(d) : { vehicles: listed };
        }));
      } catch {
        got = await Promise.all(days.map(own));
      }
    } else got = await Promise.all(days.map(own));
    return Object.fromEntries(days.map((d, i) => [d, (got[i]?.vehicles ?? []).filter(mine)]));
  };

  const execute = async (next) => {
    // Each day's own list: the page may hold another day's, and a range holds several
    const days = next.mode === 'days' ? daysFrom(next.fromDay, next.toDay) : [today];
    const lists = orgId ? await listsFor(days).catch(() => ({ [day]: plan.vehicles })) : { [day]: plan.vehicles };
    const runs = dayRuns(next, lists, { today });
    setSel(next);
    if (!orgId || !runs.length) return;
    const windowFrom = runs[0].from;
    const { to } = runs[runs.length - 1];
    // Rows say their day only when there is more than one
    const multi = runs.length > 1;
    const id = ++runId.current;
    const live = () => id === runId.current;
    try {
      qc.fetchQuery(ordersQuery).then((o) => setTyped((t) => ({ ...o, ...t }))).catch(() => undefined);
      setRun({ status: 'loading', words: 'Finding MORL, the Nairobi depot and the customers', done: 0, total: 0 });
      // Each step says what it was doing when it fails; Movements (where each
      // vehicle is now) is help, not a need: without it the report still runs
      const step = (words, p) => p.catch((err) => { throw new Error(`${words}: ${err?.message ?? err}`); });
      const [fc, moves, sheetList, fenced] = await Promise.all([
        zones.fc ? Promise.resolve(zones.fc) : step('The geofences could not be read', loadZones(orgId)),
        loadMovementReport({ orgId, from: to - 3600_000, to }).catch(() => null),
        canSheets ? step('The Planner’s sheets could not be read', findSheets(windowFrom, to)) : Promise.resolve([]),
        // Fresh, as a fence may have been drawn since the page opened; without them the points keep their own names
        canSheets ? qc.fetchQuery({ ...fencedPinsQuery, staleTime: 0 }).catch(() => []) : Promise.resolve([]),
      ]);
      const runPinNames = fencedPinNames(fenced, fc);
      if (!live()) return;
      if (!runs.some((r) => r.vehicles.length) && !sheetList.length) {
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
      // `listed`: its unit is on this report's list for the sheet's own day, never another day of the range
      const sheetRows = sheetRowsAll.filter((r) => sheetOnDays(r, marksOf(r.remake.plan), reportDays, fleetDay))
        .map((r) => ({ ...r, listed: sheetListed(r, r.remake.plan, marksOf(r.remake.plan), runs, fleetDay) }));
      // A vehicle on a kept sheet is the sheet's row: not checked again from the list (on a range, that day's list).
      // Only a sheet this report shows, and on a range only on the sheet's own day: KDM 138L's 13 Nov Van Sales
      // itinerary neither replaces nor hides its 11 Nov Finished Goods line (operator, 13 Nov 2026)
      const planned = runs.flatMap((run) => {
        const onSheets = new Set(sheetRows.filter((r) => (r.listed || sheetTab(r.group))
          && (!multi || sheetRunDays(r, r.remake.plan, marksOf(r.remake.plan), fleetDay).has(run.day))).map((r) => plateKey(r.plate)));
        return run.vehicles.filter((v) => !onSheets.has(plateKey(v.plate)))
          .map((v) => ({ ...v, vehicleIds: unitOf(v.key)?.vehicles.map((x) => x.vehicleId) ?? v.vehicleIds, run }));
      });
      const idsOf = (list) => [...new Set(list.flatMap((v) => v.vehicleIds))];
      let start = Math.min(to - LOOKBACK_DAYS * DAY, windowFrom - DAY);
      // On past the window, up to now and at most RETURN_DAYS: when each trip got back to the yard
      const upTo = Math.min(Date.now(), to + RETURN_DAYS * DAY);
      if (planned.length) await read(idsOf(planned), start, upTo, 'Reading each vehicle’s positions');
      if (!live()) return;
      for (let back = LOOKBACK_DAYS + 1; planned.length && back <= MAX_LOOKBACK_DAYS; back++) {
        const need = planned.filter((v) => tripOf(held.get(best(v)) ?? [], storages, { to: v.run.to }).need);
        if (!need.length) break;
        const plates = [...new Set(need.map((v) => v.plate))];
        await read(idsOf(need), start - DAY, start - 1, `Finding when ${plates.length === 1 ? plates[0] : `${plates.length} vehicles`} left MORL or the depot, ${back} days back`);
        if (!live()) return;
        start -= DAY;
      }
      const routesOf = new Map();
      const rows = planned.map((v) => {
        // The tracker Movements reads for it, else the one that reported most
        const mv = v.vehicleIds.map((id) => moveRow.get(id)).find(Boolean) ?? null;
        const id = mv?.vehicleId ?? best(v);
        const { run } = v;
        const row = deliveryRow(v, held.get(id) ?? [], storages, byName, {
          from: run.from, to: run.to, upTo: Math.min(Date.now(), run.to + RETURN_DAYS * DAY), windows: [{ from: run.from, to: run.to }], pinNames: runPinNames, routes: v.vehicleIds.map((x) => held.get(x) ?? []), place: mv?.location ?? null, atMorl: mv?.state === 'at', unread: v.vehicleIds.every((x) => failed.has(x)),
          lastFix: mv?.lat != null && mv?.lastAt != null ? { t: mv.lastAt, lat: mv.lat, lng: mv.lng } : null,
        });
        const out = { ...row, group: groupOfV(v), ownGroup: ownGroup(v.key), listDay: run.day, ...(multi ? { day: run.day, key: `${run.day}|${v.key}` } : {}) };
        // Its readings, for the customers it passed (picked on the Finished Goods sheet)
        routesOf.set(out.key ?? out.plate, { routes: v.vehicleIds.map((x) => held.get(x) ?? []), from: run.from, to: Math.min(Date.now(), run.to + RETURN_DAYS * DAY) });
        return out;
      });
      rows.unshift(...sheetRows);
      setRun({ status: 'done', rows, routesOf, passable: visitCustomers(all), from: windowFrom, at: to, storages: storages.map((s) => `${s.label} (${s.name})`), failed: failed.size, noMoves: !moves, sheets: sheetRows.length });
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
      group: r.group, ownGroup: r.ownGroup, remake: r.remake, listed: r.listed };
  }) } : null), [ranRaw, planTick, qc, orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The rows as the PDF, JPEG and CSV print them: a typed count over the report's
  // On a tab every vehicle on its list is reported, whatever its group (operator, 12 Nov 2026: "all
  // should appear in the report"); its Planner sheets by their units' group
  // A sheet whose unit is on this tab's list stands in for it here, so the unit is never lost
  const keepRow = (r) => (r.remake ? (r.listed || sheetTab(r.group)) : true)
    && (group == null || r.group === group || (tabList != null && group === TAB_GROUP[fixedTemplate]));
  const done = useMemo(() => (ran ? { ...ran, rows: ran.rows.filter(keepRow).map((r) => {
    const t = readOrders(typed[r.plate]);
    return t ? { ...r, fulfilled: t.fulfilled, planned: t.planned, typed: true } : r;
  }) } : null), [ran, typed, group, tabList]); // eslint-disable-line react-hooks/exhaustive-deps
  // How many on the day's list in each group
  const groupNames = useMemo(() => groupsFor('MENENGAI').map((g) => g.name), []);
  const sheetGroup = (p) => units.find((u) => plateKey(u.plate) === plateKey(p.plate))?.group ?? null;
  const groupCount = (name) => listRows.filter((v) => !sheetPlates.has(plateKey(v.plate)) && groupOfV(v) === name).length
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
  // A customer geofence the unit passed, picked for a line (operator, 12 Nov 2026: "the rows become clickable
  // ... show the customer list the vehicle passed by, they can choose the one that looks the same")
  const [picks, setPicks] = useState(() => new Map());
  const [openLine, setOpenLine] = useState(null);
  // A line's colour set by hand, from the sheet's three (operator, 13 Nov 2026); `painting`: the line whose swatches are open
  const [colours, setColours] = useState(() => new Map());
  const [painting, setPainting] = useState(null);
  useEffect(() => { setDropped(new Set()); setPicks(new Map()); setColours(new Map()); setOpenLine(null); setPainting(null); }, [ranRaw]);
  const paint = (key, state) => setColours((m) => { const n = new Map(m); if (state) n.set(key, state); else n.delete(key); return n; });
  useEffect(() => {
    if (!painting) return undefined;
    const away = (e) => { if (!e.target.closest?.('.dlv-fg__x')) setPainting(null); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [painting]);
  const drop = (key) => setDropped((d) => new Set(d).add(key));
  const pickFor = (key, pick) => setPicks((m) => { const n = new Map(m); if (pick) n.set(key, pick); else n.delete(key); return n; });
  const editSource = useMemo(() => (done ? { done, showStops, template, dropped, picks, colours } : null), [done, showStops, template, dropped, picks, colours]);
  const fleetName = companyName ?? orgCode ?? 'Menengai';
  const fgDoc = () => finishedGoodsDoc(done.rows, { from: done.from, at: done.at, fleet: fleetName, group, orgCode, dropped, picks, colours });
  const editor = useReportEditor({ orgId, source: editSource,
    build: () => (isFg ? fgDoc() : deliveriesDoc(done.rows, { from: done.from, at: done.at, fleet: fleetName, group, stops: showStops, orgCode })) });
  const fgAll = useMemo(() => (done && isFg ? fgLines(done.rows, { at: done.at, picks }) : []), [done, isFg, picks]);
  // The customers the open line's unit passed on its trip: out to back, else its day and after. With
  // each, its coordinates, how close the route came and its speed there; and the customers around the
  // one on the sheet, passed or not (operator, 13 Nov 2026). `target`: the sheet's customer, by its geofence
  const passed = useMemo(() => {
    const l = openLine && fgAll.find((x) => x.key === openLine);
    if (!l) return null;
    const row = done?.rows?.find((r) => (r.key ?? r.plate) === l.rowKey);
    const sheet = row?.customers?.find((c) => `${l.rowKey}|${c.name}` === l.key);
    const feature = sheet && !sheet.missing ? sheet.feature ?? null : null;
    const got = ranRaw?.routesOf?.get(l.rowKey);
    if (!got) return { list: [], target: feature ? { mid: middleOf(feature), pass: null } : null, read: false };
    const from = l.departAt ?? got.from;
    const to = l.yardAt ?? got.to;
    const pings = got.routes.flat().sort((a, b) => a.t - b.t);
    const target = feature ? { mid: middleOf(feature), pass: closestPass(pings, feature, { from, to }), name: sheet.name } : null;
    const isTarget = (c) => Boolean(feature) && (c.feature === feature || c.name === sheet.name);
    const visits = customerVisits(pings, ranRaw.passable ?? [], { from, to }).map((v) => ({
      ...v, target: isTarget(v), fromTarget: target ? metresApart(target.mid, v.mid) : null,
      pass: closestPass(pings, v.feature, { from: v.enteredAt, to: v.leftAt ?? to }) }));
    const seen = new Set(visits.map((v) => v.name));
    const near = feature ? customersNear(ranRaw.passable ?? [], feature).filter((c) => !seen.has(c.name) && !isTarget(c)).flatMap((c) => {
      const pass = closestPass(pings, c.feature, { from, to });
      return pass ? [{ ...c, near: true, pass, enteredAt: pass.t, leftAt: null, stoodMs: 0 }] : [];
    }) : [];
    return { list: [...visits, ...near].sort((a, b) => a.enteredAt - b.enteredAt), target, read: true };
  }, [openLine, fgAll, ranRaw, done]);
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
    ? downloadTableCsv({ ...fgCsv(fgShown, colours), filenameSlug: `deliveries-finished-goods-${fleetDay(done.at)}` })
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
        {crumbs /* Deliveries › Van Sales | Finished Goods, on the right of the figures (operator, 13 Nov 2026) */}
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
                      options={[{ value: null, label: 'All groups', note: listRows.filter((v) => !sheetPlates.has(plateKey(v.plate))).length + sheets.list.length },
                        ...groupNames.map((name) => ({ value: name, label: name, note: groupCount(name) }))]}
                      onChange={(g) => editor.guard('Show another group', () => setGroup(g))} />

        {!fixedTemplate && (
          <ChoicePicker icon="ti-template" label="Template" align="right" value={template}
                        options={TEMPLATES.map((t) => ({ value: t.value, label: `${t.label} template` }))}
                        onChange={(t) => editor.guard('Use another template', () => { setTemplate(t); saveTemplate(orgCode, t); })} />
        )}

        <button type="button" className="sp4-submit-btn frp-run rpt-run"
                onClick={() => editor.guard('Make the report again', () => execute(daysOpen ? { mode: 'days', ...draft } : sel))}
                disabled={Boolean(problem) || run.status === 'loading'} title={problem ?? 'Make the report'}>
          {run.status === 'loading' ? 'Running…' : 'Run report'}
        </button>
        {problemShown && orgId && <span className="rpt-problem" role="status">{problemShown}</span>}
      </div>

      {editor.overlay}

      <div className="sp4-body rpt-body">
        {/* The day's list: the vehicles shared, each with its customers */}
        <section className="dlv-plan" aria-label="Today’s vehicles">
          <div className="dlv-plan__head">
            <div className="dlv-plan__lede">
              {/* Fold the list away to give the report the screen (operator, 13 Nov 2026); remembered per browser */}
              <button type="button" className="dlv-plan__fold" aria-expanded={listOpen} aria-controls="dlv-plan-body"
                      aria-label={listOpen ? 'Collapse the list of vehicles' : 'Expand the list of vehicles'}
                      title={listOpen ? 'Collapse the list' : 'Expand the list'} onClick={() => setListOpen(!listOpen)}>
                <i className="ti ti-chevron-down" aria-hidden="true" />
              </button>
              <h3 className="dlv-plan__title">
                {rangeDays.length > 1 ? 'Vehicles and stops for ' : 'Vehicles shared on '}
                {periodDays(Date.parse(`${rangeDays[0]}T09:00:00+03:00`), Date.parse(`${rangeDays[rangeDays.length - 1]}T09:00:00+03:00`))}
              </h3>
              {!listOpen && !dayList.isLoading && (
                <span className="dlv-plan__count">{listRows.length} vehicle{listRows.length === 1 ? '' : 's'}</span>
              )}
            </div>
            {/* No words while the list loads: the loader below says it (operator, 13 Nov 2026) */}
            {!dayList.isLoading && (
            <span className={`dlv-plan__keep${saveState.error || dayList.isError ? ' dlv-plan__keep--error' : ''}`} role="status">
              {dayList.isError ? <><i className="ti ti-alert-triangle" aria-hidden="true" /> The list could not be read: {dayList.error?.message}</>
                : saveState.error ? <><i className="ti ti-alert-triangle" aria-hidden="true" /> Not saved: {saveState.error}
                  {saveState.failedDay === day && (
                    <button type="button" className="sp4-ghost-btn dlv-plan__retry" onClick={retrySave}>
                      <i className="ti ti-refresh" aria-hidden="true" /> Try again
                    </button>
                  )}</>
                  : saveState.busy > 0 ? <><i className="ti ti-loader-2" aria-hidden="true" /> Saving…</>
                    : <span title={`Shared with everyone in ${companyName ?? orgCode ?? 'the organisation'}`}>
                        <i className="ti ti-cloud-check" aria-hidden="true" /> Saved{savedAt(dayList.data?.updatedAt)}
                      </span>}
            </span>
            )}
          </div>
          <div id="dlv-plan-body" hidden={!listOpen}>
          {rangeDays.length > 1 && (
            // Each day of the range keeps its own list and is run with it: pick the day to change
            <div className="sp4-filter-group dlv-plan__days" role="group" aria-label="The day new vehicles are added to">
              <span className="rpt-sub dlv-plan__addto">Add new vehicles to</span>
              {rangeDays.map((d, i) => (
                <button key={d} type="button" aria-pressed={d === day} title={`New vehicles go on ${d}’s list`}
                        className={`sp4-filter-chip${d === day ? ' sp4-filter-chip--on' : ''}`} onClick={() => setPickDay(d)}>
                  {d} · {listedOn(i) == null ? '…' : `${listedOn(i)} vehicle${listedOn(i) === 1 ? '' : 's'}`}
                </button>
              ))}
            </div>
          )}
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
            <div className="dlv-assign" role="alertdialog" aria-labelledby="dlv-assign-words">
              <i className={`ti ${assign.icon ?? 'ti-help-circle'} dlv-assign__icon`} aria-hidden="true" />
              {/* The plate leads, in bold: the sentence is about that one unit */}
              <p id="dlv-assign-words" className="dlv-assign__words">
                {assign.plate && assign.words.startsWith(assign.plate)
                  ? <><strong>{assign.plate}</strong>{assign.words.slice(assign.plate.length)}</>
                  : assign.words}
              </p>
              <div className="dlv-assign__actions">
                <button type="button" className="sp4-ghost-btn dlv-assign__btn" onClick={() => setAssign(null)} autoFocus>Cancel</button>
                <button type="button" className="sp4-submit-btn dlv-assign__btn dlv-assign__go"
                        onClick={() => { const { go } = assign; setAssign(null); go(); }}>{assign.yes}</button>
              </div>
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
          {/* The loader the other pages use, while the day's list is read */}
          {dayList.isLoading && <EmptyNote icon="ti-loader-2" tone="busy" title="Loading the vehicles" />}
          {listRows.length > 0 && (
            <>
            <div className="dlv-roster__head" aria-hidden="true">
              <span>Vehicle</span><span>Group</span><span>Stops</span><span /><span className="dlv-roster__count">Picked</span><span />
            </div>
            <ul className="dlv-plan__list dlv-roster">
              {listRows.map((v) => {
                const rk = `${v.day}|${v.key}`;
                const plan = planOn(v.day);
                const change = (next) => changeOn(v.day, next);
                const picked = v.customers.length + (v.pins?.length ?? 0);
                const isPasting = pasting.has(rk);
                const near = v.customers.filter((n) => customers.find((c) => c.name === n)?.nearStorage).length;
                return (
                  <li key={rk} className="dlv-plan__veh dlv-roster__row">
                    <span className="dlv-plan__plate">{v.plate}{multiDay && <span className="dlv-plan__day">{dayWords(v.day)}</span>}</span>
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
                                 options={options} picked={v.customers} startOpen={justAdded === rk}
                                 onChange={(names) => change(setCustomers(plan, v.key, names ?? []))} />
                    </span>
                    <button type="button" className="sp4-ghost-btn dlv-roster__paste" aria-expanded={isPasting} onClick={() => setPasting((s) => flip(s, rk))}>
                      <i className="ti ti-clipboard-text" aria-hidden="true" /> Paste stops{v.pins?.length ? ` (${v.pins.length})` : ''}
                    </button>
                    <span className="dlv-roster__count">
                      <span><b>{picked}</b> stop{picked === 1 ? '' : 's'}{near ? `, ${near} at storage` : ''}</span>
                      {picked > 0 && (
                        <span className={`dlv-meter${picked > 24 ? ' is-dense' : ''}`} aria-hidden="true">
                          {v.customers.map((name) => <i key={name} title={name} className={customers.find((c) => c.name === name)?.nearStorage ? 'is-storage' : undefined} />)}
                          {(v.pins ?? []).map((pin, i) => <i key={`pin${i}`} className="is-pin" title={pinLabel(pin)} />)}
                        </span>
                      )}
                    </span>
                    <button type="button" className="sp4-ghost-btn dlv-plan__x" onClick={() => change(removeVehicle(plan, v.key))}
                            aria-label={`Remove ${v.plate}`} title={`Remove this vehicle from ${v.day}’s list`}>
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                    {sheetPlates.has(plateKey(v.plate)) && <span className="rpt-warn dlv-roster__wide dlv-roster__note">On a Planner sheet: the sheet is reported instead</span>}
                    {canSheets && (fromPlanner[v.key] || picked === 0 || sheetPlates.has(plateKey(v.plate))) && (
                      <span className={`${fromPlanner[v.key]?.warn ? 'rpt-warn' : 'rpt-sub'} dlv-roster__wide dlv-roster__note`} role="status">
                        {fromPlanner[v.key]?.words}
                        <button type="button" className="sp4-ghost-btn" disabled={fencing.has(v.key)}
                                title="Tick the geofences of this vehicle's plan in the Planner for the day, in route order"
                                onClick={() => takePlannerStops(v.key, v.plate, v.day)}>
                          <i className="ti ti-calendar-time" aria-hidden="true" /> From the Planner
                        </button>
                      </span>
                    )}
                    {v.pins?.length > 0 && (
                      // Points listed before stops were fenced, or whose fence could not be drawn
                      <span className="rpt-warn dlv-roster__wide dlv-roster__note" role="status">
                        <i className="ti ti-map-pin-off" aria-hidden="true" /> {v.pins.length} stop{v.pins.length === 1 ? ' is a point' : 's are points'} with no geofence
                        {canFence && zones.status === 'done' && (
                          <button type="button" className="sp4-ghost-btn" disabled={fencing.has(v.key)}
                                  title="Use the geofence each point already has, else draw a circle at it named after it"
                                  onClick={() => fenceStops(v.key, v.pins, [], v.day)}>
                            <i className={`ti ${fencing.has(v.key) ? 'ti-loader-2' : 'ti-shape'}`} aria-hidden="true" /> {fencing.has(v.key) ? 'Drawing…' : `Give ${v.pins.length === 1 ? 'it' : 'them'} geofences`}
                          </button>
                        )}
                        {/* A point with no name is fenced only once named (unless the Planner has fenced it already) */}
                        {v.pins.some((p) => !p.name?.trim() && !pinNames.has(pinCode(p))) && (
                          <button type="button" className="sp4-ghost-btn dlv-roster__name-hint" onClick={() => setPasting((s) => new Set(s).add(rk))}>
                            Name the {v.pins.filter((p) => !p.name?.trim() && !pinNames.has(pinCode(p))).length === 1 ? 'point' : 'points'} with no name
                          </button>
                        )}
                      </span>
                    )}
                    {isPasting && <div className="dlv-roster__wide"><PinPaste orgId={orgId} vehicle={v} customers={customers}
                      onAdd={(pins, names) => fenceStops(v.key, pins, names, v.day)} onRemovePins={(pins) => removePins(v.key, pins, v.day)} /></div>}
                  </li>
                );
              })}
            </ul>
            </>
          )}
          </div>
        </section>

        {run.status === 'idle' && (listRows.length > 0 || sheets.list.length > 0) && (
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
                    {fgVisible.map((l) => {
                      const isOpen = openLine === l.key;
                      // The sheet's customer as the pick list names it: without the table's "(Customers Name Not Geofenced)"
                      const who = l.customer.replace(` (${NOT_GEOFENCED})`, '');
                      const toggle = () => setOpenLine(isOpen ? null : l.key);
                      return (
                        <Fragment key={l.key}>
                          <tr className={`sp4-tr dlv-fg__row dlv-fg__row--${fgState(l)} dlv-fg__row--click${isOpen ? ' dlv-fg__row--open' : ''}`}
                              style={{ '--dlv-fg-fill': fgFill(l, colours) }} onClick={toggle} tabIndex={0} aria-expanded={isOpen}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                              title="Show the customers this unit passed, to pick the one that is this customer">
                            {fgCells(l).map((v, i) => <td key={i} className={i === 1 ? 'rpt-unit' : undefined}>{v}</td>)}
                            <td className="dlv-fg__x" onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setPainting(null); }}>
                              <span className="dlv-fg__tools">
                                <button type="button" className={`dlv-fg__paint${colours.has(l.key) ? ' dlv-fg__paint--on' : ''}`}
                                        aria-haspopup="menu" aria-expanded={painting === l.key}
                                        aria-label={`Change the colour of ${l.customer} (${l.plate})`} title="Change the row’s colour"
                                        onClick={() => setPainting(painting === l.key ? null : l.key)}>
                                  <i className="ti ti-palette" aria-hidden="true" />
                                </button>
                                <button type="button" aria-label={`Drop ${l.customer} (${l.plate}) from the report`} title="Leave this line out of the table, CSV, PDF and JPEG"
                                        onClick={() => editor.guard('Drop a line', () => drop(l.key))}>
                                  <i className="ti ti-x" aria-hidden="true" />
                                </button>
                              </span>
                              {painting === l.key && (
                                <div className="dlv-fg__swatches" role="menu" aria-label={`Colour for ${l.customer}`}>
                                  {FG_COLOURS.map((c) => {
                                    const on = fgColour(l, colours) === c.state;
                                    return (
                                      <button key={c.state} type="button" role="menuitemradio" aria-checked={on} autoFocus={on}
                                              className={`dlv-fg__swatch${on ? ' dlv-fg__swatch--on' : ''}`} style={{ '--dlv-swatch': FG_FILL[c.state] }}
                                              onClick={() => editor.guard('Change a row’s colour', () => { paint(l.key, c.state === fgState(l) ? null : c.state); setPainting(null); })}>
                                        <span className="dlv-fg__chip" aria-hidden="true" />
                                        <span><b>{c.label}</b> {c.means}</span>
                                        {on && <i className="ti ti-check dlv-fg__tick" aria-hidden="true" />}
                                      </button>
                                    );
                                  })}
                                  {colours.has(l.key) && (
                                    <button type="button" role="menuitem" className="dlv-fg__swatch dlv-fg__swatch--reset"
                                            onClick={() => editor.guard('Change a row’s colour', () => { paint(l.key, null); setPainting(null); })}>
                                      <i className="ti ti-arrow-back-up" aria-hidden="true" /> Back to automatic
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="dlv-fg__pickrow">
                              <td colSpan={FG_HEADS.length + 1}>
                                {/* The customers its unit passed, as a timeline to pick from (operator, 13 Nov 2026, Hallmark) */}
                                <div className="dlv-visits">
                                  <div className="dlv-visits__head">
                                    <div className="dlv-visits__lede">
                                      <h4 className="dlv-visits__title">Customers {l.plate} passed</h4>
                                      <p className="dlv-visits__sub">
                                        {l.departAt != null ? 'From leaving the yard' : 'Over its day'}{l.yardAt != null ? ' to getting back' : ''}. Pick the one that is <strong>{who}</strong>.
                                      </p>
                                    </div>
                                    {l.picked && (
                                      <button type="button" className="sp4-ghost-btn dlv-visits__undo" onClick={() => editor.guard('Undo a pick', () => pickFor(l.key, null))}>
                                        <i className="ti ti-arrow-back-up" aria-hidden="true" /> Undo pick ({l.picked})
                                      </button>
                                    )}
                                  </div>
                                  {passed && (
                                    <p className="dlv-visits__target">
                                      <i className="ti ti-target-arrow" aria-hidden="true" />
                                      <span className="dlv-visits__target-name">On the sheet: <strong>{who}</strong></span>
                                      {!passed.target ? <span>No geofence on the map for this customer</span> : (<>
                                        {coordWords(passed.target.mid) && <CoordLink at={passed.target.mid} />}
                                        <span>{!passed.target.pass ? 'No readings on this trip'
                                          : passed.target.pass.inside ? `Went in at ${stamp(passed.target.pass.t).slice(11, 16)}, ${speedWords(passed.target.pass.speedKmh)}`
                                            : `Closest ${distanceWords(passed.target.pass.m)} at ${stamp(passed.target.pass.t).slice(11, 16)}, ${speedWords(passed.target.pass.speedKmh)}`}</span>
                                      </>)}
                                    </p>
                                  )}
                                  {passed == null || !passed.list.length ? (
                                    <p className="dlv-visits__none">{passed?.read ? `It came within 100 m of no customer’s geofence on this trip${passed.target ? `, and none lies within ${NEAR_TARGET_M} m of ${who}` : ''}.` : 'No readings kept for this line.'}</p>
                                  ) : (
                                    <ol className="dlv-visits__list">
                                      {passed.list.map((v, i, list) => {
                                        const on = l.picked === v.label && l.arriveAt === v.enteredAt;
                                        const stopped = v.stoodMs >= STOP_MS;
                                        const like = nameLike(v.label, who);
                                        const at = stamp(v.enteredAt);
                                        const newDay = i > 0 && at.slice(0, 10) !== stamp(list[i - 1].enteredAt).slice(0, 10);
                                        const inside = v.leftAt != null ? visitLength(v.leftAt - v.enteredAt) : null;
                                        return (
                                          <li key={`${v.name}|${v.enteredAt}`}
                                              className={`dlv-visit${stopped ? ' dlv-visit--stop' : ''}${v.near ? ' dlv-visit--near' : ''}${on ? ' dlv-visit--on' : ''}`}>
                                            <span className="dlv-visit__time">
                                              {newDay && <span className="dlv-visit__day">{at.slice(0, 5)}</span>}
                                              <span className="dlv-visit__in">{at.slice(11, 16)}</span>
                                              <span className="dlv-visit__out">{v.near ? 'closest' : v.leftAt != null ? stamp(v.leftAt).slice(11, 16) : 'still there'}</span>
                                            </span>
                                            <span className="dlv-visit__what">
                                              <span className="dlv-visit__name">{v.label}</span>
                                              <span className="dlv-visit__how">
                                                {v.near ? <span>Not within 100 m</span>
                                                  : stopped
                                                    ? <span className="dlv-visit__tag dlv-visit__tag--stop"><i className="ti ti-player-pause" aria-hidden="true" />Stopped {visitLength(v.stoodMs)}</span>
                                                    : <span>Passed through{inside ? ` in ${inside}` : ''}</span>}
                                                {v.target && <span className="dlv-visit__tag dlv-visit__tag--target"><i className="ti ti-target-arrow" aria-hidden="true" />On the sheet</span>}
                                                {!v.target && like && <span className="dlv-visit__tag dlv-visit__tag--like"><i className="ti ti-equal" aria-hidden="true" />Name matches</span>}
                                                {!v.target && v.fromTarget != null && v.fromTarget <= NEAR_TARGET_M && (
                                                  <span className="dlv-visit__tag dlv-visit__tag--near"><i className="ti ti-map-pin" aria-hidden="true" />{distanceWords(v.fromTarget)} from {who}</span>
                                                )}
                                              </span>
                                              <span className="dlv-visit__facts">
                                                {coordWords(v.mid) && <CoordLink at={v.mid} />}
                                                {v.pass && (
                                                  <span>
                                                    <i className="ti ti-route" aria-hidden="true" />
                                                    {v.pass.inside ? 'Went in' : `Closest ${distanceWords(v.pass.m)}`}, {speedWords(v.pass.speedKmh)}
                                                  </span>
                                                )}
                                                {!v.target && v.fromTarget != null && v.fromTarget > NEAR_TARGET_M && (
                                                  <span><i className="ti ti-ruler-measure" aria-hidden="true" />{distanceWords(v.fromTarget)} from {who}</span>
                                                )}
                                              </span>
                                            </span>
                                            {on ? (
                                              <span className="dlv-visit__picked"><i className="ti ti-check" aria-hidden="true" />Picked</span>
                                            ) : (
                                              <button type="button" className="sp4-ghost-btn dlv-visit__use"
                                                      aria-label={`Use ${v.label} at ${at.slice(11, 16)} for ${l.customer}`}
                                                      onClick={() => editor.guard('Pick a customer', () => { pickFor(l.key, { at: v.enteredAt, leftAt: v.leftAt, label: v.label }); setOpenLine(null); })}>
                                                Use this
                                              </button>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ol>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
