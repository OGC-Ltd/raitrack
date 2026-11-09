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

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as conductApi from '../../api/driverConduct';
import { makeReportDoc } from '../../api/reports';
import { saveFile } from '../../api/tripReport';
import { savePdfAsJpeg } from '../../api/pdfJpeg';
import { uprDoc } from '../../lib/reportDocs';
import { clean } from '../../lib/operatorLog';
import { displayOf } from '../../lib/fleetGroups';
import { toLocalInput, fromLocalInput } from '../../lib/fleetReports';
import EmptyNote from '../shared/EmptyNote';
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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localDayMs(dateStr) {
  return new Date(`${dateStr}T00:00:00+03:00`).getTime();
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
  const [from, setFrom] = useState(today);
  const [to,   setTo]   = useState(today);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error,   setError]       = useState(null);
  const [dialog,  setDialog]      = useState(null); // null | 'new' | { entry }
  const [shared,  setShared]      = useState({}); // id → true (session-only flag)
  const [file,    setFile]        = useState({ busy: false, error: null });
  const loadedRef = useRef(false);

  const fleet = companyName ?? orgCode ?? '';

  // ── Load all incidents, filter client-side ──────────────────────────────────
  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await conductApi.listIncidents(orgId);
      const entries = (Array.isArray(data?.incidents) ? data.incidents
                    : Array.isArray(data)             ? data
                    : []).map(clean).filter(Boolean);
      setIncidents(entries.filter((e) => e.kind === KIND && e.other === VIOLATION));
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // Load once when the tab becomes active
  useEffect(() => {
    if (active && orgId && !loadedRef.current) {
      loadedRef.current = true;
      load();
    }
  }, [active, orgId, load]);

  // ── Filter rows by date ─────────────────────────────────────────────────────
  const fromMs = from ? localDayMs(from) : 0;
  const toMs   = to   ? localDayMs(to) + 86_400_000 : Infinity;
  const rows   = incidents.filter((e) => e.at >= fromMs && e.at < toMs)
                          .sort((a, b) => b.at - a.at);

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
      load();
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
    setShared((prev) => ({ ...prev, [inc.id]: true }));
  };

  // ── CSV export ──────────────────────────────────────────────────────────────
  const saveCsv = () => {
    const head = ['Registration', 'Driver', 'Client / Location', 'Time of Event', 'Violation', 'Details', 'Logged By', 'Shared on WhatsApp'];
    const data  = rows.map((r) => [
      r.plate, r.driver, r.location, fmtAt(r.at), VIOLATION, r.details,
      r.by, shared[r.id] ? 'Shared' : 'Not shared',
    ]);
    downloadTableCsv({ head, rows: data, filenameSlug: `unauthorized-passengers-${from}${to !== from ? `-to-${to}` : ''}` });
  };

  // ── PDF / JPEG export ────────────────────────────────────────────────────────
  const pdfRows = rows.map((r) => ({ ...r, _shared: !!shared[r.id] }));
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

  return (
    <div className="frp-page upr-page">

      {/* Filter bar */}
      <div className="sp4-filterbar frp-filterbar rpt-filterbar upr-bar">
        <label className="rpt-sub upr-field">
          From
          <input type="date" className="sp4-input upr-date"
                 value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="rpt-sub upr-field">
          To
          <input type="date" className="sp4-input upr-date"
                 value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="sp4-ghost-btn" onClick={load}
                disabled={loading} title="Refresh">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button type="button" className="sp4-submit-btn frp-run rpt-run"
                onClick={() => setDialog('new')}>
          + Log incident
        </button>
      </div>

      {/* States */}
      {error && (
        <EmptyNote icon="ti-alert-circle" tone="warn" title="Could not load incidents">
          {error}
        </EmptyNote>
      )}
      {!error && !loading && incidents.length === 0 && (
        <EmptyNote icon="ti-users-minus" title="No Incidents Logged">
          No unauthorized passenger incidents have been logged yet. Use "Log incident" to add one.
        </EmptyNote>
      )}
      {!error && !loading && incidents.length > 0 && rows.length === 0 && (
        <EmptyNote icon="ti-calendar-off" title="No Incidents in This Period">
          There are incidents logged outside this date range. Adjust the dates or refresh.
        </EmptyNote>
      )}

      {/* Toolbar + table */}
      {rows.length > 0 && (
        <>
          {editor.overlay}
          <TableToolbar
            summary={<>
              Unauthorized Passengers · <strong>{rows.length}</strong> incident{rows.length === 1 ? '' : 's'}
              <span className="rpt-sub"> · {fleet} · {from}{to !== from ? ` – ${to}` : ''}</span>
            </>}
            onCsv={saveCsv}
            onPdf={file.busy ? undefined : (landscape) => save('pdf', landscape)}
            actions={<>
              {editor.button}
              {file.busy
                ? <span className="rpt-sub">{file.busy === 'jpeg' ? 'Making the JPEG…' : 'Making the PDF…'}</span>
                : file.error ? <span className="rpt-warn">{file.error}</span> : null}
              <JpegButton onSave={(landscape) => save('jpeg', landscape)} disabled={Boolean(file.busy)} title="The PDF report as an image" />
              <PreviewButton onPreview={preview.open} disabled={Boolean(file.busy)} />
            </>}
          />
          {preview.state && <PdfPreview state={preview.state} title="Unauthorized Passengers report" edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}
        </>
      )}

      {rows.length > 0 && (
        <div className="sp4-table-scroll rpt-scroll">
          <table className="sp4-table rpt-table upr-table">
            <thead>
              <tr>
                <th>Registration</th>
                <th>Client Name</th>
                <th>Time of Event</th>
                <th>Violation</th>
                <th className="upr-status-col">Status on WhatsApp</th>
                <th className="upr-actions-col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const wasShared = shared[r.id] ?? false;
                return (
                  <tr key={r.id} className="sp4-tr">
                    <td className="upr-plate">{r.plate || '—'}</td>
                    <td>{r.location || companyName || '—'}</td>
                    <td className="upr-time">{fmtAt(r.at)}</td>
                    <td>{VIOLATION}</td>
                    <td className="upr-status-col">
                      {wasShared
                        ? <span className="upr-shared">Shared ✓</span>
                        : <span className="upr-not-shared">Not shared</span>}
                    </td>
                    <td className="upr-actions-col">
                      <div className="upr-actions">
                        <button type="button" className="upr-wa-btn"
                                onClick={() => handleShare(r)}
                                title="Share on WhatsApp">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                          Share
                        </button>
                        <button type="button" className="sp4-ghost-btn upr-edit-btn"
                                onClick={() => setDialog({ entry: r })}
                                title="Edit this incident">
                          Edit
                        </button>
                        <button type="button" className="sp4-ghost-btn upr-del-btn"
                                onClick={() => handleDelete(r)}
                                title="Delete this incident">
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="upr-total-row">
                <td colSpan={2}>{rows.length} incident{rows.length === 1 ? '' : 's'}</td>
                <td colSpan={2} />
                <td>{Object.keys(shared).filter((id) => rows.some((r) => r.id === id)).length} shared</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Log / edit dialog */}

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
    </div>
  );
}
