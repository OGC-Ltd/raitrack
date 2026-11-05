// Harsh cornering on the End of Shift report (operator, 5 Nov 2026: "we want to
// include the harsh cornering events (harsh turns) in the movement report and
// end of shift"). The server's sheet counts Overspeeding, On phone, No
// seatbelt, Harsh braking, Harsh acceleration and Camera covered; harsh turns
// are on record (trackers and the cameras' Harsh turn) but kept off the feed
// the sheet reads. The page reads them for the shift as the Movements report
// does (reports/movements/events, kind cornering) and adds them to section 3,
// Policy breaches, as the server lays out the others:
//   · a column on the counts table: the total, and how many units;
//   · a "Harsh cornering" half with the top TOP_UNITS units (Unit, Driver, Times);
//   · the total added to the section's and the overview's Policy breaches.
//
// Pure: returns a new document; one that already has the column is left as it is.

import { sectionEnd } from './shiftDoc';

export const LABEL = 'Harsh cornering';
export const TOP_UNITS = 5;
const DASH = '-';

const num = (n) => Number(n).toLocaleString('en-GB');
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
const readNum = (text) => Number(String(text ?? '').replace(/,/g, '').match(/^\s*(\d+)/)?.[1] ?? NaN);

/** Times per unit, most first: [{ plate, times }]. `vehicleIds`: the category's units only, when one is picked. */
export function corneringByUnit(events, vehicleIds = null) {
  const keep = vehicleIds ? new Set(vehicleIds) : null;
  const by = new Map();
  for (const e of events ?? []) {
    if (e?.kind !== 'cornering' || (keep && !keep.has(e.vehicleId))) continue;
    const k = e.vehicleId ?? e.plate;
    const u = by.get(k) ?? { plate: e.plate || DASH, times: 0 };
    u.times += 1;
    by.set(k, u);
  }
  return [...by.values()].sort((a, b) => b.times - a.times || a.plate.localeCompare(b.plate, 'en', { numeric: true }));
}

/**
 * The Overview without its Fuel drains box (operator, 5 Nov 2026: "let's remove
 * this part of fuel drains here"). The drains are still counted in section 2.
 */
export function withoutDrainsBox(doc) {
  if (!doc?.blocks) return doc;
  return { ...doc, blocks: doc.blocks.map((b) => (b.kind === 'figures' ? { ...b, items: b.items.filter((it) => !/^fuel drains/i.test(it.label ?? '')) } : b)) };
}

/**
 * The sheet with harsh cornering in Policy breaches.
 * @param doc     the server's End of Shift document
 * @param events  the shift's events (kind cornering), or null when they could not be read
 */
export function withCornering(doc, events, { vehicleIds = null } = {}) {
  if (!doc?.blocks) return doc;
  const blocks = doc.blocks.map((b) => ({ ...b }));
  const at = blocks.findIndex((b) => b.kind === 'h2' && /policy breaches/i.test(b.title ?? ''));
  if (at < 0) return doc;
  const end = sectionEnd(blocks, at);
  const countsAt = blocks.findIndex((b, i) => i > at && i < end && b.kind === 'table');
  if (countsAt < 0 || blocks[countsAt].head?.includes(LABEL)) return doc;

  if (events == null) {
    // Not read: said under the section, nothing counted
    blocks.splice(end, 0, { kind: 'note', text: 'Harsh cornering could not be read for this shift.' });
    return { ...doc, blocks };
  }
  const units = corneringByUnit(events, vehicleIds);
  const total = units.reduce((n, u) => n + u.times, 0);

  // The counts table: a column of its own
  const t = blocks[countsAt];
  blocks[countsAt] = {
    ...t,
    cols: [...t.cols, { w: 0, align: 'center' }],
    head: [...t.head, LABEL],
    rows: t.rows.map((row, i) => [...row, i === 0 ? { text: num(total), bold: true } : { text: plural(units.length, 'unit'), tone: 'mut' }]),
  };

  // Its half, beside the last one where that pair has room, else a pair of its own
  const top = units.slice(0, TOP_UNITS);
  const half = {
    title: LABEL,
    aside: units.length ? (units.length > top.length ? `top ${top.length} of ${units.length} units` : `all ${plural(units.length, 'unit')}`) : '',
    body: !top.length ? { kind: 'none', text: 'None in the shift.' }
      : { kind: 'table', size: 7.4, cols: [{ w: 18 }, { w: 0 }, { w: 13, align: 'right' }], head: ['Unit', 'Driver', 'Times'],
          rows: top.map((u) => [{ text: u.plate, bold: true }, { text: DASH }, { text: num(u.times), bold: true }]) },
  };
  let lastPair = -1;
  for (let i = at + 1; i < end; i++) if (blocks[i].kind === 'pair') lastPair = i;
  if (lastPair >= 0 && blocks[lastPair].halves.length < 2) blocks[lastPair] = { ...blocks[lastPair], halves: [...blocks[lastPair].halves, half] };
  else blocks.splice(lastPair >= 0 ? lastPair + 1 : countsAt + 1, 0, { kind: 'pair', halves: [half] });

  // The section's and the overview's totals take it in
  if (total) {
    const h = blocks[at];
    const was = readNum(h.aside);
    if (Number.isFinite(was)) blocks[at] = { ...h, aside: String(h.aside).replace(/^\s*[\d,]+/, num(was + total)) };
    for (let i = 0; i < at; i++) {
      const b = blocks[i];
      if (b.kind !== 'figures') continue;
      blocks[i] = { ...b, items: b.items.map((it) => {
        const n = readNum(it.value);
        return /policy breaches/i.test(it.label ?? '') && Number.isFinite(n) ? { ...it, value: num(n + total) } : it;
      }) };
    }
  }
  return { ...doc, blocks };
}
