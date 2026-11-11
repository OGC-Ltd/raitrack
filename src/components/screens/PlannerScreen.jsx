/*
 * Planner (operator, 2026-11-11; Menengai). A truck's delivery sheet for a
 * day, uploaded as the sales system prints it ("Sales Order Booking Delivery
 * Sheet", .xlsx): the truck, the driver, the date, and a line per customer
 * with its invoice, amount, tonnage and coordinates.
 *
 * Each customer is kept by its CUSTOMER ID with a geofence of its own: a
 * 100 m circle at the sheet's point, named after the customer, drawn the first
 * time it appears and reused after. This page draws no map (operator,
 * 2026-11-11): Show on Live Map puts the plan on the Live Map (lib/planOverlay,
 * body/PlanOnMap), and Fence opens the Live Map's own geofence tool on that
 * customer's fence.
 *
 * A plan opens laid out as Wialon Logistics' route table: home, the numbered
 * customers, home again, with when the truck arrived at each, how far it drove
 * from the stop before, and how long it stood there (lib/plannerActual, from
 * its track). The office marks each stop Full, Partly or Rejected, with a
 * remark.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsPDF } from 'jspdf';
import { addToast } from '../../lib/toasts';
import autoTableModule from 'jspdf-autotable';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useEstateZones, reloadEstateZones } from '../../hooks/useEstateZones';
import { fileAsBase64, previewSheet, saveSheet, listPlans, getPlan, updateStop, deletePlan } from '../../api/planner';
import { loadPings } from '../../api/fleetReports';
import { fleetDay, dayStart } from '../../lib/fleetReports';
import { displayOf } from '../../lib/fleetGroups';
import { fenceOf, spanWords, clockWords, kmWords, planCsvRows, OUTCOMES, planWindow } from '../../lib/plannerActual';
import { trackersFor, actualFor, readSpan } from '../../lib/plannerReport';
import { showPlanOnMap, focusPlanStop, requestFenceEdit, planOverlayNow, takePlanToOpen } from '../../lib/planOverlay';
import { useAppActions } from '../../context/AppContext';
import DateRangePicker from '../layout/DateRangePicker';
import EmptyNote from '../shared/EmptyNote';
import PlannerStopPanel from './PlannerStopPanel';
import { downloadTableCsv } from '../../utils/tableExport';
import '../body/SensorPanel.css';
import './PlannerScreen.css';

const autoTable = typeof autoTableModule === 'function' ? autoTableModule : autoTableModule.default;
const DAY = 86_400_000;
const plateKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const money = (n) => (Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '-');
const tons = (n) => (Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: 3 }) : '-');
const STATE_WORDS = {
  new: { text: 'New fence', many: 'new fences', tone: 'new' },
  known: { text: 'Uses existing', many: 'use existing', tone: 'ok' },
  moved: { text: 'Moved', many: 'moved', tone: 'warn' },
  no_point: { text: 'Needs a point', many: 'need a point', tone: 'crit' },
  linked: { text: 'Existing fence', many: 'existing fences', tone: 'ok' },
};

/*
 * A customer with no fence of its own: the server offers the fences already
 * near its point and may have matched one (by name, or the point inside a
 * shop-sized fence). The person's choice, else that match, else a new circle.
 */
