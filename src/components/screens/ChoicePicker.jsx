import { useEffect, useRef, useState } from 'react';

/**
 * One choice from a short list (a group, a consumption unit), in the field and
 * card the Type list uses (operator, 2 Nov: "the drop down list on each node
 * to match that in the movements"): the picked one ticked, with what it holds
 * beside it where there is something real to say.
 */
export default function ChoicePicker({ icon, label, value, options, onChange, align = 'left', search = false }) {
  const [open, setOpen] = useState(false);
  // A long list (a fleet's units) takes a search box: typed words narrow it
  const [term, setTerm] = useState('');
  useEffect(() => { if (!open) setTerm(''); }, [open]);
  const needle = term.trim().toLowerCase().replace(/\s+/g, '');
  const listed = needle ? options.filter((o) => o.value == null || String(o.label).toLowerCase().replace(/\s+/g, '').includes(needle)) : options;
  const rootRef = useRef(null);
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
  const picked = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className={`drp drp--${align} mvr-types`} ref={rootRef}>
      <button type="button" className={`drp-field${open ? ' drp-field--open' : ''}`}
              onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}
              aria-label={`${label}: ${picked.label}`}>
        <i className={`ti ${icon}`} aria-hidden="true" />
        <span className="drp-text mvr-types__v">{picked.label}</span>
        <i className="ti ti-chevron-down drp-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="drp-pop mvr-types__pop" role="listbox" aria-label={label}>
          {search && (
            <input className="sp4-search mvr-types__search" type="text" placeholder={`Search ${label.toLowerCase()}…`}
                   aria-label={`Search ${label.toLowerCase()}`} value={term} autoFocus onChange={(e) => setTerm(e.target.value)} />
          )}
          <ul className="mvr-types__list">
            {listed.map((o) => {
              const on = o.value === value;
              return (
                <li key={String(o.value)}>
                  <button type="button" role="option" aria-selected={on}
                          className={`mvr-type mvr-type--one${on ? ' mvr-type--on' : ''}`}
                          onClick={() => { onChange(o.value); setOpen(false); }}>
                    <span className="mvr-type__name">{o.label}</span>
                    {o.note != null && <span className="mvr-type__n">{o.note}</span>}
                    <i className="ti ti-check mvr-type__tick" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
