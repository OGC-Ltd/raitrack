// A letterhead report (lib/letterhead) into a PDF: the page is laid out in an
// off-screen frame, its own script deals the flow onto A4 pages, and each page
// is drawn into the PDF as one image. The same route the End of shift report
// took, so the two come out looking alike. The JPEG takes the same pages,
// drawn sharper and straight to the image (api/pdfJpeg).

import raiLogo from '../assets/rai-group-logo.jpeg';
import ogcLogo from '../assets/ogc-monitoring-logo.png';
import { savePagesAsJpeg } from './pdfJpeg';

/** The logos as absolute URLs: the frame's document has no base of its own. */
export const letterheadLogos = () => ({
  rai: new URL(raiLogo, window.location.href).href,
  ogc: new URL(ogcLogo, window.location.href).href,
});

const PDF_SCALE = 2.2;
// The JPEG is looked at zoomed in, on a phone: an A4 page 2382 px wide (~290 dpi)
const JPEG_SCALE = 3;
/** A report longer than this many pages is drawn at LONG_SCALE: readable, and a fraction of the work. */
const LONG_PAGES = 25;
const LONG_SCALE = 1.6;
/** Lets the browser paint between pages, so it stays responsive and the progress shows. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Waits for the frame's pager to finish (it sets data-pages on the body). A page
 * with no pager (continuous) has nothing to wait for.
 */
function pagesDealt(doc, limitMs = 120_000) {
  if (!doc.getElementById('flow') || doc.body.hasAttribute('data-pages')) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { mo.disconnect(); clearTimeout(timer); resolve(); };
    const mo = new MutationObserver(() => { if (doc.body.hasAttribute('data-pages')) done(); });
    mo.observe(doc.body, { attributes: true, attributeFilter: ['data-pages'] });
    const timer = setTimeout(() => { mo.disconnect(); reject(new Error('The report page could not be laid out.')); }, limitMs);
  });
}

/** A page's JPEG bytes, encoded off the page's thread (toBlob), not as a data URL. */
function jpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b
    ? b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
    : reject(new Error('The page could not be drawn.'))), 'image/jpeg', quality));
}

/** The tallest image a browser will draw, with room to spare. */
const MAX_LONG_PX = 15_800;

/**
 * The report's A4 pages drawn to canvases, laid out in an off-screen frame.
 * @returns {Promise<HTMLCanvasElement[]>}
 */
async function drawPages(html, { landscape, scale, onProgress, continuous = false }) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${landscape ? 1300 : 900}px;height:${landscape ? 900 : 1300}px;border:0;`;
  try {
    await new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error('The report page could not be laid out.'));
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
    const doc = frame.contentDocument;
    // The frame's own script deals the flow onto pages a slice at a time (lib/letterhead PAGER)
    await pagesDealt(doc);
    await Promise.all([...doc.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await doc.fonts?.ready;
    const pages = [...doc.querySelectorAll('.page')];
    const { default: html2canvas } = await import('html2canvas');
    const out = [];
    // A long report a little lighter (operator, 17 Nov 2026: 70 pages froze the page)
    const base = !continuous && pages.length > LONG_PAGES ? Math.min(scale, LONG_SCALE) : scale;
    for (let i = 0; i < pages.length; i++) {
      // `{ done, total }` for a bar; the words for anything that only shows text
      onProgress?.(`Drawing page ${i + 1} of ${pages.length}`, { done: i, total: pages.length });
      await breathe();
      // One long page stays one image: drawn smaller when it would pass what a
      // browser will draw (api/pdfJpeg MAX_HEIGHT), never cut
      const s = continuous ? Math.min(scale, MAX_LONG_PX / Math.max(1, pages[i].scrollHeight)) : base;
      // The other pages are left out of html2canvas's copy of the document: copying all of
      // them for each page made a long report cost pages x pages (25 Nov 2026)
      const own = pages[i];
      out.push(await html2canvas(own, { scale: s, backgroundColor: '#ffffff', useCORS: true, logging: false,
        ignoreElements: (el) => el !== own && el.classList?.contains('page'),
        ...(continuous ? { windowHeight: pages[i].scrollHeight + 50, height: pages[i].scrollHeight } : {}) }));
    }
    return out;
  } finally {
    frame.remove();
  }
}

/**
 * @param {string} html  from renderLetterheadHtml
 * @param {{ filename: string, landscape?: boolean, onProgress?: (words: string) => void, keep?: boolean }} o
 *   `keep` hands back `{ blob, filename }` instead of saving it, for a preview
 *   whose Download then saves that same file.
 */
export async function saveLetterheadPdf(html, { filename, landscape = false, onProgress, keep = false }) {
  const pages = await drawPages(html, { landscape, scale: PDF_SCALE, onProgress });
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true });
  const [w, h] = landscape ? [297, 210] : [210, 297];
  onProgress?.('Saving the PDF', { done: pages.length, total: pages.length });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
    pdf.addImage(await jpegBytes(pages[i], 0.9), 'JPEG', 0, 0, w, h);
    // Free each page once it is in the PDF, and let the screen update between pages
    pages[i].width = 0;
    await breathe();
  }
  if (keep) return { blob: pdf.output('blob'), filename };
  pdf.save(filename);
  return null;
}

/**
 * The same report as a JPEG: the pages drawn once, at JPEG_SCALE, never
 * through the PDF. `continuous`: the html is one long page
 * (renderLetterheadHtml continuous), drawn as one image.
 */
export async function saveLetterheadJpeg(html, { filename, landscape = false, onProgress, continuous = false }) {
  const pages = await drawPages(html, { landscape, scale: JPEG_SCALE, onProgress, continuous });
  await savePagesAsJpeg(pages, filename);
}
