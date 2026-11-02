// A report saved as a JPEG (operator, 2 Nov 2026: Shift, Movements, Driver
// Conduct, Overspeeding and Utilisation, "a jpeg for the pdf report"), for
// sending where a PDF will not open, a WhatsApp group above all. The pages lie
// one under another on a single image.
//
// Sharp when zoomed into (operator, 2 Nov: "never crystal clear"): each page is
// drawn once, at print resolution, and compressed once. A server PDF (Shift,
// Movements) is vector, drawn here with pdf.js at ~250 dpi; a report the
// browser lays out (api/letterheadPdf) is drawn straight from its page, never
// through its PDF, whose pages are already pictures and would blur a second time.
//
// A browser will not make a canvas past about 16 000 px tall, so a long
// report comes out as several images, "(1 of 3)" and so on, each whole pages.

import { pdfjs } from '../lib/pdfjs';
import { saveFile } from './tripReport';

const PDF_SCALE = 3.5;    // an A4 page 2083 px wide, ~250 dpi
const GAP = 24;           // grey between the pages, so each reads as a sheet
const MAX_HEIGHT = 16_000;
// High enough that the browser keeps the colour detail of small text
const QUALITY = 0.95;

function toBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (b) => (b ? resolve(b) : reject(new Error('The image could not be made.'))), 'image/jpeg', QUALITY));
}

/** The pages cut into runs that each fit on one image. */
function sheets(pages) {
  const out = [];
  let run = [];
  let height = 0;
  for (const p of pages) {
    const add = (run.length ? GAP : 0) + p.height;
    if (run.length && height + add > MAX_HEIGHT) { out.push(run); run = []; height = 0; }
    height += run.length ? GAP + p.height : p.height;
    run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

/**
 * Drawn pages (canvases) saved as JPEG: one image, or several past MAX_HEIGHT.
 * @param {HTMLCanvasElement[]} pages
 * @param {string} filename the report's name; the image takes it with .jpg
 */
export async function savePagesAsJpeg(pages, filename) {
  const runs = sheets(pages);
  const base = String(filename ?? 'Report.pdf').replace(/\.pdf$/i, '');
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const out = document.createElement('canvas');
    out.width = Math.max(...run.map((p) => p.width));
    out.height = run.reduce((h, p) => h + p.height, 0) + GAP * (run.length - 1);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#d9dce1';
    ctx.fillRect(0, 0, out.width, out.height);
    let y = 0;
    for (const p of run) {
      // Whole pixels, never scaled: drawn as they were made
      ctx.drawImage(p, Math.floor((out.width - p.width) / 2), y);
      y += p.height + GAP;
    }
    const name = runs.length === 1 ? `${base}.jpg` : `${base} (${i + 1} of ${runs.length}).jpg`;
    saveFile(await toBlob(out), name);
  }
}

/**
 * A PDF (the server's Shift or Movements report) saved as JPEG.
 * @param {Blob} blob      the report's PDF
 * @param {string} filename the PDF's name; the image takes it with .jpg
 */
export async function savePdfAsJpeg(blob, filename) {
  const m = await pdfjs();
  const task = m.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: PDF_SCALE });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      // 'print': drawn straight through, not a frame at a time, which never
      // finishes in a tab the browser is not painting
      await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
      pages.push(c);
    }
    await savePagesAsJpeg(pages, filename);
  } finally {
    task.destroy();
  }
}
