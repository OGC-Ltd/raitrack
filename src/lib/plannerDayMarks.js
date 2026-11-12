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
// Kept on the server: each stop's `dueDay` (fleet-server planner, PATCH
// .../plans/:planId/stops/:stopId { dueDay }), so every browser counts the same.

/** A plan's marks, { [stopId]: 'YYYY-MM-DD' }, from its stops' dueDay. */
export function marksOf(plan) {
  return Object.fromEntries((plan?.stops ?? []).filter((s) => s.dueDay).map((s) => [s.id, s.dueDay]));
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
