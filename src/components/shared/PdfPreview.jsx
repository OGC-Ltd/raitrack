// The PDF preview the reports share (Movements, Driver Conduct and the other
// letterhead reports, Tankers): moved out of ReportsScreen, 4 Nov 2026. Its
// styles are ReportsScreen.css's mvr-pv rules, loaded with the Reports page.

import { useEffect, useState } from 'react';
import PdfPages from './PdfPages';
import { saveFile } from '../../api/tripReport';

/** Prints a PDF from a frame of its own, out of sight, that goes once it has printed. */
function printPdf(url) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = url;
  f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 60_000); };
  document.body.appendChild(f);
}
const kb = (bytes) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/**
 * The PDF as the server makes it, edits and all, shown on the page before it
 * is saved (operator, 2 Nov: "add a pdf preview"). Download saves this same
 * file, so what was looked at is what is filed.
 *
 * It opens at once and is made inside it. The pages are drawn to fill the
 * window's width (shared/PdfPages), not left to the browser's PDF viewer,
 * whose zoom differs from one browser to another; print, a tab of its own and
 * download sit in the head with what the file is: its window, pages, size and
 * edits.
 */
export default function PdfPreview({ state, title = 'Movement report', caption, edited, onRetry, onClose }) {
  const [url, setUrl] = useState(null);
  const [pages, setPages] = useState(null);
  const [drawError, setDrawError] = useState(null);
  const file = state.status === 'done' ? state : null;
  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    setPages(null);
    setDrawError(null);
    return () => { URL.revokeObjectURL(u); setUrl(null); };
  }, [file]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const facts = [caption,
    pages && `${pages} page${pages === 1 ? '' : 's'}`,
    file && kb(file.blob.size),
    edited > 0 && `${edited} edit${edited === 1 ? '' : 's'} included`].filter(Boolean);
  return (
    <div className="sp4-modal-overlay mvr-pv-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mvr-pv" role="dialog" aria-modal="true" aria-labelledby="mvr-pv-title" aria-describedby="mvr-pv-facts">
        <header className="mvr-pv__head">
          <i className="ti ti-file-type-pdf mvr-pv__icon" aria-hidden="true" />
          <div className="mvr-pv__what">
            <h2 id="mvr-pv-title" className="mvr-pv__title">{title}</h2>
            <p id="mvr-pv-facts" className="mvr-pv__facts">
              {facts.map((f, i) => <span key={i}>{f}</span>)}
            </p>
          </div>
          <div className="mvr-pv__tools">
            <button type="button" className="mvr-pv__tool" disabled={!url} title="Print"
                    onClick={() => printPdf(url)}>
              <i className="ti ti-printer" aria-hidden="true" /><span className="mvr-sr">Print</span>
            </button>
            <a className={`mvr-pv__tool${url ? '' : ' is-off'}`} href={url ?? undefined} target="_blank" rel="noreferrer"
               title="Open in a tab of its own" aria-disabled={!url}>
              <i className="ti ti-external-link" aria-hidden="true" /><span className="mvr-sr">Open in a new tab</span>
            </a>
            <button type="button" className="sp4-submit-btn frp-run mvr-pv__save" disabled={!file} autoFocus
                    onClick={() => saveFile(file.blob, file.filename)}>
              <i className="ti ti-download" aria-hidden="true" /> Download
            </button>
            <button type="button" className="sp4-modal-x mvr-pv__x" onClick={onClose} aria-label="Close the preview">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="mvr-pv__desk" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && (
            <div className="mvr-pv__note" role="status">
              <span className="mvr-pv__sheet" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              Making the PDF…
            </div>
          )}
          {state.status === 'error' && (
            <div className="mvr-pv__note mvr-pv__note--error" role="alert">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span>The PDF could not be made: {state.message}</span>
              <button type="button" className="sp4-ghost-btn" onClick={onRetry}>Try again</button>
            </div>
          )}
          {file && !drawError && (
            <PdfPages blob={file.blob} gutter={0} onLoad={setPages} onError={(err) => setDrawError(err?.message ?? String(err))} />
          )}
          {drawError && (
            <div className="mvr-pv__note mvr-pv__note--error" role="alert">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <span>The PDF was made but could not be shown here: {drawError}. Download or open it in a tab.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
