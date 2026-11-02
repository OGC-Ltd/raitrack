// pdf.js, loaded once, the first time a PDF is drawn (PdfPages, pdfJpeg).
//
// The worker is started here, through Vite's worker build, which names it
// .js. As a `?url` asset it kept pdf.js's .mjs name, and the live server
// sends .mjs as application/octet-stream, which no browser will run as a
// worker ("Setting up fake worker failed", operator, 2 Nov).

let lib = null;
export function pdfjs() {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
    return m;
  });
  return lib;
}
