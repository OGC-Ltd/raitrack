// A letterhead report (lib/letterhead) into a PDF: the page is laid out in an
// off-screen frame, its own script deals the flow onto A4 pages, and each page
// is drawn into the PDF as one image. The same route the End of shift report
// took, so the two come out looking alike.

import raiLogo from '../assets/rai-group-logo.jpeg';
import ogcLogo from '../assets/ogc-monitoring-logo.png';

/** The logos as absolute URLs: the frame's document has no base of its own. */
export const letterheadLogos = () => ({
  rai: new URL(raiLogo, window.location.href).href,
  ogc: new URL(ogcLogo, window.location.href).href,
});

/**
 * @param {string} html  from renderLetterheadHtml
 * @param {{ filename: string, landscape?: boolean, onProgress?: (words: string) => void }} o
 */
export async function saveLetterheadPdf(html, { filename, landscape = false, onProgress }) {
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
    await Promise.all([...doc.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await doc.fonts?.ready;
    const pages = [...doc.querySelectorAll('.page')];
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true });
    const [w, h] = landscape ? [297, 210] : [210, 297];
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`Drawing page ${i + 1} of ${pages.length}`);
      const canvas = await html2canvas(pages[i], { scale: 2.2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      if (i > 0) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, w, h);
    }
    pdf.save(filename);
  } finally {
    frame.remove();
  }
}