const fenceChoice = (sh, s) => sh.fences?.[s.customerCode] ?? s.fenceMatch?.id ?? 'new';
const offersFences = (s) => s.state !== 'no_point' && (s.fenceOptions?.length > 0 || Boolean(s.fenceMatch));
function fenceKey(sh, s) {
  if (s.state === 'no_point' || s.state === 'moved') return s.state;
  if (offersFences(s)) return fenceChoice(sh, s) === 'new' ? 'new' : 'linked';
  return s.drawsFence ? 'new' : 'known';
}
const awayWords = (m) => (m === 0 ? 'point inside' : `${m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`} away`);

/* ── Upload ───────────────────────────────────────────────────────────── */

const MAX_SHEETS = 5;
const readPoint = (s) => {
  const m = String(s ?? '').match(/-?\d+(?:\.\d+)?/g);
  if (!m || m.length !== 2) return null;
  const [lat, lng] = m.map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let sheetSeq = 0;

/** What still stops one sheet from saving, in words; empty when it can go. */
function sheetBlockers(sh) {
  if (sh.status === 'reading') return ['Reading'];
  if (sh.status === 'saved') return [];
  if (!sh.preview) return [sh.error ?? 'Not read'];
  const out = [];
  if (!sh.edits.plate) out.push('No truck');
  if (!DATE_RE.test(sh.edits.planDate ?? '')) out.push('No date');
  const missing = sh.preview.stops.filter((s) => s.state === 'no_point' && !readPoint(sh.points[s.customerCode])).length;
  if (missing) out.push(`${missing} point${missing === 1 ? '' : 's'} to give`);
  return out;
}

/**
 * Several delivery sheets at once (operator, 2026-11-11: "upload multiple
 * xlsx"). Each file is read on its own; the list shows every sheet with what
 * it needs, the one picked is laid out below for checking, and Save saves
 * every sheet that is ready, one after another so customers new to two sheets
 * get one fence. A sheet that fails stays in the list with its reason.
 */
function UploadSheet({ orgId, units, onClose, onSaved }) {
  const [sheets, setSheets] = useState([]);
  const [current, setCurrent] = useState(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const plates = useMemo(() => units.map((u) => u.plate).sort(), [units]);

  const patch = (id, fn) => setSheets((xs) => xs.map((x) => (x.id === id ? { ...x, ...fn(x) } : x)));

  const read = async (sh, f) => {
    try {
      if (f.size > 2_000_000) throw new Error('The file is over 2 MB.');
      const data = await fileAsBase64(f);
      const p = await previewSheet(orgId, { fileName: f.name, data });
      patch(sh.id, () => ({
        status: 'ready', data, preview: p, error: null,
        edits: { plate: p.header.plate, vehicleId: p.vehicle?.id ?? null, driverName: p.header.driverName, planDate: p.header.planDate ?? '' },
      }));
    } catch (e) {
      patch(sh.id, () => ({ status: 'failed', error: e.message }));
    }
  };

  const pick = (list) => {
    const files = [...(list ?? [])].filter((f) => /\.xlsx?$/i.test(f.name));
    if (!files.length) return;
    const room = MAX_SHEETS - sheets.filter((s) => s.status !== 'saved').length;
    setNote(files.length > room ? `Only ${MAX_SHEETS} sheets at a time; ${files.length - Math.max(room, 0)} left out` : null);
    const added = files.slice(0, Math.max(room, 0)).map((f) => ({
      id: `sh${++sheetSeq}`, name: f.name, status: 'reading', data: null, preview: null, error: null, edits: {}, points: {}, fences: {}, saved: null,
    }));
    if (!added.length) return;
    setSheets((xs) => [...xs, ...added]);
    setCurrent((c) => c ?? added[0].id);
    added.forEach((sh, i) => read(sh, files[i]));
  };

  const dropSheet = (id) => {
    setSheets((xs) => xs.filter((x) => x.id !== id));
    setCurrent((c) => (c === id ? (sheets.find((x) => x.id !== id && x.status !== 'saved')?.id ?? null) : c));
  };

  // Two sheets for the same truck and day: the later one would replace the earlier
  const twins = useMemo(() => {
    const seen = new Map();
    const out = new Set();
    for (const s of sheets) {
      if (!s.preview || s.status === 'saved') continue;
      const k = `${plateKey(s.edits.plate)}|${s.edits.planDate}`;
      if (seen.has(k)) { out.add(s.id); out.add(seen.get(k)); } else seen.set(k, s.id);
    }
    return out;
  }, [sheets]);

  const waiting = sheets.filter((s) => s.status !== 'saved');
  const ready = waiting.filter((s) => s.status === 'ready' && !sheetBlockers(s).length && !twins.has(s.id));
  const reading = waiting.some((s) => s.status === 'reading');

  const save = async () => {
    setSaving(true);
    const results = [];
    for (const sh of ready) {
      const needs = sh.preview.stops.filter((s) => s.state === 'no_point');
      const pts = Object.fromEntries(needs.map((s) => [s.customerCode, readPoint(sh.points[s.customerCode])]));
      const fences = Object.fromEntries(sh.preview.stops.filter(offersFences).map((s) => [s.customerCode, fenceChoice(sh, s)]));
      try {
        const r = await saveSheet(orgId, { fileName: sh.name, data: sh.data, ...sh.edits, points: pts, fences });
        patch(sh.id, () => ({ status: 'saved', saved: r, error: null }));
        results.push({ ...r, planDate: sh.edits.planDate });
      } catch (e) {
        patch(sh.id, () => ({ status: 'ready', error: `Not saved: ${e.message}` }));
      }
    }
    setSaving(false);
    if (results.length) onSaved(results, waiting.length - results.length);
  };

  const [over, setOver] = useState(false);
  const sh = sheets.find((s) => s.id === current) ?? null;
  const counts = (sh?.preview?.stops ?? []).reduce((a, s) => { const k = fenceKey(sh, s); return { ...a, [k]: (a[k] ?? 0) + 1 }; }, {});
  const setEdits = (fn) => patch(sh.id, (x) => ({ edits: fn(x.edits) }));

  const stuck = reading ? 0 : waiting.length - ready.length;
  const savedN = sheets.length - waiting.length;
  const facts = sheets.length
    ? [{ text: `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}` },
      ready.length > 0 && { text: `${ready.length} ready to save` },
      savedN > 0 && { text: `${savedN} saved` },
      stuck > 0 && { text: `${stuck} need${stuck === 1 ? 's' : ''} attention and will not be saved`, warn: true }].filter(Boolean)
    : [{ text: `Up to ${MAX_SHEETS} .xlsx files at a time` }];

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, saving]);

  return (
    <div className="sp4-modal-overlay pl-up-overlay" role="presentation"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !sheets.length) onClose(); }}>
      <div className="pl-up" role="dialog" aria-modal="true" aria-labelledby="pl-up-title" aria-describedby="pl-up-facts">
        <header className="pl-up__head">
          <i className="ti ti-file-spreadsheet pl-up__icon" aria-hidden="true" />
          <div className="pl-up__what">
            <h2 id="pl-up-title" className="pl-up__title">Upload delivery sheets</h2>
            <p id="pl-up-facts" className="pl-up__facts">
              {facts.map((f, i) => <span key={i} className={f.warn ? 'is-warn' : undefined}>{f.text}</span>)}
            </p>
          </div>
          <div className="pl-up__tools">
            <button type="button" className="pl-primary pl-up__save" disabled={!ready.length || saving || reading} onClick={save}>
              <i className="ti ti-device-floppy" aria-hidden="true" />
              {saving ? 'Saving…' : reading ? 'Reading…' : `Save ${ready.length || ''} plan${ready.length === 1 ? '' : 's'}`.replace('  ', ' ')}
            </button>
            <button type="button" className="pl-up__x" aria-label="Close" onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></button>
          </div>
        </header>

        <div className={`pl-up__sheet${sheets.length ? '' : ' is-empty'}`}>
          <label className={`pl-drop${sheets.length ? ' pl-drop--slim' : ''}${over ? ' is-over' : ''}`}
                 onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }}
                 onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
                 onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}>
            <input type="file" accept=".xlsx,.xls" multiple onChange={(e) => { pick(e.target.files); e.target.value = ''; }} className="pl-file" />
            <i className="ti ti-file-spreadsheet" aria-hidden="true" />
            <span>
              {sheets.length ? <>Add more sheets</> : <>Drop one or more <b>Sales Order Booking Delivery Sheets</b> here, or <u>choose the .xlsx files</u></>}
            </span>
          </label>
          {note && <p className="pl-warn">{note}</p>}

          {sheets.length > 0 && (
            <ul className="pl-sheets" aria-label="Sheets">
              {sheets.map((s) => {
                const block = sheetBlockers(s);
                const tone = s.status === 'saved' ? 'ok' : s.status === 'failed' || s.error ? 'crit' : block.length ? 'warn' : twins.has(s.id) ? 'warn' : 'ok';
                const words = s.status === 'saved' ? 'Saved'
                  : s.status === 'reading' ? 'Reading…'
                    : s.error ? 'Failed'
                      : block.length ? block.join(', ')
                        : twins.has(s.id) ? 'Same truck and day as another sheet' : 'Ready';
                return (
                  <li key={s.id} className={`pl-sheet${s.id === current ? ' is-on' : ''}`}>
                    <button type="button" className="pl-sheet__pick" aria-current={s.id === current ? 'true' : undefined}
                            onClick={() => setCurrent(s.id)}>
                      <span className="pl-sheet__name">{s.preview ? s.edits.plate || s.name : s.name}</span>
                      <span className="pl-quiet">{s.preview ? `${s.edits.planDate || 'No date'}, ${s.preview.stops.length} lines` : s.name}</span>
                      <span className={`pl-tag pl-tag--${tone}`}>{words}</span>
                    </button>
                    {s.status !== 'saved' && !saving && (
                      <button type="button" className="pl-x" aria-label={`Remove ${s.name}`} onClick={() => dropSheet(s.id)}>
                        <i className="ti ti-x" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {sh?.error && <p className="pl-error" role="alert">{sh.name}: {sh.error}</p>}
          {sh?.status === 'saved' && (
            <p className="pl-sub">
              {sh.saved.replaced ? 'Replaced' : 'Saved'}: {sh.saved.customersAdded} new customer{sh.saved.customersAdded === 1 ? '' : 's'}, {sh.saved.fencesDrawn} geofence{sh.saved.fencesDrawn === 1 ? '' : 's'} drawn{sh.saved.fencesReused ? `, ${sh.saved.fencesReused} existing used` : ''}.
            </p>
          )}

          {sh?.preview && sh.status !== 'saved' && (
            <>
              <div className="pl-fields">
                <label className="pl-field">Truck
                  <input list="pl-plates" value={sh.edits.plate ?? ''} onChange={(e) => {
                    const plate = e.target.value;
                    const u = units.find((x) => plateKey(x.plate) === plateKey(plate));
                    setEdits((x) => ({ ...x, plate, vehicleId: u?.vehicleId ?? null }));
                  }} />
                  <datalist id="pl-plates">{plates.map((p) => <option key={p} value={p} />)}</datalist>
                  <span className={sh.edits.vehicleId ? 'pl-sub' : 'pl-warn'}>{sh.edits.vehicleId ? 'Tracked unit' : 'No tracked unit with this plate: no telemetry'}</span>
                </label>
                <label className="pl-field">Driver
                  <input value={sh.edits.driverName ?? ''} onChange={(e) => setEdits((x) => ({ ...x, driverName: e.target.value }))} />
                  <span className="pl-sub">{sh.preview.driver ? 'On the driver list' : 'Not on the driver list; kept as written'}</span>
                </label>
                <label className="pl-field">Date
                  <input type="date" value={sh.edits.planDate ?? ''} onChange={(e) => setEdits((x) => ({ ...x, planDate: e.target.value }))} />
                  {sh.preview.replacesPlanId && <span className="pl-warn">Replaces this truck’s sheet for the day; marked outcomes are kept</span>}
                  {twins.has(sh.id) && <span className="pl-warn">Another sheet here has the same truck and day: change the date or remove one</span>}
                </label>
              </div>

              <div className="pl-summary">
                <span className="pl-sub">{sh.preview.stops.length} lines</span>
                {['new', 'linked', 'known', 'moved', 'no_point'].filter((k) => counts[k]).map((k) => (
                  <span key={k} className={`pl-tag pl-tag--${STATE_WORDS[k].tone}`}>{counts[k]} {counts[k] === 1 ? STATE_WORDS[k].text.toLowerCase() : STATE_WORDS[k].many}</span>
                ))}
              </div>
              {sh.preview.problems.length > 0 && (
                <ul className="pl-problems">{sh.preview.problems.map((p, i) => <li key={i}>{p.row ? `Row ${p.row}: ` : ''}{p.message}</li>)}</ul>
              )}

              <div className="pl-up__table">
                <table className="sp4-table pl-table">
                  <thead>
                    <tr><th className="pl-r">No.</th><th>Customer</th><th>Location</th><th className="pl-r">Amount</th><th className="pl-r">Tonnage</th><th>Fence</th></tr>
                  </thead>
                  <tbody>
                    {sh.preview.stops.map((s) => (
                      <tr key={s.sequence} className="sp4-tr sp4-tr--static">
                        <td className="sp4-td pl-r">{s.sequence}</td>
                        <td className="sp4-td"><b>{s.customerName}</b><div className="pl-quiet">{s.customerCode}</div></td>
                        <td className="sp4-td">{s.location}</td>
                        <td className="sp4-td pl-r">{money(s.amount)}</td>
                        <td className="sp4-td pl-r">{tons(s.tonnage)}</td>
                        <td className="sp4-td">
                          <span className={`pl-tag pl-tag--${STATE_WORDS[fenceKey(sh, s)].tone}`}>{STATE_WORDS[fenceKey(sh, s)].text}{s.state === 'moved' ? ` ${s.movedM} m` : ''}</span>
                          {offersFences(s) && (
                            <>
                              <select className="pl-fence" value={fenceChoice(sh, s)} aria-label={`Geofence for ${s.customerName}`}
                                      onChange={(e) => { const v = e.target.value; patch(sh.id, (x) => ({ fences: { ...x.fences, [s.customerCode]: v } })); }}>
                                {s.fenceOptions.map((o) => <option key={o.id} value={o.id}>{o.name} ({awayWords(o.distanceM)})</option>)}
                                <option value="new">Draw a new 100 m circle</option>
                              </select>
                              {s.fenceMatch && fenceChoice(sh, s) === s.fenceMatch.id && (
                                <div className="pl-quiet">Found by its name near the point</div>
                              )}
                            </>
                          )}
                          {s.state === 'moved' && <div className="pl-quiet">Kept where it was: {s.fenceName}</div>}
                          {s.state === 'known' && s.fenceName && <div className="pl-quiet">{s.fenceName}</div>}
                          {s.state === 'no_point' && (
                            <input className="pl-point" placeholder="lat, lng" value={sh.points[s.customerCode] ?? ''}
                                   aria-label={`Coordinates for ${s.customerName}`}
                                   aria-invalid={Boolean(sh.points[s.customerCode]) && !readPoint(sh.points[s.customerCode])}
                                   onChange={(e) => { const v = e.target.value; patch(sh.id, (x) => ({ points: { ...x.points, [s.customerCode]: v } })); }} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

/* ── One plan ─────────────────────────────────────────────────────────── */

function PlanView({ orgId, planId, vehicles, zones, canWrite, canFence, canMap, onBack }) {
  const qc = useQueryClient();
  const key = ['planner', 'plan', orgId, planId];
  const { data: plan, error, isLoading } = useQuery({ queryKey: key, queryFn: () => getPlan(orgId, planId), enabled: Boolean(orgId && planId) });
  const [selected, setSelected] = useState(null);
  const { setDesktopActiveTab } = useAppActions();

  // The truck's trackers: the plan's unit and any other carrying its plate
  const trackers = useMemo(() => trackersFor(plan, vehicles), [plan, vehicles]);
  const window_ = useMemo(() => (plan ? planWindow(plan, dayStart) : null), [plan]);
  const pings = useQuery({
    queryKey: ['planner', 'track', orgId, planId, trackers.map((t) => t.vehicleId).join(','), window_?.from],
    queryFn: () => loadPings({ orgId, vehicles: trackers, ...readSpan(plan, dayStart) }),
    enabled: Boolean(orgId && trackers.length && window_ && window_.to > window_.from),
    staleTime: 5 * 60_000,
  });

  const zonesById = useMemo(() => new Map((zones?.features ?? []).map((f) => [f.properties?.id, f])), [zones]);
  const routes = useMemo(() => (pings.data ? [...pings.data.pings.values()] : []), [pings.data]);
  // The same reading the Deliveries report renders (lib/plannerReport)
  const actual = useMemo(() => (plan && window_ ? actualFor(plan, routes, zones, dayStart).actual : null), [plan, routes, zones, window_]);
  const byStop = useMemo(() => new Map((actual?.stops ?? []).map((s) => [s.id, s])), [actual]);
  // The run on the map: out of the origin and home again, else the whole span read
  const dayTrack = useMemo(() => {
    const main = routes.reduce((a, r) => (r.length > a.length ? r : a), []);
    if (!window_) return [];
    const a = actual?.leftAt ?? window_.from;
    const b = actual?.backAt ?? window_.to;
    return main.filter((p) => p.t >= a && p.t <= b);
  }, [routes, window_, actual]);

  const mainTrack = useMemo(() => routes.reduce((a, r) => (r.length > a.length ? r : a), []), [routes]);
  const items = useMemo(() => (plan?.stops ?? []).map((s) => ({
    id: s.id, n: s.sequence, label: s.customer.name, feature: fenceOf(s.customer, zonesById),
    tone: byStop.get(s.id)?.at != null ? 'ok' : actual?.telemetry ? 'crit' : 'new',
  })), [plan, zonesById, byStop, actual]);

  const setStop = async (stop, body) => {
    qc.setQueryData(key, (p) => p && { ...p, stops: p.stops.map((s) => (s.id === stop.id ? { ...s, ...body } : s)) });
    try { await updateStop(orgId, planId, stop.id, body); }
    catch (e) { window.alert(`Not saved: ${e.message}`); qc.invalidateQueries({ queryKey: key }); }
    qc.invalidateQueries({ queryKey: ['planner', 'plans', orgId] });
  };

  // The plan on the Live Map: its fences, numbered, and the truck's run
  const toMap = (focusStopId = null) => {
    showPlanOnMap({
      planId, title: `${plan.plate} · ${plan.planDate}`,
      sub: actual?.telemetry ? `${kmWords(actual.km)} in ${spanWords(actual.durationMs)}` : (plan.driverName || null),
      stops: items, track: dayTrack.map((p) => ({ lat: p.lat, lng: p.lng })), focusStopId,
    });
    setDesktopActiveTab('fleet');
  };
  // Fence: the Live Map's own geofence tool on this customer's fence
  const redraw = (stop) => {
    if (!stop.customer.geofenceId || !zonesById.get(stop.customer.geofenceId)) {
      window.alert('This customer’s fence is not loaded yet; try again in a moment.');
      return;
    }
    toMap(stop.id);
    requestFenceEdit(stop.customer.geofenceId);
  };

  if (isLoading) return <EmptyNote icon="ti-loader" title="Loading the plan…" />;
  if (error || !plan) return <EmptyNote tone="error" icon="ti-alert-triangle" title="The plan could not be loaded">{error?.message}</EmptyNote>;

  const totals = plan.stops.reduce((a, s) => ({ amount: a.amount + (s.amount ?? 0), tonnage: a.tonnage + (s.tonnage ?? 0) }), { amount: 0, tonnage: 0 });
  const home = actual?.origin?.short ?? 'Home';
  const telemetryNote = !trackers.length ? 'No tracked unit carries this plate'
    : pings.isLoading ? 'Reading the track…'
      : pings.error ? `Track not read: ${pings.error.message}`
        : actual && !actual.telemetry ? 'No telemetry that day' : null;

  const csv = () => {
    const [head, ...body] = planCsvRows(plan, actual);
    downloadTableCsv({ head, body, filenameSlug: `plan-${plateKey(plan.plate)}-${plan.planDate}` });
  };
  const pdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Delivery plan: ${plan.plate}, ${plan.planDate}`, 40, 40);
    doc.setFontSize(9);
    doc.text(`Driver ${plan.driverName || '-'} · ${plan.stops.length} stops · ${money(totals.amount)} invoiced · ${tons(totals.tonnage)} t`
      + (actual?.telemetry ? ` · ${actual.visited} reached · ${kmWords(actual.km)} in ${spanWords(actual.durationMs)}` : ''), 40, 56);
    const [head, ...body] = planCsvRows(plan, actual);
    autoTable(doc, { head: [head], body, startY: 70, styles: { fontSize: 7 }, headStyles: { fillColor: [30, 41, 59] } });
    doc.save(`plan-${plateKey(plan.plate)}-${plan.planDate}.pdf`);
  };

  const reached = actual?.telemetry ? actual.visited : null;
  const outcomeCount = (id) => plan.stops.filter((s) => s.outcome === id).length;
  const openStops = plan.stops.filter((s) => !s.outcome).length;
  const pickStop = (s) => { setSelected(s.id); if (planOverlayNow().overlay?.planId === planId) focusPlanStop(s.id); };
  const openStop = selected ? plan.stops.find((s) => s.id === selected) ?? null : null;

  return (
    <div className="pl-plan">
      <div className="pl-plan__head">
        <button type="button" className="sp4-ghost-btn" onClick={onBack}><i className="ti ti-arrow-left" aria-hidden="true" /> All plans</button>
        <div className="pl-plan__name">
          <h2 className="pl-plan__title">{plan.plate}</h2>
          <div className="pl-plan__facts">
            <span><i className="ti ti-calendar" aria-hidden="true" />{plan.planDate}</span>
            <span><i className="ti ti-steering-wheel" aria-hidden="true" />{plan.driverName || 'No driver'}</span>
            {plan.sheetAt && <span>Printed {clockWords(Date.parse(plan.sheetAt))}</span>}
            {!plan.vehicle && <span className="pl-warn">Unit not matched</span>}
          </div>
        </div>
        <span className="pl-grow" />
        <div className="sp4-header-kpis">
          <div className={`sp4-kpi${reached == null ? '' : reached === plan.stops.length ? ' pl-kpi--ok' : ' pl-kpi--crit'}`}>
            <span className="sp4-kpi-n">{reached ?? '-'}<span className="pl-of">/{plan.stops.length}</span></span>
            <span className="sp4-kpi-l">Reached</span>
          </div>
          <div className="sp4-kpi"><span className="sp4-kpi-n">{kmWords(actual?.km)}</span><span className="sp4-kpi-l">Driven</span></div>
          <div className="sp4-kpi"><span className="sp4-kpi-n">{spanWords(actual?.durationMs)}</span><span className="sp4-kpi-l">Out</span></div>
          <div className="sp4-kpi"><span className="sp4-kpi-n">{money(totals.amount)}</span><span className="sp4-kpi-l">Invoiced</span></div>
          <div className="sp4-kpi"><span className="sp4-kpi-n">{tons(totals.tonnage)}</span><span className="sp4-kpi-l">Tonnes</span></div>
          <div className={`sp4-kpi${openStops ? ' pl-kpi--open' : ''}`}><span className="sp4-kpi-n">{openStops}</span><span className="sp4-kpi-l">Stops open</span></div>
        </div>
      </div>

      <div className="pl-band">
        <div className="pl-tags" aria-label="Outcomes marked">
          {OUTCOMES.map((o) => (
            <span key={o.id} className={`pl-tag pl-tag--${o.id === 'FULL' ? 'ok' : o.id === 'PARTLY' ? 'warn' : 'crit'}`}>{outcomeCount(o.id)} {o.label.toLowerCase()}</span>
          ))}
        </div>
        {telemetryNote && <span className="pl-sub">{telemetryNote}</span>}
        <span className="pl-grow" />
        <div className="pl-plan__actions">
          {canMap && (
            <button type="button" className="pl-primary" onClick={() => toMap(selected)}>
              <i className="ti ti-map-2" aria-hidden="true" /> Show on Live Map
            </button>
          )}
          <button type="button" className="sp4-ghost-btn" onClick={csv}><i className="ti ti-file-type-csv" aria-hidden="true" /> CSV</button>
          <button type="button" className="sp4-ghost-btn" onClick={pdf}><i className="ti ti-file-type-pdf" aria-hidden="true" /> PDF</button>
        </div>
      </div>

      <div className="pl-scroll sp4-table-scroll">
        <table className="sp4-table pl-table pl-route">
          <thead>
            <tr>
              <th aria-label="Stop" />
              <th>Customer</th>
              <th>Location</th>
              <th>Invoice</th>
              <th className="pl-r">Amount</th>
              <th className="pl-r">Tonnage</th>
              <th>Arrived</th>
              <th className="pl-r">Km</th>
              <th className="pl-r">Time there</th>
              <th>Outcome</th>
              <th>Remarks</th>
              {canFence && <th aria-label="Fence" />}
            </tr>
          </thead>
          <tbody>
            <tr className="sp4-tr sp4-tr--static pl-route__home pl-route__start">
              <td className="sp4-td pl-rail"><span className="pl-pin pl-pin--home"><i className="ti ti-home" aria-hidden="true" /></span></td>
              <td className="sp4-td" colSpan={5}><b>{actual?.origin?.label ?? 'Home'}</b><div className="pl-quiet">Start</div></td>
              <td className="sp4-td">{actual?.leftAt ? `Left ${clockWords(actual.leftAt)}` : '-'}</td>
              <td className="sp4-td pl-r">0 m</td>
              <td className="sp4-td" colSpan={canFence ? 4 : 3} />
            </tr>
            {plan.stops.map((s) => {
              const a = byStop.get(s.id) ?? {};
              return (
                <tr key={s.id} className={`sp4-tr${selected === s.id ? ' sp4-tr--selected' : ''}`} tabIndex={0}
                    onClick={() => pickStop(s)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) pickStop(s); }}>
                  <td className="sp4-td pl-rail"><span className={`pl-pin${a.at != null ? ' pl-pin--ok' : actual?.telemetry ? ' pl-pin--miss' : ''}`}>{s.sequence}</span></td>
                  <td className="sp4-td">
                    <b>{s.customer.name}</b>
                    <div className="pl-meta pl-quiet"><span>{s.customer.code}</span>{s.rep && <span>Rep {s.rep}</span>}</div>
                  </td>
                  <td className="sp4-td">{s.customer.location}</td>
                  <td className="sp4-td">{s.invoiceNo || '-'}</td>
                  <td className="sp4-td pl-r">{money(s.amount)}</td>
                  <td className="sp4-td pl-r">{tons(s.tonnage)}</td>
                  <td className="sp4-td">
                    {a.at != null ? clockWords(a.at)
                      : actual?.telemetry ? <span className="pl-warn">{a.reachedAt != null ? `Passed ${clockWords(a.reachedAt).slice(-5)}, did not stop`
                        : a.nearestM != null ? `Not reached, closest ${kmWords(a.nearestM / 1000)}` : 'Not reached'}</span> : '-'}
                    {a.visit != null && a.visit !== s.sequence && <div className="pl-quiet">Visited {a.visit}{a.visit === 1 ? 'st' : a.visit === 2 ? 'nd' : a.visit === 3 ? 'rd' : 'th'}</div>}
                  </td>
                  <td className="sp4-td pl-r">{kmWords(a.kmFromPrev)}</td>
                  <td className="sp4-td pl-r">{a.stayMs != null ? spanWords(a.stayMs) : a.at != null ? 'Still there' : '-'}</td>
                  <td className="sp4-td" onClick={(e) => e.stopPropagation()}>
                    <div className="pl-seg" role="group" aria-label={`Outcome at ${s.customer.name}`}>
                      {OUTCOMES.map((o) => (
                        <button key={o.id} type="button" disabled={!canWrite}
                                className={`pl-seg__btn pl-seg__btn--${o.id.toLowerCase()}${s.outcome === o.id ? ' is-on' : ''}`}
                                aria-pressed={s.outcome === o.id}
                                onClick={() => setStop(s, { outcome: s.outcome === o.id ? null : o.id })}>{o.label}</button>
                      ))}
                    </div>
                  </td>
                  <td className="sp4-td" onClick={(e) => e.stopPropagation()}>
                    <RemarkInput value={s.remarks} disabled={!canWrite} onSave={(remarks) => setStop(s, { remarks })} label={`Remarks for ${s.customer.name}`} />
                  </td>
                  {canFence && (
                    <td className="sp4-td" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="sp4-ghost-btn" title="Redraw this customer's geofence on the Live Map" onClick={() => redraw(s)}>
                        <i className="ti ti-pencil" aria-hidden="true" /> Fence
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="sp4-tr sp4-tr--static pl-route__home pl-route__end">
              <td className="sp4-td pl-rail"><span className="pl-pin pl-pin--home"><i className="ti ti-home" aria-hidden="true" /></span></td>
              <td className="sp4-td" colSpan={5}><b>{home}</b><div className="pl-quiet">Back</div></td>
              <td className="sp4-td">{actual?.backAt ? clockWords(actual.backAt) : actual?.telemetry ? 'Not back' : '-'}</td>
              <td className="sp4-td pl-r">{kmWords(actual?.homeKm)}</td>
              <td className="sp4-td" colSpan={canFence ? 4 : 3} />
            </tr>
          </tbody>
        </table>
      </div>

      {openStop && (
        <PlannerStopPanel
          plan={plan} stop={openStop} actual={actual} track={mainTrack} window_={window_} zonesById={zonesById}
          vehicle={trackers[0]} homeLabel={actual?.origin?.label ?? 'home'}
          canWrite={canWrite} canMap={canMap} canFence={canFence} RemarkInput={RemarkInput}
          onOutcome={(body) => setStop(openStop, body)}
          onClose={() => setSelected(null)}
          onShowOnMap={() => toMap(openStop.id)}
          onFence={() => redraw(openStop)}
        />
      )}
    </div>
  );
}

/** A remark saved when the field is left, or on Enter. */
function RemarkInput({ value, onSave, disabled, label }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => { setText(value ?? ''); }, [value]);
  const commit = () => { if (text !== (value ?? '')) onSave(text); };
  return (
    <input className="pl-remark" value={text} disabled={disabled} aria-label={label} placeholder={disabled ? '' : 'Add a remark'}
           onChange={(e) => setText(e.target.value)} onBlur={commit}
           onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

/* ── The page ─────────────────────────────────────────────────────────── */

export default function PlannerScreen() {
  const { vehicles = [], orgId } = useFleetLiveShared();
  const { can } = usePermissions();
  const { zones } = useEstateZones(orgId);
  const qc = useQueryClient();
  const today = fleetDay(Date.now());
  const [range, setRange] = useState(() => ({ from: fleetDay(Date.now() - 6 * DAY), to: today }));
  // Back from the Live Map, the plan that was put there is open again
  const [open, setOpen] = useState(() => takePlanToOpen() ?? planOverlayNow().overlay?.planId ?? null);
  const [uploading, setUploading] = useState(false);
  const canWrite = can('planner:write');

  const plans = useQuery({
    queryKey: ['planner', 'plans', orgId, range.from, range.to],
    queryFn: () => listPlans(orgId, range.from, range.to),
    enabled: Boolean(orgId),
  });
  const units = useMemo(() => {
    const seen = new Map();
    for (const v of vehicles) {
      const plate = displayOf(v);
      if (plate && !seen.has(plateKey(plate))) seen.set(plateKey(plate), { plate, vehicleId: v.vehicleId });
    }
    return [...seen.values()];
  }, [vehicles]);

  const list = plans.data ?? [];
  const kpi = list.reduce((a, p) => ({
    stops: a.stops + p.stopCount, amount: a.amount + p.amount, tonnage: a.tonnage + p.tonnage,
    open: a.open + p.outcomes.open, rejected: a.rejected + p.outcomes.REJECTED,
  }), { stops: 0, amount: 0, tonnage: 0, open: 0, rejected: 0 });

  // Sheets saved from the upload: the list widens to their dates, and one
  // plan saved alone opens. Sheets left in the dialog keep it open.
  const saved = (results, leftOver) => {
    if (!leftOver) setUploading(false);
    reloadEstateZones(orgId);
    qc.invalidateQueries({ queryKey: ['planner'] });
    const n = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0);
    const moved = results.flatMap((r) => r.moved ?? []);
    const replaced = results.filter((r) => r.replaced).length;
    const plural = (c, one, many) => `${c} ${c === 1 ? one : many}`;
    addToast({
      id: `planner-saved-${Date.now()}`,
      level: 'success',
      title: `${plural(results.length, 'plan', 'plans')} saved${replaced ? ` (${replaced} replaced)` : ''}`,
      body: `${plural(n('customersAdded'), 'new customer', 'new customers')}, ${plural(n('fencesDrawn'), 'geofence', 'geofences')} drawn`
      + (n('fencesReused') ? `, ${plural(n('fencesReused'), 'existing geofence', 'existing geofences')} used` : '')
      + (moved.length ? `; ${moved.length} point${moved.length === 1 ? ' differs' : 's differ'} from the kept fence (${moved.map((m) => m.name).join(', ')})` : ''),
    });
    const dates = results.map((r) => r.planDate).filter(Boolean).sort();
    if (dates.length) {
      setRange((rg) => {
        const from = dates[0] < rg.from ? dates[0] : rg.from;
        const to = dates.at(-1) > rg.to ? (dates.at(-1) > today ? today : dates.at(-1)) : rg.to;
        return (Date.parse(to) - Date.parse(from)) / DAY <= 61 ? { from, to } : rg;
      });
    }
    if (results.length === 1 && !leftOver) setOpen(results[0].planId);
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove the plan for ${p.plate} on ${p.planDate}? Its customers and their geofences stay.`)) return;
    await deletePlan(orgId, p.id);
    qc.invalidateQueries({ queryKey: ['planner', 'plans', orgId] });
  };

  return (
    <div className="sp4-root sp4-root--framed pl-root">
      <div className="sp4-header pl-head">
        <div className="pl-head__name">
          <h1 className="pl-title"><span className="ti ti-calendar-time" aria-hidden="true" /> Planner</h1>
        </div>
        {!open && (
          <div className="sp4-header-kpis">
            <div className="sp4-kpi"><span className="sp4-kpi-n">{list.length}</span><span className="sp4-kpi-l">Plans</span></div>
            <div className="sp4-kpi"><span className="sp4-kpi-n">{kpi.stops}</span><span className="sp4-kpi-l">Stops</span></div>
            <div className="sp4-kpi"><span className="sp4-kpi-n">{money(kpi.amount)}</span><span className="sp4-kpi-l">Invoiced</span></div>
            <div className="sp4-kpi"><span className="sp4-kpi-n">{tons(kpi.tonnage)}</span><span className="sp4-kpi-l">Tonnes</span></div>
            <div className={`sp4-kpi${kpi.open ? ' pl-kpi--open' : ''}`}><span className="sp4-kpi-n">{kpi.open}</span><span className="sp4-kpi-l">Stops open</span></div>
          </div>
        )}
      </div>

      <div className="sp4-body pl-body">
        {open ? (
          <PlanView orgId={orgId} planId={open} vehicles={vehicles} zones={zones}
                    canWrite={canWrite} canFence={can('geofence:update') && can('map:read')} canMap={can('map:read')} onBack={() => setOpen(null)} />
        ) : (
          <>
            <div className="pl-band">
              <DateRangePicker from={range.from} to={range.to} today={today} maxDays={62}
                               onChange={(from, to) => setRange({ from, to })} />
              <span className="pl-grow" />
              {canWrite && (
                <button type="button" className="pl-primary" onClick={() => setUploading(true)}>
                  <i className="ti ti-upload" aria-hidden="true" /> Upload sheet
                </button>
              )}
            </div>
            {plans.isLoading ? <EmptyNote icon="ti-loader" title="Loading plans…" />
              : plans.error ? <EmptyNote tone="error" icon="ti-alert-triangle" title="Plans could not be loaded">{plans.error.message}</EmptyNote>
                : !list.length ? (
                  <EmptyNote icon="ti-calendar-time" title="No delivery plans in these dates"
                             action={canWrite ? { label: 'Upload sheet', onClick: () => setUploading(true) } : null}>
                    Upload a truck’s Sales Order Booking Delivery Sheet to plan its day.
                  </EmptyNote>
                ) : (
                  <div className="pl-scroll sp4-table-scroll">
                    <table className="sp4-table pl-table">
                      <thead>
                        <tr>
                          <th>Date</th><th>Truck</th><th>Driver</th><th className="pl-r">Stops</th>
                          <th className="pl-r">Invoiced</th><th className="pl-r">Tonnage</th><th>Outcomes</th><th>Sheet</th>
                          {canWrite && <th aria-label="Remove" />}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((p) => (
                          <tr key={p.id} className="sp4-tr" tabIndex={0} onClick={() => setOpen(p.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(p.id); }}>
                            <td className="sp4-td">{p.planDate}</td>
                            <td className="sp4-td"><b>{p.plate}</b>{!p.vehicleId && <div className="pl-warn">Not a tracked unit</div>}</td>
                            <td className="sp4-td">{p.driverName || '-'}</td>
                            <td className="sp4-td pl-r">{p.stopCount}</td>
                            <td className="sp4-td pl-r">{money(p.amount)}</td>
                            <td className="sp4-td pl-r">{tons(p.tonnage)}</td>
                            <td className="sp4-td">
                              <div className="pl-tags">
                                <span className="pl-tag pl-tag--ok">{p.outcomes.FULL} full</span>
                                {p.outcomes.PARTLY > 0 && <span className="pl-tag pl-tag--warn">{p.outcomes.PARTLY} partly</span>}
                                {p.outcomes.REJECTED > 0 && <span className="pl-tag pl-tag--crit">{p.outcomes.REJECTED} rejected</span>}
                                {p.outcomes.open > 0 && <span className="pl-tag">{p.outcomes.open} open</span>}
                              </div>
                            </td>
                            <td className="sp4-td pl-quiet">{p.sourceFile || '-'}</td>
                            {canWrite && (
                              <td className="sp4-td" onClick={(e) => e.stopPropagation()}>
                                <button type="button" className="pl-x pl-x--danger" aria-label={`Remove the plan for ${p.plate}`} onClick={() => remove(p)}>
                                  <i className="ti ti-trash" aria-hidden="true" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </>
        )}
      </div>

      {uploading && <UploadSheet orgId={orgId} units={units} onClose={() => setUploading(false)} onSaved={saved} />}
    </div>
  );
}
