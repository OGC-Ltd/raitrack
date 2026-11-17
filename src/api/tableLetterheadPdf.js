// A table export as a letterhead PDF, made in the background (operator,
// 17 Nov 2026: 7,049 weighbridge tickets froze the page; "actual progress in
// percentage ... and the report continue while someone is working on
// something else").
//
// The report is turned into plain data here (lib/tableLetterhead
// tableLetterheadSpec, quick), then drawn into a PDF by a worker
// (workers/letterheadTablePdf.worker → lib/letterheadTablePdf): off the
// page's thread, so the page never stops answering and the reader can go on
// working. A panel in the corner shows the percentage and can cancel; the
// file downloads itself when it is ready.

import { tableLetterheadSpec } from '../lib/tableLetterhead';
import { letterheadLogos } from './letterheadPdf';
import { showPdfProgress, paint } from '../lib/pdfProgress';

/** Reports being made, by title: a second click on the same one is not a second job. */
const running = new Set();
let logosOnce = null;

/** A logo as the worker needs it: a data URL, its format, and width over height. */
async function logoData(url, format) {
  const blob = await (await fetch(url)).blob();
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const ratio = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight));
    img.onerror = () => resolve(1);
    img.src = data;
  });
  return { data, format, ratio };
}

/** Both logos, read once a session. A logo that cannot be read is left off, not the report. */
function loadLogos() {
  if (!logosOnce) {
    const { rai, ogc } = letterheadLogos();
    logosOnce = Promise.all([
      logoData(rai, 'JPEG').catch(() => null),
      logoData(ogc, 'PNG').catch(() => null),
    ]).then(([r, o]) => ({ ...(r ? { rai: r } : {}), ...(o ? { ogc: o } : {}) }));
  }
  return logosOnce;
}

function save(buffer, filename) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * @param {Parameters<typeof tableLetterheadSpec>[0]} o  as downloadTablePdf's, with the organisation
 *   (companyName, orgCode) and a report-number `prefix`
 */
export async function downloadLetterheadTablePdf(o) {
  const key = `${o.reportTitle}|${o.sectionTitle}`;
  if (running.has(key)) return;
  running.add(key);
  let worker = null;
  let cancelled = false;
  const rows = o.body?.length ?? 0;
  const progress = showPdfProgress(o.reportTitle, {
    onCancel: () => { cancelled = true; worker?.terminate(); running.delete(key); },
  });
  progress.update(0, `Preparing ${rows.toLocaleString('en-GB')} row${rows === 1 ? '' : 's'}…`);
  try {
    await paint();
    const [spec, logos] = await Promise.all([Promise.resolve().then(() => tableLetterheadSpec(o)), loadLogos()]);
    if (cancelled) return;
    worker = new Worker(new URL('../workers/letterheadTablePdf.worker.js', import.meta.url), { type: 'module' });
    const buffer = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data: m }) => {
        if (m.type === 'progress') {
          // Rows are most of the work: 2% to start, the rows to 95%, saving the last
          const share = m.phase === 'Saving' ? 0.97 : m.total ? 0.02 + 0.93 * (m.done / m.total) : 0.02;
          const words = m.phase === 'Saving' ? 'Saving the file…'
            : m.total ? `${m.done.toLocaleString('en-GB')} of ${m.total.toLocaleString('en-GB')} rows` : 'Starting…';
          progress.update(share, words);
        } else if (m.type === 'done') resolve(m.buffer);
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The PDF could not be made'));
      worker.postMessage({ spec, logos });
    });
    if (cancelled) return;
    save(buffer, spec.filename);
    progress.done('Ready: the file has downloaded');
  } catch (err) {
    if (cancelled) return;
    console.error('Letterhead PDF failed', err);
    progress.fail('The PDF could not be made. Please try again.');
  } finally {
    worker?.terminate();
    running.delete(key);
  }
}
