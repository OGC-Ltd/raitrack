// The end-of-shift report painted as the page it prints as (operator,
// 2026-11-02): an A4 sheet with the report's title, details and sections, in
// which every text can be changed by clicking into it, a row or a whole
// section left out, a note added under a section and the handover written in.
// What is on the sheet is what the PDF draws (lib/shiftDoc, fleet-server
// end-of-shift.pdf renderShiftDoc).

import { setAt, removeRow, removeSection, removeBlock, addNote } from '../../lib/shiftDoc';
import './ShiftDocument.css';

/**
 * A text on the sheet the operator can change. The new text is kept when they
 * leave it (blur); Enter leaves a one-line text, pasting brings plain text only.
 */
function Ed({ value, onChange, label, placeholder, block = false, className = '' }) {
  const Tag = block ? 'div' : 'span';
  return (
    <Tag className={`sdoc-ed${block ? ' sdoc-ed--block' : ''} ${className}`} contentEditable suppressContentEditableWarning
         role="textbox" aria-label={label} aria-multiline={block || undefined} data-placeholder={placeholder} spellCheck
         onBlur={(e) => { const t = e.currentTarget.innerText.replace(/\n+$/, ''); if (t !== value) onChange(t); }}
         onKeyDown={(e) => { if (e.key === 'Enter' && !block) { e.preventDefault(); e.currentTarget.blur(); } }}
         onPaste={(e) => {
           e.preventDefault();
           const text = e.clipboardData.getData('text/plain');
           document.execCommand('insertText', false, block ? text : text.replace(/\s*\n\s*/g, ' '));
         }}>
      {value}
    </Tag>
  );
}

const toneClass = (c) => [c.bold ? 'sdoc-b' : '', c.tone ? `sdoc-${c.tone}` : ''].filter(Boolean).join(' ') || undefined;

/** The printed body's width, mm: A4 less its margins, and half of it less the gap. */
const BODY_MM = 184;
const HALF_MM = (BODY_MM - 6) / 2;

