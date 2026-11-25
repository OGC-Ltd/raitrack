// A PDF being made, shown in the corner (operator, 17 Nov 2026: "a progress
// bar rather than a frozen screen ... actual progress, maybe in percentage
// ... and the report continue while someone is working on something else").
//
// Not a window over the page: a small panel at the bottom right, so the page
// stays usable while a worker makes the file. It shows the percentage, what
// it is on ("2,960 of 7,049 rows") and a Cancel; it says when the file is
// ready, then goes. Plain DOM, so any screen can raise it with nothing to
// mount, and it outlives the screen that started it.

const STYLE_ID = 'pdfp-style';
const CSS = `
.pdfp { position: fixed; right: 16px; bottom: 16px; z-index: 10000; width: min(320px, calc(100vw - 32px));
  padding: 12px 14px; border-radius: 10px; background: #fff; color: #0f172a; border: 1px solid #e2e8f0;
  box-shadow: 0 10px 30px rgba(15, 23, 42, .18); font: 500 12.5px/1.4 Inter, system-ui, sans-serif; }
.pdfp__top { display: flex; align-items: baseline; gap: 8px; }
.pdfp__title { margin: 0; font-size: 13px; font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdfp__pct { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; color: #0369a1; }
.pdfp__track { margin-top: 8px; height: 6px; border-radius: 3px; background: #e2e8f0; overflow: hidden; }
.pdfp__bar { height: 100%; width: 0; border-radius: 3px; background: #0369a1; transition: width .25s ease; }
.pdfp__foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.pdfp__words { flex: 1; min-width: 0; color: #475569; font-size: 12px; font-variant-numeric: tabular-nums; }
.pdfp__btn { border: 0; background: none; padding: 2px 4px; color: #475569; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 4px; }
.pdfp__btn:hover { color: #0f172a; background: #f1f5f9; }
.pdfp--done .pdfp__bar { background: #15803d; }
.pdfp--done .pdfp__pct { color: #15803d; }
.pdfp--failed .pdfp__bar { background: #b91c1c; width: 100%; }
.pdfp--failed .pdfp__pct { color: #b91c1c; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .pdfp { background: #0f172a; color: #e2e8f0; border-color: #1e293b; }
  :root:not([data-theme="light"]) .pdfp__track { background: #1e293b; }
  :root:not([data-theme="light"]) .pdfp__words, :root:not([data-theme="light"]) .pdfp__btn { color: #94a3b8; }
}
:root[data-theme="dark"] .pdfp { background: #0f172a; color: #e2e8f0; border-color: #1e293b; }
:root[data-theme="dark"] .pdfp__track { background: #1e293b; }
:root[data-theme="dark"] .pdfp__words, :root[data-theme="dark"] .pdfp__btn { color: #94a3b8; }
@media (prefers-reduced-motion: reduce) { .pdfp__bar { transition: none; } }
`;

/** Lets the browser paint before the next step. */
export const paint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * @param {string} title  what is being made, "Weighbridge Tickets: FACTORY"
 * @param {{ onCancel?: () => void, kind?: string }} [o]  `kind`: the file's kind in the title, PDF by default
 * @returns {{ update: (share: number, words: string) => void, done: (words: string) => void,
 *   fail: (words: string) => void, close: () => void }}
 */
export function showPdfProgress(title, { onCancel, kind = 'PDF' } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'pdfp';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="pdfp__top"><p class="pdfp__title"></p><span class="pdfp__pct">0%</span></div>'
    + '<div class="pdfp__track"><div class="pdfp__bar"></div></div>'
    + '<div class="pdfp__foot"><span class="pdfp__words"></span><button type="button" class="pdfp__btn">Cancel</button></div>';
  el.querySelector('.pdfp__title').textContent = `${kind}: ${title}`;
  const pct = el.querySelector('.pdfp__pct');
  const bar = el.querySelector('.pdfp__bar');
  const words = el.querySelector('.pdfp__words');
  const btn = el.querySelector('.pdfp__btn');
  let finished = false;
  const close = () => el.remove();
  btn.addEventListener('click', () => { if (!finished) onCancel?.(); close(); });
  document.body.appendChild(el);

  const set = (share, text) => {
    const p = Math.round(Math.max(0, Math.min(1, share)) * 100);
    pct.textContent = `${p}%`;
    bar.style.width = `${p}%`;
    words.textContent = text ?? '';
  };
  return {
    update: set,
    done(text) {
      finished = true;
      el.classList.add('pdfp--done');
      set(1, text);
      btn.textContent = 'Close';
      setTimeout(close, 4000);
    },
    fail(text) {
      finished = true;
      el.classList.add('pdfp--failed');
      pct.textContent = '!';
      words.textContent = text;
      btn.textContent = 'Close';
    },
    close,
  };
}
