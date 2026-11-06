/*
 * A report's PDF preview (shared/PdfPreview): every report under Reports has
 * one, asked for upright or on its side like the PDF and the JPEG (operator,
 * 6 Nov 2026). `make(landscape)` makes the file, `{ blob, filename }`; Try
 * again makes it the same way up. A preview asked for again before the last
 * one came back shows only the newest.
 */

import { useCallback, useRef, useState } from 'react';

export function usePdfPreview(make) {
  const [state, setState] = useState(null);   // { status: loading | done (blob, filename) | error }
  const id = useRef(0);
  const way = useRef(undefined);
  const maker = useRef(make);
  maker.current = make;

  const open = useCallback(async (landscape) => {
    way.current = landscape;
    const n = ++id.current;
    setState({ status: 'loading' });
    try {
      const file = await maker.current(landscape);
      if (n === id.current) setState({ status: 'done', ...file });
    } catch (err) {
      if (n === id.current) setState({ status: 'error', message: err?.message ?? String(err) });
    }
  }, []);
  const retry = useCallback(() => open(way.current), [open]);
  const close = useCallback(() => { id.current++; setState(null); }, []);

  return { state, open, retry, close };
}
