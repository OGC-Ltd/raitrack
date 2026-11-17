// Draws a letterhead table PDF off the page's thread (lib/letterheadTablePdf),
// so a report of thousands of rows never freezes the page and the reader can
// carry on while it is made (operator, 17 Nov 2026).
//
// In:  { spec, logos }       Out: { type: 'progress', phase, done, total }
//                                  { type: 'done', buffer }   (transferred)
//                                  { type: 'error', message }

import { drawLetterheadTablePdf } from '../lib/letterheadTablePdf';

self.onmessage = (e) => {
  const { spec, logos } = e.data ?? {};
  try {
    const buffer = drawLetterheadTablePdf(spec, logos, (p) => self.postMessage({ type: 'progress', ...p }));
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
