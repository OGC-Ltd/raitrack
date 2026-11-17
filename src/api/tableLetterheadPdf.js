// A table export as a letterhead PDF (lib/tableLetterhead): what
// utils/tableExport downloadTablePdf did on the old template, on the report
// letterhead instead. Same arguments, plus the organisation on screen.
//
// Drawing the pages takes a few seconds, so a second click while one is being
// drawn is ignored rather than starting another.

import { tableLetterheadHtml } from '../lib/tableLetterhead';
import { saveLetterheadPdf, letterheadLogos } from './letterheadPdf';

let drawing = false;

/**
 * @param {Parameters<typeof tableLetterheadHtml>[0] & { companyName: string, orgCode?: string }} o
 *   as downloadTablePdf's, without `logos` (filled in here)
 */
export async function downloadLetterheadTablePdf(o) {
  if (drawing) return;
  drawing = true;
  try {
    const { html, landscape, filename } = tableLetterheadHtml({ ...o, logos: letterheadLogos() });
    await saveLetterheadPdf(html, { filename, landscape });
  } catch (err) {
    console.error('Letterhead PDF failed', err);
    window.alert('The PDF could not be made. Please try again.');
  } finally {
    drawing = false;
  }
}
