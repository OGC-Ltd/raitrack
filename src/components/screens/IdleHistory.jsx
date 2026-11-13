/**
 * Alerts › Idle units › History: the idle alerts the server kept (operator,
 * 2026-11-13: "persist that data and have a way to retrieve them from the
 * alerts page"). One row per stop the idle watch raised, open or ended, for
 * the days picked (the last 7 by default), newest first.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import { fetchIdleHistory } from "../../api/idleWatch";
import { eatWords, idleWords, mapUrl, whereWords } from "../../lib/idleAlerts";
import { firstMessage } from "../../lib/formErrors";

/** Today in Nairobi as YYYY-MM-DD, and n days before it. */
const nairobiDay = (ms) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
const DAY = 24 * 3_600_000;

/** A day field that takes the day once it is whole (Alerts' DayField). */
function Day({ label, value, min, max, onPick }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const whole = (v) => /^20\d\d-\d\d-\d\d$/.test(v);
  return (
    <label className="idle-hist-day">
      <span>{label}</span>
      <input type="date" className="sp4-date-input" value={draft} min={min} max={max}
             onChange={(e) => { setDraft(e.target.value); if (whole(e.target.value)) onPick(e.target.value); }}
             onBlur={() => setDraft(value)} />
    </label>
  );
}

export default function IdleHistory({ q = "" }) {
  const today = nairobiDay(Date.now());
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(() => nairobiDay(Date.now() - 6 * DAY));
  const pickFrom = (d) => { setFrom(d); if (d > to) setTo(d); };
  const pickTo = (d) => { setTo(d); if (d < from) setFrom(d); };

  const read = useQuery({
    queryKey: ["idle-history", from, to],
    queryFn: () => fetchIdleHistory({ from, to }),
    staleTime: 60_000,
  });
  const rows = useMemo(() => {
    const all = read.data?.rows ?? [];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((r) => `${r.plate} ${r.size} ${r.designation} ${r.nearest?.name ?? ""}`.toLowerCase().includes(needle)) : all;
  }, [read.data, q]);
  const pager = usePager(rows, `${from}|${to}|${q}`);
  const meta = read.data?.meta ?? {};

  return (
    <div className="idle-hist">
      <div className="idle-hist-bar">
        <Day label="From" value={from} max={today} onPick={pickFrom} />
        <Day label="To" value={to} min={from} max={today} onPick={pickTo} />
        {read.data && (
          <span className="sp4-muted idle-hist-count">
            {rows.length} idle {rows.length === 1 ? "stop" : "stops"}{meta.more ? ` (first ${meta.limit})` : ""}
          </span>
        )}
      </div>

      {read.isLoading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading Idle History" />
      ) : read.isError ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="Could Not Read Idle History"
                   action={{ label: "Try again", onClick: () => read.refetch() }}>
          {firstMessage(read.error) ?? "The server did not answer."}
        </EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-history" tone="info" title="No Idle Stops">
          {q ? "No idle stop in these days matches the search." : "No listed Menengai unit was idle in these days."}
        </EmptyNote>
      ) : (<>
        <div className="idle-table-scroll">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <thead>
              <tr><th>Unit</th><th>Where</th><th>Stopped</th><th>Moved again</th><th>Idle in working hours</th><th>Engine</th></tr>
            </thead>
            <tbody>
              {pager.pageRows.map((r) => {
                const url = mapUrl(r);
                return (
                  <tr key={r.key} className={`idle-tr idle-tr--${r.severity}`}>
                    <td data-label="Unit">
                      <span className="idle-plate">{r.plate}</span>
                      <span className="idle-meta">{[r.size, r.designation].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td data-label="Where">
                      {url
                        ? <a href={url} target="_blank" rel="noreferrer noopener" className="idle-location-link">{whereWords(r)}</a>
                        : <span className="sp4-muted">{whereWords(r)}</span>}
                    </td>
                    <td data-label="Stopped"><span className="idle-since">{r.sinceExact === false ? "by " : ""}{eatWords(r.since)}</span></td>
                    <td data-label="Moved again">
                      {r.endedAt
                        ? <span className="idle-since">{eatWords(r.endedAt)}</span>
                        : <span className="idle-hist-open">Still idle</span>}
                    </td>
                    <td data-label="Idle in working hours">
                      <span className={`idle-duration idle-duration--${r.severity}`}>
                        <i className={`ti ${r.severity === "critical" ? "ti-alert-triangle" : "ti-clock"}`} aria-hidden="true" />
                        {r.sinceExact === false ? "at least " : ""}{idleWords(r.idleMs)}
                      </span>
                    </td>
                    <td data-label="Engine"><span className="sp4-muted">{r.engineOn == null ? "—" : r.engineOn ? "On" : "Off"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePager pager={pager} label="Idle history pages" />
      </>)}
    </div>
  );
}
