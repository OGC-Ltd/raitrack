// A dropdown of things to tick, for a report's filter bar (the Geofence
// Report's organisations and geofences): a field showing what is picked, and
// a list of boxes under it, All and Clear at the top. Styled as the
// Movements type picker (mvr-types).
//
// `picked` null means every one; ticking boxes makes a list.

import { useEffect, useMemo, useRef, useState } from 'react';

const SHOW_MAX = 300;

export default function CheckPicker({ icon, label, options, picked, onChange, noun = 'items', allWord = 'All', search = false, minOne = false, noAll = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);
  const values = options.map((o) => o.value);
  const set = new Set(picked ?? values);
  const all = picked == null || values.every((v) => set.has(v));
  const text = !options.length ? `No ${noun}`
    : all ? `${allWord} (${options.length})`
      : !set.size ? `No ${noun}`
        : set.size === 1 ? options.find((o) => set.has(o.value))?.label ?? `1 of ${options.length}`
          : `${set.size} of ${options.length} ${noun}`;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // A long list (thousands of geofences) shows what is ticked first and stops at
  // SHOW_MAX; typing finds the rest
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hits = s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
    const ticked = picked ? new Set(picked) : null;
    const ordered = ticked && !s ? [...hits.filter((o) => ticked.has(o.value)), ...hits.filter((o) => !ticked.has(o.value))] : hits;
    return ordered.slice(0, SHOW_MAX);
  }, [options, q, picked]);
  const more = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? options.filter((o) => o.label.toLowerCase().includes(s)).length : options.length) - SHOW_MAX;
  }, [options, q]);

  const toggle = (v) => {
    const next = set.has(v) ? values.filter((x) => set.has(x) && x !== v) : values.filter((x) => set.has(x) || x === v);
    if (minOne && !next.length) return;
    onChange(next.length === values.length ? null : next);
  };

  return (
    <div className="drp mvr-types gfr-pick" ref={rootRef}>
      <button type="button" className={`drp-field${open ? ' drp-field--open' : ''}`}
              onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}
              aria-label={`${label}: ${text}`} disabled={!options.length}>
        {icon && <i className={`ti ${icon}`} aria-hidden="true" />}
        <span className="drp-text mvr-types__v">{text}</span>
        <i className="ti ti-chevron-down drp-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="drp-pop mvr-types__pop" role="group" aria-label={label}>
          <div className="drp-quick">
            {!noAll && <button type="button" className={`drp-chip${all ? ' drp-chip--on' : ''}`} onClick={() => onChange(null)}>{allWord}</button>}
            {!minOne && <button type="button" className="drp-chip" onClick={() => onChange([])} disabled={!set.size}>Clear</button>}
          </div>
          {search && options.length > 8 && (
            <input type="search" className="rpt-select gfr-pick__q" placeholder={`Find ${noun}`} value={q} autoFocus
                   onChange={(e) => setQ(e.target.value)} aria-label={`Find ${noun}`} />
          )}
          <ul className="mvr-types__list">
            {shown.map((o) => (
              <li key={o.value}>
                <button type="button" role="menuitemcheckbox" aria-checked={set.has(o.value)}
                        className={`mvr-type${set.has(o.value) ? ' mvr-type--on' : ''}`} onClick={() => toggle(o.value)}>
                  <span className="mvr-type__box" aria-hidden="true"><i className="ti ti-check" /></span>
                  <span className="mvr-type__name">{o.label}</span>
                  {o.note != null && <span className="mvr-type__n">{o.note}</span>}
                </button>
              </li>
            ))}
            {!shown.length && <li className="drp-hint">Nothing matches.</li>}
            {more > 0 && <li className="drp-hint">{more.toLocaleString('en-GB')} more: type to find them.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
