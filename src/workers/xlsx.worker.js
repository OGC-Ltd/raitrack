// Makes the letterhead Excel file off the page's thread (utils/xlsxExport
// buildWorkbook), so a table of tens of thousands of rows never freezes the
// page: 20,000 rows held it for 3.5 s on the page's own thread (25 Nov 2026).
//
// In:  { o, logos }   o: buildWorkbook's table, logos: { rai, ogc } as { buffer, extension }
// Out: { type: 'progress', done, total }
//      { type: 'done', buffer }   (transferred)
//      { type: 'error', message }

import ExcelJS from 'exceljs';
import { buildWorkbook } from '../utils/xlsxExport';

self.onmessage = async (e) => {
  const { o, logos } = e.data ?? {};
  try {
    const wb = buildWorkbook(ExcelJS, o, logos ?? {}, (p) => self.postMessage({ type: 'progress', ...p }));
    self.postMessage({ type: 'progress', phase: 'Saving' });
    const buffer = await wb.xlsx.writeBuffer();
    // writeBuffer may answer a view (Uint8Array) rather than the bytes themselves; send bytes of its own
    const out = buffer instanceof ArrayBuffer ? buffer
      : buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength ? buffer.buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    self.postMessage({ type: 'done', buffer: out }, [out]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
