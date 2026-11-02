/*
 * A PDF drawn page by page with pdf.js, each page whole in the room it is
 * given (operator, 2 Nov: the movement-report preview to "fit the viewport",
 * then "zoomed out"): as large as it can be with all of the sheet in view,
 * width and height both. Further pages lie under it, a scroll away.
 *
 * It was the browser's own PDF viewer in a frame: each browser takes or
 * ignores its "#view=" hints as it likes, so the sheet came up at a different
 * size in each. Drawn here, it fits the same in every browser, and is drawn
 * again, sharp, when the window changes size. There is no zoom to work
 * (operator: "do not add controls"). `onLoad(pages)` tells how many pages
 * there are. pdf.js loads only when a preview first opens.
 */

import { useEffect, useRef, useState } from 'react';
import './PdfPages.css';

let lib = null;
function pdfjs() {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    .then(([m, worker]) => { m.GlobalWorkerOptions.workerSrc = worker.default; return m; });
  return lib;
}

const PX_PER_PT = 96 / 72;
const GUTTER = 24;   // the space either side of the sheet, unless a screen sets its own

function PdfPage({ doc, n, scale }) {
  const ref = useRef(null);
  useEffect(() => {
    let live = true;
    let task = null;
    doc.getPage(n).then((page) => {
      if (!live || !ref.current) return;
      const vp = page.getViewport({ scale: scale * PX_PER_PT });
      const dpr = window.devicePixelRatio || 1;
      const c = ref.current;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      c.style.width = `${Math.floor(vp.width)}px`;
      c.style.height = `${Math.floor(vp.height)}px`;
      task = page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      task.promise.catch(() => {});   // a newer size cancels it
    });
    return () => { live = false; task?.cancel(); };
  }, [doc, n, scale]);
  return <canvas ref={ref} className="pdfp__page" role="img" aria-label={`Page ${n}`} />;
}

export default function PdfPages({ blob, gutter = GUTTER, onLoad, onError }) {
  const boxRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [page, setPage] = useState(null);          // the first page's size, in points
  const [room, setRoom] = useState(null);          // the space there is to fill, px

  useEffect(() => {
    let live = true;
    let task = null;
    (async () => {
      const m = await pdfjs();
      task = m.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
      const d = await task.promise;
      const first = await d.getPage(1);
      if (!live) return;
      const { width, height } = first.getViewport({ scale: 1 });
      setPage({ width, height });
      setDoc(d);
      onLoad?.(d.numPages);
    })().catch((err) => { if (live) onError?.(err); });
    return () => { live = false; task?.destroy(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  // The window's size, read again when it changes (there is no ResizeObserver in every pane)
  useEffect(() => {
    const box = boxRef.current;
    const measure = () => setRoom(box ? { width: box.clientWidth - gutter * 2, height: box.clientHeight - gutter * 2 } : null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [gutter]);

  // The whole sheet in view: the smaller of fitting its width and fitting its height
  const scale = page && room && room.width > 0 && room.height > 0
    ? Math.min(room.width / page.width, room.height / page.height) / PX_PER_PT
    : null;

  return (
    <div ref={boxRef} className="pdfp" style={{ padding: `${gutter}px` }}>
      {doc && scale && Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} scale={scale} />)}
    </div>
  );
}
