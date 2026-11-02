// What a browser kept of the Driver conduct follow-up before the server did
// (2 Nov 2026), moved over the first time this version opens the report: the
// cases and the logged incidents go to the server, which keeps a case's
// record acted on last and an entry it already has, and this browser's copy
// is then forgotten. Nothing is lost when the move fails: it is tried again
// next time.

import { loadCases, forgetCases } from './followUp';
import { loadEntries, forgetEntries } from './operatorLog';
import { importCases, importIncidents } from '../api/driverConduct';

const moving = new Map();

/** Moves this browser's lists for the organisation; resolves to how many of each were added. */
export function moveBrowserFollowUp(orgId) {
  if (!orgId) return Promise.resolve({ cases: 0, entries: 0 });
  if (!moving.has(orgId)) {
    moving.set(orgId, (async () => {
      const cases = loadCases(orgId);
      const entries = loadEntries(orgId);
      let moved = { cases: 0, entries: 0 };
      if (cases.length) { moved.cases = (await importCases(orgId, cases)).added; forgetCases(orgId); }
      if (entries.length) { moved.entries = (await importIncidents(orgId, entries)).added; forgetEntries(orgId); }
      return moved;
    })().finally(() => moving.delete(orgId)));
  }
  return moving.get(orgId);
}