function Table({ t, path, doc, onChange, half = false }) {
  const set = (p, v) => onChange(setAt(doc, [...path, ...p], v));
  // The PDF's column widths as shares of the sheet, so it fits whatever its width on screen.
  const basis = half ? HALF_MM : BODY_MM;
  const fixed = t.cols.reduce((n, c) => n + (c.w || 0), 0);
  const flexCols = t.cols.filter((c) => !c.w).length;
  const share = (c) => (c.w ? (c.w / basis) * 100 : Math.max(0, (basis - fixed) / basis * 100) / (flexCols || 1));
  return (
    <div className="sdoc-tablewrap">
      <table className={`sdoc-table${half ? ' sdoc-table--half' : ''}`}>
        <colgroup>
          {t.cols.map((c, i) => <col key={i} style={{ width: `${share(c)}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            {t.head.map((h, i) => (
              <th key={i} style={{ textAlign: t.cols[i]?.align ?? 'left' }}>
                <Ed value={h} label={`Column ${i + 1} heading`} onChange={(v) => set(['head', i], v)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => (
                <td key={i} className={toneClass(c)} style={{ textAlign: t.cols[i]?.align ?? 'left' }}>
                  <Ed value={c.text} label={`${t.head[i] ?? 'Cell'}, row ${r + 1}`} onChange={(v) => set(['rows', r, i, 'text'], v)} />
                  {i === row.length - 1 && (
                    <button type="button" className="sdoc-x sdoc-x--row" title="Leave this row out" aria-label={`Leave row ${r + 1} out`}
                            onClick={() => onChange(removeRow(doc, path, r))}>
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ b, i, doc, onChange }) {
  const set = (p, v) => onChange(setAt(doc, ['blocks', i, ...p], v));
  switch (b.kind) {
    case 'h2':
      return (
        <div className="sdoc-h2">
          <Ed value={b.title} label="Section heading" className="sdoc-h2__t" onChange={(v) => set(['title'], v)} />
          {b.aside != null && <Ed value={b.aside} label="Section aside" className="sdoc-aside" onChange={(v) => set(['aside'], v)} />}
          <span className="sdoc-h2__tools">
            <button type="button" className="sdoc-tool" onClick={() => onChange(addNote(doc, i).doc)}>
              <i className="ti ti-plus" aria-hidden="true" />Note
            </button>
            <button type="button" className="sdoc-tool" onClick={() => onChange(removeSection(doc, i))}>
              <i className="ti ti-trash" aria-hidden="true" />Leave out
            </button>
          </span>
        </div>
      );
    case 'h3':
      return (
        <div className="sdoc-h3">
          <Ed value={b.title} label="Sub-heading" className="sdoc-b" onChange={(v) => set(['title'], v)} />
          {b.aside ? <Ed value={b.aside} label="Sub-heading aside" className="sdoc-aside" onChange={(v) => set(['aside'], v)} /> : null}
        </div>
      );
    case 'figures':
      return (
        <div className="sdoc-figs">
          {b.items.map((f, k) => (
            <div key={k} className="sdoc-fig">
              <Ed value={f.label} label="Figure name" className="sdoc-mut" onChange={(v) => set(['items', k, 'label'], v)} />
              <Ed value={f.value} label={f.label} className={`sdoc-fig__v${f.flag ? ' sdoc-flag' : ''}`} onChange={(v) => set(['items', k, 'value'], v)} />
            </div>
          ))}
        </div>
      );
    case 'table':
      return <Table t={b} path={['blocks', i]} doc={doc} onChange={onChange} />;
    case 'none':
      return <Ed block value={b.text} label="Line" className="sdoc-none" onChange={(v) => set(['text'], v)} />;
    case 'note':
      return (
        <div className="sdoc-note">
          <Ed block value={b.text} label="Note" placeholder="Write a note" onChange={(v) => set(['text'], v)} />
          <button type="button" className="sdoc-x" title="Remove this note" aria-label="Remove this note"
                  onClick={() => onChange(removeBlock(doc, i))}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      );
    case 'pair':
      return (
        <div className="sdoc-pair">
          {b.halves.map((h, k) => (
            <div key={k} className="sdoc-pair__half">
              <div className="sdoc-h3">
                <Ed value={h.title} label="Sub-heading" className="sdoc-b" onChange={(v) => set(['halves', k, 'title'], v)} />
                {h.aside ? <Ed value={h.aside} label="Sub-heading aside" className="sdoc-aside" onChange={(v) => set(['halves', k, 'aside'], v)} /> : null}
              </div>
              {h.body.kind === 'table'
                ? <Table t={h.body} path={['blocks', i, 'halves', k, 'body']} doc={doc} onChange={onChange} half />
                : <Ed block value={h.body.text} label="Line" className="sdoc-none" onChange={(v) => set(['halves', k, 'body', 'text'], v)} />}
            </div>
          ))}
        </div>
      );
    case 'handover':
      return (
        <div className="sdoc-handover">
          {b.lines.map((l, k) => (
            <Ed key={k} value={l} label={`Handover line ${k + 1}`} placeholder={k === 0 ? 'Write the handover here, or leave it for pen' : ''}
                className="sdoc-handover__line" onChange={(v) => set(['lines', k], v)} />
          ))}
          <div className="sdoc-signs">
            {b.signatures.map((s, k) => (
              <div key={k} className="sdoc-sign">
                <Ed value={s} label="Signature line" className="sdoc-mut" onChange={(v) => set(['signatures', k], v)} />
              </div>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

export default function ShiftDocument({ doc, onChange }) {
  return (
    <article className="sdoc" aria-label="End of shift report, editable">
      <header className="sdoc-head">
        <Ed value={doc.title} label="Title" className="sdoc-title" onChange={(v) => onChange(setAt(doc, ['title'], v))} />
        <span className="sdoc-no">Report no. {doc.reportNo} · Date {doc.date}</span>
      </header>
      <dl className="sdoc-meta">
        {doc.meta.map((m, k) => (
          <div key={k}>
            <dt>{m.label}</dt>
            <dd><Ed value={m.value} label={m.label} className="sdoc-b" onChange={(v) => onChange(setAt(doc, ['meta', k, 'value'], v))} /></dd>
          </div>
        ))}
      </dl>
      {doc.blocks.map((b, i) => <Block key={`${i}-${b.kind}`} b={b} i={i} doc={doc} onChange={onChange} />)}
      <footer className="sdoc-foot">{doc.footer}</footer>
    </article>
  );
}
