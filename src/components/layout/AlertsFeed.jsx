/*
 * The vehicle panel's Alerts list (lib/alertFeed says what it is made of).
 *
 * Redesigned 2026-10-02 (Hallmark, component scope). A day heading that says
 * what the day held ("3 critical · 1 warning"), then a timeline: one entry per
 * alert, an icon for what kind of thing happened in a disc coloured by its
 * severity, the discs joined by a thin rail. The title and its time share the
 * first line; the sentence sits under it in two lines at most.
 *
 * The same alert repeated back to back — "Restricted · Entered Main river
 * malagarasi3" three times in a morning — is one entry with a ×3 badge, its
 * latest time on the line and every time inside (foldRepeats). A fuel loss
 * reported several times is already one entry (lib/alertFeed) and opens to
 * list each report. Anything with more to say opens on a click.
 */

import { useMemo, useState } from 'react';
import { alertFeed } from '../../lib/alertFeed';
import './AlertsFeed.css';

const HHMM = new Intl.DateTimeFormat('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const SEVERITY_WORD = { critical: 'Critical', warning: 'Warning', info: 'Activity' };
const litresText = (l) => `${l.toLocaleString('en-KE', { maximumFractionDigits: 1 })} L`;

/** The icon for what happened. Restricted zones read as no-entry. */
export function alertIcon(e) {
  if (e.type === 'loss' || e.kind === 'theft') return 'droplet-off';
  switch (e.kind) {
    case 'speeding': return 'gauge';
    case 'refill':   return 'gas-station';
    case 'stop':     return 'player-pause';
    case 'dispatch': return 'truck-delivery';
    case 'fault':    return 'plug-connected-x';
    case 'zone':     return /restricted/i.test(`${e.title} ${e.body ?? ''}`) ? 'hand-stop' : 'map-pin';
    default:         return e.severity === 'critical' ? 'alert-octagon' : e.severity === 'warning' ? 'alert-triangle' : 'bell';
  }
}

/**
 * Consecutive alerts saying the same thing become one entry carrying every
 * time it was said (`times`, newest first as the list is). Only plain alerts
 * fold — a loss is already one entry per loss — and never stops: each stop
 * is its own span of time, and two that lasted "6 min" are two stops, not
 * one stop said twice. Exported for the test.
 */
export function foldRepeats(entries) {
  const out = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (e.type === 'alert' && prev?.type === 'alert' && e.kind !== 'stop'
        && prev.title === e.title && (prev.body ?? '') === (e.body ?? '')
        && prev.severity === e.severity && prev.litres == null && e.litres == null) {
      prev.times.push(e.t);
      continue;
    }
    out.push(e.type === 'alert' ? { ...e, times: [e.t] } : e);
  }
  return out;
}

/** "3 critical · 1 warning", or the plain count when nothing is severe. */
function daySummary(entries) {
  const n = { critical: 0, warning: 0, info: 0 };
  for (const e of entries) n[e.severity] = (n[e.severity] ?? 0) + (e.times?.length ?? 1);
  const parts = [];
  if (n.critical) parts.push(`${n.critical} critical`);
  if (n.warning) parts.push(`${n.warning} warning${n.warning === 1 ? '' : 's'}`);
  if (!parts.length) { const all = n.critical + n.warning + n.info; return `${all} ${all === 1 ? 'event' : 'events'}`; }
  if (n.info) parts.push(`${n.info} other`);
  return parts.join(' · ');
}

function Entry({ e }) {
  const [open, setOpen] = useState(false);
  const loss = e.type === 'loss';
  const repeats = e.times?.length > 1 ? e.times : null;
  // A loss says where it has got to: its latest report by name, or by time
  // where that report is called what the loss is ("Fuel drop seen" twice)
  const latest = !loss || !e.latest ? null
    : e.latest.title === e.title ? `Latest report ${HHMM.format(e.latest.t)}`
    : `${e.latest.title} · ${HHMM.format(e.latest.t)}`;
  const summary = loss ? [latest, `${e.reports.length} reports`].filter(Boolean).join(' · ') : e.body;
  const canOpen = loss || Boolean(repeats) || (e.body?.length ?? 0) > 90;

  const head = (<>
    <span className="af-dot" aria-hidden="true"><i className={`ti ti-${alertIcon(e)}`} /></span>
    <span className="af-main">
      <span className="af-head">
        {!loss && e.tag && <span className="af-tag">{e.tag}</span>}
        <span className="af-title">{e.title}</span>
        {e.litres != null && <span className="af-litres">{litresText(e.litres)}</span>}
        {repeats && <span className="af-times" title={`${repeats.length} times`}>×{repeats.length}</span>}
        <time className="af-time" dateTime={new Date(e.t).toISOString()}>{HHMM.format(e.t)}</time>
      </span>
      {summary && <span className={`af-sum${open && !loss ? ' af-sum--full' : ''}`}>{summary}</span>}
    </span>
    {canOpen && <i className={`ti ti-chevron-down af-caret${open ? ' af-caret--open' : ''}`} aria-hidden="true" />}
  </>);

  return (
    <li className={`af-entry af-entry--${e.severity}${open ? ' af-entry--open' : ''}`}>
      <span className="af-sr">{SEVERITY_WORD[e.severity]}</span>
      {canOpen
        ? <button type="button" className="af-row" aria-expanded={open} onClick={() => setOpen(o => !o)}>{head}</button>
        : <div className="af-row">{head}</div>}
      {loss && open && (
        <ol className="af-reports" aria-label="Reports of this loss">
          {e.reports.map((r, i) => (
            <li key={`${r.t}-${i}`} className="af-report">
              <span className="af-report-time">{HHMM.format(r.t)}</span>
              <span className="af-report-main">
                <span className="af-report-title">{r.title}</span>
                {r.body && <span className="af-report-body">{r.body}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {repeats && open && (
        <ol className="af-reports af-reports--times" aria-label="Each time this was raised">
          {repeats.map((t, i) => (
            <li key={`${t}-${i}`} className="af-chip">{HHMM.format(t)}</li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * `events` as the playback route gives them; `unitName` is taken off the
 * front of each sentence, since the panel is already about that unit.
 */
export default function AlertsFeed({ events, unitName }) {
  const days = useMemo(
    () => alertFeed(events, unitName).map(d => ({ ...d, entries: foldRepeats(d.entries) })),
    [events, unitName],
  );
  return (
    <div className="af">
      {days.map(d => (
        <section key={d.day} className="af-day" aria-label={DAY.format(new Date(`${d.day}T00:00:00Z`))}>
          <header className="af-day-head">
            <span>{DAY.format(new Date(`${d.day}T00:00:00Z`))}</span>
            <span className="af-day-count">{daySummary(d.entries)}</span>
          </header>
          <ul className="af-list">
            {d.entries.map((e, i) => <Entry key={`${e.type}-${e.t}-${i}`} e={e} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}
