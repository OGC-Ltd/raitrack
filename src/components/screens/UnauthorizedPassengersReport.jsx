/*
 * Unauthorized Passengers Report — manually logged incidents of vehicles
 * carrying unauthorized passengers, with per-row WhatsApp sharing.
 *
 * Data: operator-logged incidents (api/driverConduct listIncidents /
 * saveIncident / deleteIncident) filtered to kind === 'other' and
 * other === 'Unauthorized Passengers'.  Incidents are stored server-side
 * alongside driver-conduct cases so every machine sees the same list.
 *
 * Table columns (matching the screenshot):
 *   Registration · Client Name · Time of Event · Violation · Status on WhatsApp
 *
 * Actions:
 *   Log incident — opens a dialog pre-filled for "Unauthorized Passengers"
 *   Share on WhatsApp — opens wa.me with a formatted message for one row
 *   Delete — removes the incident after confirmation
 *   CSV export of the filtered rows
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as conductApi from '../../api/driverConduct';
import { loadUnauthorizedPassengers, makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { uprDoc } from '../../lib/reportDocs';
import { clean } from '../../lib/operatorLog';
import { displayOf } from '../../lib/fleetGroups';
import { toLocalInput, fromLocalInput } from '../../lib/fleetReports';
import EmptyNote from '../shared/EmptyNote';
import DateRangePicker from '../layout/DateRangePicker';
import JpegButton, { PreviewButton } from '../shared/JpegButton';
import PdfPreview from '../shared/PdfPreview';
import TableToolbar from '../body/TableToolbar';
import { useReportEditor } from './ReportEditor';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { downloadTableCsv } from '../../utils/tableExport';

// ── Constants ─────────────────────────────────────────────────────────────────

const VIOLATION = 'Unauthorized Passengers';
const KIND      = 'other';

// ── Formatting ────────────────────────────────────────────────────────────────

const fmtTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function fmtAt(ms) {
  if (!ms) return '—';
  return fmtTime.format(new Date(ms)).replace(',', '');
}

/** Today as a fleet day, YYYY-MM-DD in Nairobi, whatever the browser's own zone. */
function todayStr() {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

const MAX_DAYS = 31;
const fmt = (n) => n.toLocaleString('en-GB');
/** The figures over the table, as on the other Movements reports. */
const KPI_LABELS = ['Incidents', 'Units', 'Shared', 'Not shared'];

function Kpi({ value, label }) {
  return (
    <div className="sp4-kpi">
      <span className="sp4-kpi-n">{value}</span>
      <span className="sp4-kpi-l">{label}</span>
    </div>
  );
}

// ── WhatsApp share ────────────────────────────────────────────────────────────

function buildWhatsAppMsg(inc, companyName) {
  const org = companyName ?? 'Fleet';
  const lines = [
    `🚨 *Unauthorized Passengers — ${org}*`,
    ``,
    `Registration: *${inc.plate || '—'}*`,
    `Driver: ${inc.driver || 'Unknown'}`,
    `Time: ${fmtAt(inc.at)}`,
    `Location: ${inc.location || 'Not recorded'}`,
    `Details: ${inc.details || 'None'}`,
    ``,
    `Logged by: ${inc.by || 'Operator'}`,
  ];
  return encodeURIComponent(lines.join('\n'));
}

function shareOnWhatsApp(inc, companyName) {
  window.open(`https://wa.me/?text=${buildWhatsAppMsg(inc, companyName)}`, '_blank', 'noopener');
}

// ── Log incident dialog ───────────────────────────────────────────────────────

function LogDialog({ vehicles, entry, whoAmI, companyName, onSave, onClose }) {
  const titleId = useId();
  const listId  = useId();
  const first   = useRef(null);

  const plateOptions = (() => {
    const seen = new Map();
    for (const v of vehicles ?? []) {
      const p = displayOf(v);
      if (p) seen.set(p.toUpperCase().replace(/\s/g, ''), p);
    }
    return [...seen.values()].sort();
  })();

  const [plate,    setPlate]    = useState(entry?.plate    ?? '');
  const [at,       setAt]       = useState(() => toLocalInput(entry?.at ?? Date.now()));
  const [driver,   setDriver]   = useState(entry?.driver   ?? '');
  const [location, setLocation] = useState(entry?.location ?? '');
  const [details,  setDetails]  = useState(entry?.details  ?? '');
  const [by,       setBy]       = useState(entry?.by       ?? whoAmI ?? '');
  const [tried,    setTried]    = useState(false);

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const atMs    = fromLocalInput(at);
  const problem = !plate.trim()             ? 'Enter the vehicle registration'
                : !Number.isFinite(atMs)    ? 'Enter a valid date and time'
                : atMs > Date.now() + 5*60_000 ? 'The time is in the future'
                : null;

  const save = (e) => {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    onSave({
      id:        entry?.id,
      kind:      KIND,
      other:     VIOLATION,
      at:        atMs,
      vehicleId: null,
      plate:     plate.trim().toUpperCase(),
      driver:    driver.trim(),
      location:  location.trim(),
      status:    'Online',
      details:   details.trim(),
      by:        by.trim(),
      loggedAt:  entry?.loggedAt ?? Date.now(),
    });
  };

  return (
    <div className="sp4-modal-overlay" role="presentation"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="sp4-modal sp4-modal--narrow oi-dialog" role="dialog"
            aria-modal="true" aria-labelledby={titleId} onSubmit={save} noValidate>
        <div className="sp4-modal-head">
          <h2 id={titleId} className="sp4-repair-title">
            {entry ? 'Edit incident' : 'Log unauthorized passengers'}
          </h2>
          <button type="button" className="sp4-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sp4-modal-body oi-body">
          {/* Violation — fixed */}
          <div className="oi-field">
            <span className="oi-label">Violation</span>
            <input className="sp4-input" value={VIOLATION} readOnly disabled />
          </div>

          <div className="oi-row">
            <label className="oi-field oi-grow">
              <span className="oi-label">Vehicle registration</span>
              <input ref={first} className="sp4-input" list={listId}
                     value={plate} placeholder="e.g. KCR 117N"
                     onChange={(e) => setPlate(e.target.value.toUpperCase())}
                     autoComplete="off" />
              <datalist id={listId}>
                {plateOptions.map((p) => <option key={p} value={p} />)}
              </datalist>
              {tried && !plate.trim() && <span className="oi-err">Required</span>}
            </label>
            <label className="oi-field">
              <span className="oi-label">Date and time</span>
              <input type="datetime-local" className="sp4-input oi-when"
                     value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
          </div>

          <div className="oi-row">
            <label className="oi-field oi-grow">
              <span className="oi-label">Driver</span>
              <input className="sp4-input" value={driver} placeholder="Driver's name"
                     onChange={(e) => setDriver(e.target.value)} />
            </label>
            <label className="oi-field oi-grow">
              <span className="oi-label">Client / fleet</span>
              <input className="sp4-input" value={location}
                     placeholder={companyName ?? 'e.g. SUKARI'}
                     onChange={(e) => setLocation(e.target.value)} />
            </label>
          </div>

          <label className="oi-field">
            <span className="oi-label">Details <span className="oi-hint">(optional)</span></span>
            <textarea className="sp4-input oi-notes" rows={3}
                      value={details} placeholder="Number of passengers, pick-up point, etc."
                      onChange={(e) => setDetails(e.target.value)} />
          </label>

          <label className="oi-field">
            <span className="oi-label">Logged by</span>
            <input className="sp4-input" value={by} placeholder="Your name"
                   onChange={(e) => setBy(e.target.value)} />
          </label>

          {tried && problem && <p className="oi-err oi-err--banner" role="alert">{problem}</p>}
        </div>

        <div className="sp4-modal-foot">
          <button type="button" className="sp4-ghost-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="sp4-submit-btn">
            {entry ? 'Save changes' : 'Log incident'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UnauthorizedPassengersReport({ orgId, orgCode, vehicles, companyName, whoAmI, active = true }) {
  const today = todayStr();
  const [days, setDays] = useState({ from: today, to: today });
  // The period on screen: what was last run, not what is picked
  const [period, setPeriod] = useState(null);
  const from = period?.from ?? days.from;
  const to = period?.to ?? days.to;
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error,   setError]       = useState(null);
  const [dialog,  setDialog]      = useState(null); // null | 'new' | { entry }
  const [file,    setFile]        = useState({ busy: false, error: null });

  const fleet = companyName ?? orgCode ?? '';

  // ── The period's incidents, from the server (reports/unauthorized-passengers) ─
  const loadId = useRef(0);
  const load = useCallback(async (want) => {
    if (!orgId || !want?.from) return;
    const id = ++loadId.current;
    setLoading(true);
    setError(null);
    try {
      const data = await loadUnauthorizedPassengers({ orgId, from: want.from, to: want.to < want.from ? want.from : want.to });
      if (id !== loadId.current) return;
      setIncidents(data?.incidents ?? []);
      setPeriod(want);
    } catch (err) {
      if (id === loadId.current) setError(err?.message ?? String(err));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [orgId]);
  const run = () => load(days);
  const reload = () => load(period ?? days);

  // A tab under Movements: it runs when first opened, not with the page.
  useEffect(() => {
    if (active && orgId && !period) load(days);
  }, [active, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Newest first, as the server sends them.
  const rows = incidents;
  const isShared = (r) => r.sharedAt != null;

  // ── Save (new or edit) ──────────────────────────────────────────────────────
  const handleSave = async (data) => {
    if (!orgId) return;
    try {
      const id = data.id ?? (() => {
        try { return crypto.randomUUID(); } catch { return `up-${Date.now()}`; }
      })();
      const entry = clean({ ...data, id });
      if (!entry) return;
      await conductApi.saveIncident(orgId, entry);
      setDialog(null);
      reload();
    } catch (err) {
      alert(`Could not save: ${err?.message ?? err}`);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async (inc) => {
    if (!confirm(`Delete the incident for ${inc.plate} at ${fmtAt(inc.at)}?`)) return;
    try {
      await conductApi.deleteIncident(orgId, inc.id);
      setIncidents((prev) => prev.filter((e) => e.id !== inc.id));
    } catch (err) {
      alert(`Could not delete: ${err?.message ?? err}`);
    }
  };

  // ── Share on WhatsApp ───────────────────────────────────────────────────────
  const handleShare = (inc) => {
    shareOnWhatsApp(inc, companyName);
    // Kept on the server, so every machine and every export sees it was shared.
    conductApi.setIncidentShared(orgId, inc.id, true)
      .then((saved) => setIncidents((prev) => prev.map((e) => (e.id === saved.id ? { ...e, sharedAt: saved.sharedAt } : e))))
      .catch((err) => setError(`Shared, but that could not be recorded: ${err?.message ?? err}`));
  };

  // ── CSV export ──────────────────────────────────────────────────────────────
  const saveCsv = () => {
    const head = ['Registration', 'Driver', 'Client / Location', 'Time of Event', 'Violation', 'Details', 'Logged By', 'Shared on WhatsApp'];
    const data  = rows.map((r) => [
      r.plate, r.driver, r.location, fmtAt(r.at), VIOLATION, r.details,
      r.by, isShared(r) ? `Shared ${fmtAt(r.sharedAt)}` : 'Not shared',
    ]);
    downloadTableCsv({ head, rows: data, filenameSlug: `unauthorized-passengers-${from}${to !== from ? `-to-${to}` : ''}` });
  };

  // ── PDF / JPEG export ────────────────────────────────────────────────────────
  // Kept across renders: the editor resets whenever its rows change.
  const pdfRows = useMemo(() => rows.map((r) => ({ ...r, _shared: r.sharedAt != null })), [rows]);
  const sheet = () => uprDoc(pdfRows, { from, to, fleet, orgCode });
  const editor = useReportEditor({ orgId, source: pdfRows, build: sheet });
  const makePdf = (landscape = false) => (editor.edited ? editor.make(landscape) : makeReportDoc({ orgId, landscape, doc: sheet() }));
  const preview = usePdfPreview(makePdf);

  const save = async (as, landscape = false) => {
    if (!rows.length || file.busy) return;
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

  const problem = !orgId ? 'Waiting for the organisation to load' : !days.from ? 'Pick a day' : null;
  const shared = rows.filter(isShared).length;
  const values = period
    ? [fmt(rows.length), fmt(new Set(rows.map((r) => r.plate)).size), fmt(shared), fmt(rows.length - shared)]
    : KPI_LABELS.map((label) => <span key={label} className="frp-kpi-none">-</span>);
  const periodText = `${from}${to !== from ? ` – ${to}` : ''}`;

  return (
    <>
      <div className="sp4-header rpt-header">
        <div className="sp4-header-kpis">
          {KPI_LABELS.map((label, i) => <Kpi key={label} label={label} value={values[i]} />)}
        </div>
      </div>

      <div className="sp4-filterbar frp-filterbar rpt-filterbar">
        <DateRangePicker from={days.from} to={days.to} today={today} maxDays={MAX_DAYS} spans={[]} label="Days"
                         onChange={(f, t) => setDays({ from: f, to: t ?? f })} />
        <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setDialog('new')}>
          Log incident
        </button>
        <button type="button" className="sp4-submit-btn frp-run rpt-run" onClick={() => editor.guard('Make the report again', run)}
                disabled={Boolean(problem) || loading} title={problem ?? 'Make the report for these days'}>
          {loading ? 'Running…' : 'Run report'}
        </button>
        {problem && orgId && <span className="rpt-problem" role="status">{problem}</span>}
      </div>

      {editor.overlay}

      <div className="sp4-body rpt-body">
        {loading && !period && (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Making the Report">Reading the logged incidents…</EmptyNote>
        )}
        {error && (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Report Could Not Be Made" action={{ label: 'Try again', onClick: reload }}>
            {error}
          </EmptyNote>
        )}
        {!error && period && rows.length === 0 && (
          <EmptyNote icon="ti-users-minus" title="No Incidents">
            No unauthorized passengers were logged {from === to ? `on ${from}` : `from ${from} to ${to}`}. Use Log incident to add one.
          </EmptyNote>
        )}
        {!error && rows.length > 0 && (
          <>
            <TableToolbar
              summary={<>
                Unauthorized Passengers · <strong>{fmt(rows.length)}</strong> incident{rows.length === 1 ? '' : 's'}, {fmt(shared)} shared
                <span className="rpt-sub"> · {fleet} · {periodText}</span>
              </>}
              onCsv={saveCsv}
              onPdf={file.busy ? undefined : (landscape) => save('pdf', landscape)}
              actions={<>
                {editor.button}
                {file.busy ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                  : file.error ? <span className="rpt-warn">{file.error}</span> : null}
                <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
                <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
              </>}
            />
            {preview.state && <PdfPreview state={preview.state} title="Unauthorized Passengers report" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}
            <div className="sp4-table-scroll sp4-keep-table rpt-scroll">
              <table className="sp4-table rpt-table">
                <thead>
                  <tr>
                    <th scope="col">Registration</th>
                    <th scope="col">Client Name</th>
                    <th scope="col">Time of Event</th>
                    <th scope="col">Violation</th>
                    <th scope="col">Status on WhatsApp</th>
                    <th scope="col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="sp4-tr">
                      <td className="rpt-unit">{r.plate || '—'}</td>
                      <td>{r.location || companyName || '—'}</td>
                      <td className="oi-nowrap">{fmtAt(r.at)}</td>
                      <td>{VIOLATION}</td>
                      <td className="oi-nowrap">
                        {isShared(r)
                          ? <span className="rpt-tag rpt-tag--ok" title={`Shared ${fmtAt(r.sharedAt)}`}>Shared</span>
                          : <span className="rpt-tag">Not shared</span>}
                      </td>
                      <td className="oi-actions">
                        <button type="button" className="sp4-ghost-btn" onClick={() => handleShare(r)} title="Share on WhatsApp">Share</button>
                        <button type="button" className="sp4-ghost-btn" onClick={() => setDialog({ entry: r })} title="Edit this incident">Edit</button>
                        <button type="button" className="sp4-ghost-btn" onClick={() => handleDelete(r)} title="Delete this incident">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {dialog && (
        <LogDialog
          vehicles={vehicles}
          entry={dialog === 'new' ? null : dialog.entry}
          whoAmI={whoAmI}
          companyName={companyName}
          onSave={handleSave}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
