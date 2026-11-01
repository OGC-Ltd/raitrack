/*
 * Incidents an operator saw on a live camera (lib/operatorLog): the form that
 * logs one, and the list of what has been logged, on the Driver Behaviour tab.
 *
 * Only what an eye can see goes in here (operator, 1 Nov 2026): on phone, no
 * seatbelt, camera covered, or something else described. Harsh acceleration
 * and braking come from the trackers and are not logged by hand.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { OPERATOR_KINDS, KIND_LABEL, exportJson, importJson } from '../../lib/operatorLog';
import { displayOf } from '../../lib/fleetGroups';
import { toLocalInput, fromLocalInput } from '../../lib/fleetReports';
import { usePlaceName } from '../../hooks/usePlaceName';

const fmtAt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const key = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The form: a new entry, or `entry` to change one. */
export function IncidentDialog({ vehicles, entry, by, onSave, onClose }) {
  const titleId = useId();
  const listId = useId();
  const options = useMemo(() => {
    const seen = new Map();
    for (const v of vehicles ?? []) {
      const plate = displayOf(v);
      if (plate && !seen.has(key(plate))) seen.set(key(plate), { plate, v });
    }
    return [...seen.values()].sort((a, b) => a.plate.localeCompare(b.plate));
  }, [vehicles]);

  const [kind, setKind] = useState(entry?.kind ?? 'phone');
  const [other, setOther] = useState(entry?.other ?? '');
  const [plate, setPlate] = useState(entry?.plate ?? '');
  const [at, setAt] = useState(() => toLocalInput(entry?.at ?? Date.now()));
  const [driver, setDriver] = useState(entry?.driver ?? '');
  const [location, setLocation] = useState(entry?.location ?? '');
  const [status, setStatus] = useState(entry?.status ?? 'Online');
  const [details, setDetails] = useState(entry?.details ?? '');
  const [touched, setTouched] = useState({ driver: Boolean(entry), location: Boolean(entry) });

  const picked = options.find((o) => key(o.plate) === key(plate)) ?? null;
  // The place the vehicle is now, offered while the entry is about the present.
  const recent = Math.abs(fromLocalInput(at) - Date.now()) < 30 * 60_000;
  const place = usePlaceName(recent ? picked?.v.lat : null, recent ? picked?.v.lng : null);

  // Driver and location fill in from the vehicle until the operator types over them.
  useEffect(() => {
    if (!picked || touched.driver) return;
    setDriver(picked.v.driver && picked.v.driver !== 'Unassigned' ? picked.v.driver : '');
  }, [picked, touched.driver]);
  useEffect(() => {
    if (!place || touched.location) return;
    setLocation(String(place).replace(/,\s*Kenya$/i, ''));
  }, [place, touched.location]);

  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const atMs = fromLocalInput(at);
  const problem = !picked ? 'Choose the vehicle from the list'
    : !Number.isFinite(atMs) ? 'Enter the date and time'
    : atMs > Date.now() + 5 * 60_000 ? 'The time is in the future'
    : kind === 'other' && !other.trim() ? 'Say what was seen'
    : null;
  const [tried, setTried] = useState(false);

  const save = (e) => {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    onSave({
      id: entry?.id, kind, other: kind === 'other' ? other : '', at: atMs,
      vehicleId: picked.v.vehicleId ?? null, plate: picked.plate,
      driver, location, status, details, by: entry?.by ?? by, loggedAt: entry?.loggedAt ?? Date.now(),
    });
  };

  return (
    <div className="sp4-modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="sp4-modal sp4-modal--narrow oi-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={save} noValidate>
        <div className="sp4-modal-head">
          <h2 id={titleId} className="sp4-repair-title">{entry ? 'Edit logged incident' : 'Log an incident'}</h2>
          <button type="button" className="sp4-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sp4-modal-body oi-body">
          <div className="oi-field">
            <span className="oi-label" id={`${titleId}-kind`}>Incident observed</span>
            <div className="oi-seg" role="radiogroup" aria-labelledby={`${titleId}-kind`}>
              {OPERATOR_KINDS.map((k, i) => (
                <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} ref={i === 0 ? first : undefined}
                        className={`oi-seg__opt${kind === k.key ? ' oi-seg__opt--on' : ''}`} onClick={() => setKind(k.key)}>
                  {k.label}
                </button>
              ))}
            </div>
            {kind === 'other' && (
              <input className="sp4-input" value={other} onChange={(e) => setOther(e.target.value)} maxLength={120}
                     placeholder="What was seen, e.g. unauthorised passenger" aria-label="Describe the incident" />
            )}
          </div>

          <div className="oi-row">
            <label className="oi-field oi-grow">
              <span className="oi-label">Vehicle</span>
              <input className="sp4-input" list={listId} value={plate} placeholder="Type a plate, e.g. KCA 224M"
                     onChange={(e) => setPlate(e.target.value.toUpperCase())} autoComplete="off" />
              <datalist id={listId}>
                {options.map((o) => <option key={o.plate} value={o.plate} />)}
              </datalist>
            </label>
            <label className="oi-field">
              <span className="oi-label">Date and time</span>
              <input type="datetime-local" className="sp4-input oi-when" value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
          </div>

          <div className="oi-row">
            <label className="oi-field oi-grow">
              <span className="oi-label">Driver</span>
              <input className="sp4-input" value={driver} placeholder="Driver’s name"
                     onChange={(e) => { setDriver(e.target.value); setTouched((t) => ({ ...t, driver: true })); }} />
            </label>
            <div className="oi-field">
              <span className="oi-label" id={`${titleId}-status`}>Unit status</span>
              <div className="oi-seg" role="radiogroup" aria-labelledby={`${titleId}-status`}>
                {['Online', 'Offline'].map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={status === s}
                          className={`oi-seg__opt${status === s ? ' oi-seg__opt--on' : ''}`} onClick={() => setStatus(s)}>{s}</button>
                ))}
              </div>
            </div>
          </div>

          <label className="oi-field">
            <span className="oi-label">Location</span>
            <input className="sp4-input" value={location} placeholder="Where the vehicle was, e.g. Mombasa Road, Ivingoni"
                   onChange={(e) => { setLocation(e.target.value); setTouched((t) => ({ ...t, location: true })); }} />
          </label>

          <label className="oi-field">
            <span className="oi-label">Details</span>
            <textarea className="sp4-textarea" rows={3} value={details} maxLength={1000}
                      placeholder="What the operator saw, and any action taken" onChange={(e) => setDetails(e.target.value)} />
          </label>

          <p className="oi-by">Logged by <b>{entry?.by || by || 'this operator'}</b></p>
        </div>

        <div className="sp4-modal-foot">
          {tried && problem && <span className="oi-problem" role="alert">{problem}</span>}
          <button type="button" className="sp4-ghost-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="sp4-submit-btn">{entry ? 'Save changes' : 'Log incident'}</button>
        </div>
      </form>
    </div>
  );
}

