/*
 * Edit, on any report (operator, 4 Nov 2026: "make all pdf editable just like end
 * of shift"): the report opens as the sheet End of Shift edits (ShiftDocument),
 * every text on it changed by clicking into it, rows and sections left out, notes
 * added. A report nobody edited keeps its own PDF; an edited one is drawn from
 * the sheet (POST reports/document.pdf).
 *
 * `source` is what the report was made from: a new one starts the sheet over, so
 * anything that replaces it goes through `guard` first.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { isEdited, pdfDoc } from '../../lib/shiftDoc';
import { makeReportDoc } from '../../api/reports';
import ShiftDocument from './ShiftDocument';

export function useReportEditor({ orgId, source, build }) {
  const [sheet, setSheet] = useState({ original: null, doc: null, version: 0 });
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);           // { words, go }
  const [problem, setProblem] = useState(null);
  const edited = isEdited(sheet.original, sheet.doc);

  useEffect(() => {
    setSheet((s) => ({ original: null, doc: null, version: s.version + 1 }));
    setOpen(false);
    setProblem(null);
  }, [source]);

  // Closing or reloading the browser tab would lose the edits: the browser asks first.
  useEffect(() => {
    if (!edited) return undefined;
    const warn = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [edited]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const startEditing = () => {
    if (sheet.doc) { setOpen(true); return; }
    try {
      const doc = build();
      setSheet((s) => ({ ...s, original: doc, doc }));
      setProblem(null);
      setOpen(true);
    } catch (err) {
      setProblem(`The report could not be opened to edit: ${err?.message ?? err}`);
    }
  };
  const undo = () => setSheet((s) => ({ ...s, doc: s.original, version: s.version + 1 }));
  const guard = (words, go) => (edited ? setConfirm({ words, go }) : go());
  /** The edited PDF: `{ blob, filename }`. A report made for its side stays on its side. */
  const make = (landscape = false) => makeReportDoc({ orgId, doc: pdfDoc(sheet.doc), landscape: landscape || Boolean(sheet.doc.landscape) });

  const button = (
    <>
      {problem && <span className="rpt-warn">{problem}</span>}
      {edited && <button type="button" className="sp4-ghost-btn" onClick={undo}>Undo edits</button>}
      <button type="button" className="sp4-ghost-btn" onClick={startEditing}
              title="Change any text on the report, leave rows or sections out, add notes">
        <i className="ti ti-pencil" aria-hidden="true" /> {edited ? 'Edited' : 'Edit'}
      </button>
    </>
  );

  const land = Boolean(sheet.doc?.landscape);
  const overlay = (
    <>
      {confirm && (
        <div className="mvr-confirm" role="alertdialog" aria-labelledby="rde-confirm-words">
          <span id="rde-confirm-words">{confirm.words} and lose your edits?</span>
          <button type="button" className="sp4-ghost-btn rpt-log" onClick={() => setConfirm(null)} autoFocus>Keep editing</button>
          <button type="button" className="sp4-submit-btn frp-run mvr-confirm__go"
                  onClick={() => { const { go } = confirm; setConfirm(null); go(); }}>Discard edits</button>
        </div>
      )}
      {open && sheet.doc && createPortal(
        <div className="sp4-modal-overlay sdoc-open" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className={`sdoc-open__frame${land ? ' sdoc-open__frame--land' : ''}`} role="dialog" aria-modal="true" aria-labelledby="rde-title">
            <header className="mvr-pv__head sdoc-open__head">
              <i className="ti ti-file-text mvr-pv__icon" aria-hidden="true" />
              <div className="mvr-pv__what">
                <h2 id="rde-title" className="mvr-pv__title">{sheet.doc.docName ?? sheet.doc.title}</h2>
                <p className="mvr-pv__facts"><span>Click any text to change it. The PDF and JPEG are drawn from this sheet.</span></p>
              </div>
              <button type="button" className="sp4-submit-btn frp-run mvr-pv__save" onClick={() => setOpen(false)} autoFocus>
                <i className="ti ti-check" aria-hidden="true" /> Done
              </button>
            </header>
            <div className="sdoc-open__scroll" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
              <div className={`sdoc-open__sheet${land ? ' sdoc-open__sheet--land' : ''}`}>
                <ShiftDocument key={sheet.version} doc={sheet.doc} onChange={(doc) => setSheet((s) => ({ ...s, doc }))} />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );

  return { edited, make, guard, button, overlay, doc: sheet.doc };
}
