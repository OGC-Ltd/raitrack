// "Take me to the row" (operator, 2026-11-25): a click on a weighbridge
// pop-up opens its page on that line. The pop-up names the line here; the
// page (WeighbridgesScreen) takes the request, finds
// the line, pages to it, marks it and scrolls it into view.
//
// One request at a time: a newer click replaces an older one. Pure apart from
// its listeners; no React.

let request = null;      // { page: "weighbridges", id, day?, n }
let n = 0;
const listeners = new Set();

/** Ask `page` to show line `id` (a weighbridge ticket's id). */
export function requestRow(page, id, day = null) {
  request = { page, id, day, n: ++n };
  for (const l of listeners) l();
}

/** The open request for `page`, or null. */
export const rowRequest = (page) => (request?.page === page ? request : null);

/** The page has shown the line (or given up): the request is done. */
export function clearRowRequest(r) {
  if (request && r && request.n === r.n) request = null;
}

export function subscribeRowRequests(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The pager page that holds index `i`, `step` lines a page. */
export const pageOf = (i, step) => (i < 0 ? 0 : Math.floor(i / step));
