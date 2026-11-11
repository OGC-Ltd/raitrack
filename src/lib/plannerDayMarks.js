// "Mark for today" on a Planner stop (operator, 11 Nov 2026: "some of the
// orders take 2 days to complete ... instead of picking 1/10 for all orders it
// picks x/the number of orders marked for that particular day").
//
// A mark ties a stop on a sheet to one fleet day ("2026-11-11"). The Deliveries
// report then counts, for each sheet, only the stops due on the report's days:
//   - stops marked for one of those days, when the sheet has any;
//   - otherwise the stops not marked for another day: the leftovers, so on day
//     two the stops not marked on day one count without being marked again;
//   - a sheet with no marks at all counts every stop, as before.
//
// TEMPORARY: kept in this browser (localStorage), per organisation, until the
// server has a field for it. Only readMarks and writeMarks touch storage; move
// those two to the planner API and nothing else changes.

import { useCallback, useEffect, useState } from 'react';

const keyOf = (orgId) => `ft-planner-day-marks:${orgId}`;
const listeners = new Set();

/** Every mark for the organisation: { [planId]: { [stopId]: 'YYYY-MM-DD' } }. */
export function readMarks(orgId) {
  if (!orgId) return {};
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(orgId)) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function writeMarks(orgId, marks) {
  try { localStorage.setItem(keyOf(orgId), JSON.stringify(marks)); } catch { /* full or blocked */ }
  for (const fn of listeners) fn(orgId);
}

/** Mark a stop for a day, or clear its mark with `day` null. */
export function setDayMark(orgId, planId, stopId, day) {
  if (!orgId || planId == null || stopId == null) return;
  const marks = readMarks(orgId);
  const plan = { ...(marks[planId] ?? {}) };
  if (day) plan[stopId] = day; else delete plan[stopId];
  if (Object.keys(plan).length) marks[planId] = plan; else delete marks[planId];
  writeMarks(orgId, marks);
}

/** The stops a sheet counts on these days (see the top of the file). Pure. */
export function stopsForDays(stops, planMarks, days) {
  const list = stops ?? [];
  const m = planMarks ?? {};
  const want = new Set(days ?? []);
  const marked = list.filter((s) => want.has(m[s.id]));
  if (marked.length) return { stops: marked, by: 'marked' };
  const anyMark = list.some((s) => m[s.id]);
  if (!anyMark) return { stops: list, by: 'all' };
  return { stops: list.filter((s) => !m[s.id]), by: 'rest' };
}

/** "11.11" from "2026-11-11". */
export const shortDay = (day) => {
  const [, mo, d] = String(day ?? '').split('-');
  return d && mo ? `${d}.${mo}` : String(day ?? '');
};

/** The organisation's marks, kept current. Returns [marks, set(planId, stopId, day|null)]. */
export function usePlannerDayMarks(orgId) {
  const [marks, setMarks] = useState(() => readMarks(orgId));
  useEffect(() => {
    setMarks(readMarks(orgId));
    const onLocal = (id) => { if (id === orgId) setMarks(readMarks(orgId)); };
    const onStorage = (e) => { if (e.key === keyOf(orgId)) setMarks(readMarks(orgId)); };
    listeners.add(onLocal);
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(onLocal); window.removeEventListener('storage', onStorage); };
  }, [orgId]);
  const set = useCallback((planId, stopId, day) => setDayMark(orgId, planId, stopId, day), [orgId]);
  return [marks, set];
}