/** Saves text as a file the browser downloads. */
function saveFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The logged incidents, newest first, with edit, delete, export and import. */
export function LoggedIncidents({ entries, orgCode, onLog, onEdit, onDelete, onReplace, saveFailed }) {
  const [confirm, setConfirm] = useState(null);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState(null);
  const fileRef = useRef(null);
  const shown = all ? entries : entries.slice(0, 20);

  const doExport = () => {
    const stamp = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    saveFile(exportJson(entries, orgCode), `operator-incidents-${String(orgCode ?? 'fleet').toLowerCase()}-${stamp}.json`);
  };
  const doImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { list, added } = importJson(entries, await file.text());
      onReplace(list);
      setNote(added ? `${added} incident${added === 1 ? '' : 's'} added from the file.` : 'Every incident in the file was already here.');
    } catch {
      setNote('That file could not be read. Choose a file made with Export.');
    }
  };

  return (
    <section className="oi-panel" aria-label="Incidents logged by operators">
      <header className="oi-panel__head">
        <div>
          <h3 className="oi-panel__title">Logged by operators <span className="oi-panel__n">{entries.length}</span></h3>
          <p className="oi-panel__sub">
            Incidents seen on the live cameras. Kept in this browser until the database is ready: use Export to pass them to another computer.
          </p>
        </div>
        <div className="oi-panel__tools">
          <button type="button" className="sp4-ghost-btn" onClick={() => fileRef.current?.click()}>Import</button>
          <button type="button" className="sp4-ghost-btn" onClick={doExport} disabled={!entries.length}>Export</button>
          <button type="button" className="sp4-submit-btn" onClick={onLog}>Log incident</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
        </div>
      </header>
      {saveFailed && <p className="oi-warn" role="alert">This browser is not keeping the entries (private window or storage full). Export them before closing.</p>}
      {note && <p className="oi-note" role="status">{note}</p>}

      {entries.length === 0 ? (
        <p className="oi-empty">Nothing logged yet. Use Log incident when an operator sees a driver on the phone, without a seatbelt, or a covered camera.</p>
      ) : (
        <div className="oi-scroll">
          <table className="sp4-table oi-table">
            <thead>
              <tr><th>Time</th><th>Vehicle</th><th>Incident</th><th>Driver</th><th>Location</th><th>Details</th><th>Logged by</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="sp4-tr">
                  <td className="oi-nowrap">{fmtAt.format(e.at)}</td>
                  <td className="oi-plate">{e.plate}</td>
                  <td className="oi-nowrap">{e.kind === 'other' ? (e.other || 'Other') : KIND_LABEL[e.kind]}</td>
                  <td>{e.driver || '-'}</td>
                  <td>{e.location || '-'}</td>
                  <td className="oi-details">{e.details || '-'}</td>
                  <td>{e.by || '-'}</td>
                  <td className="oi-actions">
                    {confirm === e.id ? (
                      <>
                        <button type="button" className="sp4-ghost-btn sp4-ghost-btn--crit" onClick={() => { onDelete(e.id); setConfirm(null); }}>Delete</button>
                        <button type="button" className="sp4-ghost-btn" onClick={() => setConfirm(null)}>Keep</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="sp4-ghost-btn" onClick={() => onEdit(e)}>Edit</button>
                        <button type="button" className="sp4-ghost-btn" onClick={() => setConfirm(e.id)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length > 20 && (
            <button type="button" className="sp4-ghost-btn oi-more" onClick={() => setAll((a) => !a)}>
              {all ? 'Show the latest 20' : `Show all ${entries.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
