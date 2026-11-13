/**
 * Alerts › Idle units › History: the idle alerts the server kept (operator,
 * 2026-11-13), one row per stop, for the days picked in the page's filter bar
 * (AlertsScreen: View, Days), newest first, in the Overspeeding list's shape
 * (IdleTable).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import EmptyNote from "../shared/EmptyNote";
import { usePager } from "../body/TablePager";
import { fetchIdleHistory } from "../../api/idleWatch";
import { firstMessage } from "../../lib/formErrors";
import IdleTable from "./IdleTable";

/** The query both this list and the page's summary line read (one request). */
export const idleHistoryQuery = (from, to) => ({
  queryKey: ["idle-history", from, to],
  queryFn: () => fetchIdleHistory({ from, to }),
  staleTime: 60_000,
});

/** Rows matching the page's search: plate, kind or where. */
export function searchHistory(rows, q) {
  const needle = String(q ?? "").trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => `${r.plate} ${r.size} ${r.designation} ${r.nearest?.name ?? ""}`.toLowerCase().includes(needle));
}

export default function IdleHistory({ from, to, q = "" }) {
  const read = useQuery(idleHistoryQuery(from, to));
  const rows = useMemo(() => searchHistory(read.data?.rows ?? [], q), [read.data, q]);
  const pager = usePager(rows, `${from}|${to}|${q}`);

  if (read.isLoading) {
    return <EmptyNote icon="ti-loader-2" tone="busy" title="Reading Idle History">The idle stops kept for these days.</EmptyNote>;
  }
  if (read.isError) {
    return (
      <EmptyNote icon="ti-alert-triangle" tone="error" title="Idle History Could Not Be Loaded"
                 action={{ label: "Try again", onClick: () => read.refetch() }}>
        {firstMessage(read.error) ?? "The server did not answer."}
      </EmptyNote>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyNote icon="ti-history" title="No Idle Stops">
        {q ? `Nothing matches “${q}”.` : "No listed Menengai unit was idle in these days."}
      </EmptyNote>
    );
  }
  return <IdleTable rows={rows} history pager={pager} label="Idle history pages" />;
}
