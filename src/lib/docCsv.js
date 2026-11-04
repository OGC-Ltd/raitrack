// Any report document (the sheet a PDF is drawn from: title, details, blocks)
// as a CSV (operator, 4 Nov 2026: "I need to have the option to download all
// reports in CSV as well — this cuts across all organisations and reports").
// The CSV holds what the PDF holds, top to bottom: the details, each section's
// heading, its figures as label/value lines, its tables with their headings,
// and notes; a blank line between sections. Excel opens it as one sheet.
//
// Pure: returns { head, body } for utils/tableExport downloadTableCsv.

const text = (c) => String(c?.text ?? c ?? '');

function tableLines(t) {
  return [t.head.map(String), ...t.rows.map((row) => row.map(text))];
}

export function docCsv(doc) {
  const body = [];
  for (const m of doc?.meta ?? []) body.push([m.label, m.value]);
  if (doc?.date) body.push(['Date', doc.date]);
  if (doc?.reportNo) body.push(['Report no.', doc.reportNo]);
  for (const b of doc?.blocks ?? []) {
    switch (b.kind) {
      case 'h2': case 'bar': body.push([]); body.push([b.aside ? `${b.title} (${b.aside})` : b.title]); break;
      case 'h3': body.push([b.aside ? `${b.title} (${b.aside})` : b.title]); break;
      case 'figures': for (const i of b.items ?? []) body.push([i.label, i.value]); break;
      case 'table': body.push(...tableLines(b)); break;
      case 'pair':
        for (const h of b.halves ?? []) {
          body.push([h.aside ? `${h.title} (${h.aside})` : h.title]);
          if (h.body?.kind === 'table') body.push(...tableLines(h.body)); else if (h.body?.text) body.push([h.body.text]);
        }
        break;
      case 'none': case 'note': if (b.text?.trim()) body.push([b.text]); break;
      case 'handover': {
        const lines = (b.lines ?? []).filter((l) => l?.trim());
        if (lines.length) { body.push([]); body.push(['Handover']); for (const l of lines) body.push([l]); }
        break;
      }
      default: break;
    }
  }
  return { head: [doc?.title ?? 'Report'], body };
}

/** A filename slug from the document's name: "End of Shift Report Sukari 2026-11-04" → "end-of-shift-report-sukari-2026-11-04". */
export const docSlug = (doc) => String(doc?.docName ?? doc?.filename ?? doc?.title ?? 'report')
  .replace(/\.pdf$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
