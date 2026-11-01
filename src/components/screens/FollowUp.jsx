/*
 * Follow-up on the Driver Behaviour tab (lib/followUp): the form that records
 * what was done about a case, and the list operators work down.
 * Plain and professional, the same parts as the incident form (no icons).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { ACTIONS, incidentWords, isOverdue, needsEscalation, exportCases, importCases } from '../../lib/followUp';

const fmtAt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' });

/** "34 h", "2 d 4 h". */
export function openFor(ms) {
  const h = Math.max(0, Math.floor(ms / 3600_000));
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Record what was done about one case, change it, or put it back to pending. */
export function ActionDialog({ kase, by, onSave, onClose }) {
  const titleId = useId();
  const [action, setAction] = useState(kase.action ?? null);
  const [note, setNote] = useState(kase.note ?? '');
  const [tried, setTried] = useState(false);
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (e) => {
    e.preventDefault();
    setTried(true);
    if (!action) return;
    onSave({ action, note, by: by || kase.by || '' });
  };

  return (
    <div className="sp4-modal-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="sp4-modal sp4-modal--narrow oi-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={save} noValidate>
        <div className="sp4-modal-head">
          <h2 id={titleId} className="sp4-repair-title">
            {kase.status === 'done' ? 'Action taken' : 'Record action'}: {kase.plate}
          </h2>
          <button type="button" className="sp4-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sp4-modal-body oi-body">
          <dl className="fu-facts">
            <div><dt>Day</dt><dd>{fmtDay.format(Date.parse(`${kase.day}T12:00:00+03:00`))}</dd></div>
            <div><dt>Driver</dt><dd>{kase.driver || 'Not recorded'}</dd></div>
            <div><dt>Incidents</dt><dd>{incidentWords(kase)}</dd></div>
            {kase.status === 'done' && <div><dt>Recorded</dt><dd>{kase.by || 'Operator'}, {fmtAt.format(kase.actedAt)}</dd></div>}
          </dl>

          <div className="oi-field">
            <span className="oi-label" id={`${titleId}-a`}>Action taken</span>
            <div className="oi-seg oi-seg--wrap" role="radiogroup" aria-labelledby={`${titleId}-a`}>
              {ACTIONS.map((a, i) => (
                <button key={a} type="button" role="radio" aria-checked={action === a} ref={i === 0 ? first : undefined}
                        className={`oi-seg__opt${action === a ? ' oi-seg__opt--on' : ''}`} onClick={() => setAction(a)}>{a}</button>
              ))}
            </div>
          </div>

          <label className="oi-field">
            <span className="oi-label">Note</span>
            <textarea className="sp4-textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="What was said or done, e.g. called at 11:40, driver says the belt buckle is faulty" />
          </label>

          <p className="oi-by">Recorded by <b>{by || 'this operator'}</b></p>
        </div>

        <div className="sp4-modal-foot">
          {tried && !action && <span className="oi-problem" role="alert">Choose the action taken</span>}
          {kase.status === 'done' && (
            <button type="button" className="sp4-ghost-btn fu-reopen" onClick={() => onSave({ action: null })}>Reopen</button>
          )}
          <button type="button" className="sp4-ghost-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="sp4-submit-btn">Save action</button>
        </div>
      </form>
    </div>
  );
}

function saveFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The cases, pending first and oldest first: the shift's follow-up list. */
export function FollowUpPanel({ cases, orgCode, onOpen, onReplace, saveFailed, now = Date.now() }) {
  const [show, setShow] = useState('pending');
  const [note, setNote] = useState(null);
  const fileRef = useRef(null);
  const pending = cases.filter((c) => c.status === 'pending');
  const overdue = pending.filter((c) => isOverdue(c, now)).length;
  const list = (show === 'pending' ? pending : show === 'done' ? cases.filter((c) => c.status === 'done').reverse() : [...cases].reverse());

  const doExport = () => {
    const stamp = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    saveFile(exportCases(cases, orgCode), `follow-up-${String(orgCode ?? 'fleet').toLowerCase()}-${stamp}.json`);
  };
  const doImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = importCases(cases, await file.text());
      onReplace(r.list);
      setNote(r.added ? `${r.added} case${r.added === 1 ? '' : 's'} added from the file.` : 'The file’s cases were already here; any newer actions were taken in.');
    } catch {
      setNote('That file could not be read. Choose a file made with Export.');
    }
  };

  return (
    <section className="oi-panel" aria-label="Follow-up">
      <header className="oi-panel__head">
        <div>
          <h3 className="oi-panel__title">
            Follow-up <span className="oi-panel__n">{pending.length} pending</span>
            {overdue > 0 && <span className="oi-panel__n fu-overdue">{overdue} overdue</span>}
          </h3>
          <p className="oi-panel__sub">
            One case per vehicle per day with a phone, seatbelt or covered-camera incident, or {`5`} or more harsh events.
            Record what was done; a case open for more than 24 hours is overdue. Kept in this browser until the database is ready.
          </p>
        </div>
        <div className="oi-panel__tools">
          <div className="oi-seg" role="radiogroup" aria-label="Show">
            {[['pending', 'Pending'], ['done', 'Action taken'], ['all', 'All']].map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={show === k}
                      className={`oi-seg__opt${show === k ? ' oi-seg__opt--on' : ''}`} onClick={() => setShow(k)}>{label}</button>
            ))}
          </div>
          <button type="button" className="sp4-ghost-btn" onClick={() => fileRef.current?.click()}>Import</button>
          <button type="button" className="sp4-ghost-btn" onClick={doExport} disabled={!cases.length}>Export</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
        </div>
      </header>
      {saveFailed && <p className="oi-warn" role="alert">This browser is not keeping the follow-up (private window or storage full). Export it before closing.</p>}
      {note && <p className="oi-note" role="status">{note}</p>}

      {list.length === 0 ? (
        <p className="oi-empty">
          {show === 'pending' ? (cases.length ? 'Nothing pending. Every case has an action recorded.' : 'No cases yet. Run the report: vehicles that need follow-up appear here.')
            : 'Nothing to show.'}
        </p>
      ) : (
        <div className="oi-scroll">
          <table className="sp4-table oi-table">
            <thead>
              <tr>
                <th>Opened</th><th>Vehicle</th><th>Driver</th><th>Incidents</th>
                <th>{show === 'pending' ? 'Open for' : 'Status'}</th><th>Flags</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const late = isOverdue(c, now);
                const esc = needsEscalation(c, cases);
                return (
                  <tr key={c.id} className="sp4-tr">
                    <td className="oi-nowrap">{fmtAt.format(c.openedAt)}</td>
                    <td className="oi-plate">{c.plate}</td>
                    <td>{c.driver || '-'}</td>
                    <td className="oi-details">{incidentWords(c)}</td>
                    <td className="oi-nowrap">
                      {c.status === 'pending' ? openFor(now - c.openedAt)
                        : <span title={c.note || undefined}>{c.action}<span className="fu-by"> · {c.by || 'Operator'}, {fmtAt.format(c.actedAt)}</span></span>}
                    </td>
                    <td className="oi-nowrap">
                      {late && <span className="fu-flag fu-flag--strong">Overdue</span>}
                      {esc && <span className="fu-flag fu-flag--strong">Escalate</span>}
                    </td>
                    <td className="oi-actions">
                      <button type="button" className={c.status === 'pending' ? 'sp4-submit-btn fu-act' : 'sp4-ghost-btn'} onClick={() => onOpen(c)}>
                        {c.status === 'pending' ? 'Record action' : 'View'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
