/*
 * The JPEG button every report shares (operator, 4 Nov 2026: "all jpeg should
 * have the option for portrait or landscape"). Pressing it asks which way up
 * the pages lie, then calls `onSave(landscape)`. `word` and `icon` make it the
 * same choice for a PDF (operator, 5 Nov 2026).
 */

import { useEffect, useRef, useState } from 'react';
import './JpegButton.css';

const CHOICES = [
  { landscape: false, label: 'Portrait', icon: 'ti-rectangle-vertical', note: 'Upright A4 pages' },
  { landscape: true, label: 'Landscape', icon: 'ti-rectangle', note: 'Wide pages, more room per row' },
];

export default function JpegButton({ onSave, disabled, busy, word = 'JPEG', icon = 'ti-photo', className = 'sp4-ghost-btn', title = 'The PDF report as an image' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const pick = (landscape) => { setOpen(false); onSave(landscape); };

  return (
    <span className="jpg-btn" ref={box}>
      <button type="button" className={className} onClick={() => setOpen((o) => !o)} disabled={disabled}
              aria-haspopup="menu" aria-expanded={open} aria-busy={busy || undefined} title={title}>
        <i className={`ti ${icon}`} aria-hidden="true" /> {busy ? `Making the ${word}…` : word}
        <i className="ti ti-chevron-down jpg-btn__caret" aria-hidden="true" />
      </button>
      {open && (
        <span className="jpg-btn__pop" role="menu" aria-label="Page orientation">
          {CHOICES.map((c, i) => (
            <button key={c.label} type="button" role="menuitem" className="jpg-btn__item" autoFocus={i === 0}
                    onClick={() => pick(c.landscape)}>
              <i className={`ti ${c.icon}`} aria-hidden="true" />
              <span><b>{c.label}</b><small>{c.note}</small></span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
