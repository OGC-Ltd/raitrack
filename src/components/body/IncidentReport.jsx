/**
 * One master/detail incident report, shared by the Speed and Malfunction tabs.
 *
 * ## Why one component and not two
 *
 * Both tabs ask the same two questions in the same order — "which units, this
 * day" and then "show me every case for that one" — over ledgers with the
 * same shape. SensorPanel is already 1,581 lines; two near-identical
 * master/detail reports is how it becomes 2,400 and how the two drift apart.
 * The differences are entirely in the columns and the endpoints, so those are
 * props.
 *
 * ## What the screens must not claim
 *
 * These reports are read by people deciding whether to speak to a driver, so
 * the honesty rules are part of the component, not decoration:
 *
 * - Peak speed is the peak OBSERVED. The median gap between fixes is 28 s and
 *   the true peak between two of them is unknowable.
 * - The limit is the fleet's POLICY limit, not a posted road limit. The column
 *   header says so.
 * - Duration and distance are LOWER BOUNDS — both ends of an episode are real
 *   fixes, so the real one is always at least this long.
 * - `frames` is shown, because three frames at that cadence is about a minute
 *   of evidence and the reader is entitled to know how much there was.
 * - A window that starts before capture did says so, rather than rendering a
 *   quiet zero that looks like a clean day.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { whenLabel } from "../../api/incidents";
import TableToolbar from "./TableToolbar";
import TablePager, { usePager, withMore } from "./TablePager";
import { downloadTableCsv, downloadTablePdf } from "../../utils/tableExport";
import DetailSidebar, { DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import "./IncidentReport.css";

/* Rendered by the panel that owns this report, not by the report itself — the
   window and the sort live in the panel's filter bar alongside the search and
   the Activity chips, the same place the Fuel FSL tab keeps its day picker.
   Exported so the chips and the fetch cannot name different keys. */
export const SORTS = [
  { key: "count",    label: "Most cases" },
  { key: "duration", label: "Longest" },
  { key: "peak",     label: "Most severe" },
  { key: "recent",   label: "Most recent" },
];

/* Loading, error and empty are the PANEL's, not this component's.
 *
 * They were an `.ir-empty` block and a shimmering `.ir-skel` grid of grey
 * cells — a second loading language on a screen whose other two tabs show a
 * spinner and a line of text. The skeleton also promised a shape it could not
 * keep: six rows of five, whatever the table was about to hold.
 */
const Loading = ({ label }) => (
  <div className="sp4-loading" aria-busy="true" aria-live="polite">
    <div className="sp4-spinner" />{label}
  </div>
);
const Failed = ({ children }) => <div className="sp4-error">⚠ {children}</div>;
const Empty  = ({ children }) => <div className="sp4-empty-tab">{children}</div>;

/* One cell rule for both tables: the unit registration reads as the row's
   name, a measurement is tabular and right-aligned, everything else is body
   text. Same three treatments the fuel table uses one component over.

   No stretch column any more. `.sp4-table` is width:100% and a browser shares
   the leftover width across the columns — which is what the fuel grid does,
   and what these do now that they carry eleven columns rather than seven.
   Handing the whole remainder to one column instead made every other column
   hug its content, which is the opposite of giving each of them room. */
// The first column names the row, so on a phone it is the one held at the
// left edge while the rest scroll (`.sp4-keep-table`, SensorPanel.css).
const cellClass = (c, first) =>
  first ? "sp4-reg sp4-td--pin" : c.numeric ? "sp4-num" : undefined;
/* No right-aligned headers. `.sp4-num` left-aligns its cells to match the fuel
   table, so a right-aligned header would sit over a left-aligned column. */
const headClass = (c, first) => (first ? "sp4-th--pin" : undefined);

/**
 * A column as an EXPORT column, or null if it does not belong in a file.
 *
 * Two kinds are dropped. A column with no label is chrome — the "View on map"
 * cell that ends every summary row is a button, and a button is nothing in a
 * CSV. And a column whose `render` returns an element rather than a string
 * needs a `text` twin: a pill or a row of chips has to be spelled out, and the
 * spelling is the column's own business, not this file's guesswork. Rather
 * than exporting "[object Object]" it exports nothing, which is why the
 * columns that render markup carry `text` beside `render`.
 */
const exportable = (c) => c.label && (c.text || typeof c.render === "function");

const cellText = (c, r) => {
  if (c.text) return String(c.text(r) ?? "");
  const v = c.render(r);
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
};

/** head/body for the rows currently on screen — the export IS the filtered set. */
const tableFor = (columns, rows) => {
  const cols = columns.filter(exportable);
  return { head: cols.map(c => c.label), body: rows.map(r => cols.map(c => cellText(c, r))) };
};

/**
 * The detail table for one unit.
 *
 * Its own cursor, independent of the summary's: opening a unit deep in a long
 * list must not re-fetch the list, and paging its cases must not disturb the
 * page behind it.
 */
function Detail({ unit, columns, fetchPage, range, reportTitle, exportSlug, caption, timeline = false }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (nextCursor) => {
    setLoading(true);
    try {
      const res = await fetchPage({ vehicleId: unit.vehicleId, ...range, cursor: nextCursor });
      // Append on paging, replace on a fresh open.
      setRows((prev) => (nextCursor ? [...prev, ...res.rows] : res.rows));
      setCursor(res.cursor);
      setMore(res.hasNextPage);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, unit.vehicleId, range]);

  useEffect(() => { void load(undefined); }, [load]);

  const plate = unit.plate ?? unit.vehicleId;
  const pager = usePager(rows, unit.vehicleId);
  const lastPage = pager.page === pager.pageCount - 1;
  // The next batch is read when the last page loaded is reached, so the pager's
  // Next carries on into it: one pager everywhere, no "Load more" (2026-10-12).
  useEffect(() => {
    if (lastPage && more && !loading && !error) void load(cursor);
  }, [lastPage, more, loading, error, load, cursor]);

  return (
    <>
      {/* The unit heads the sidebar it opens in (shared/DetailSidebar); the
          panel's own × closes it. */}
      <DetailSidebarIdent
        name={plate}
        sub={`${unit.name ? `${unit.name} · ` : ""}every case in the window`}
      />

      {/* The same three buttons the list behind it carries, over this unit's
          cases rather than the fleet's units — somebody who opened a unit to
          read its cases is exactly the person who wants those cases in a file,
          and sending them back a level to export the summary instead would
          hand them the wrong document. */}
      <TableToolbar
        summary={<><b>{rows.length}</b> case{rows.length === 1 ? "" : "s"} loaded{more ? " so far" : ""}</>}
        note={`${plate}${unit.name ? ` · ${unit.name}` : ""} · ${caption}`}
        loading={loading}
        onReload={() => void load(undefined)}
        onCsv={() => downloadTableCsv({
          ...tableFor(columns, rows),
          filenameSlug: `${exportSlug}-${plate}`.replace(/\s+/g, "-").toLowerCase(),
        })}
        onPdf={() => downloadTablePdf({
          reportTitle: `${reportTitle} - ${plate}`,
          sectionTitle: `${plate}, every case loaded`,
          filterNote: `${caption}. ${rows.length} case${rows.length === 1 ? "" : "s"} loaded${more ? ", more available, load them before exporting for a complete file" : ""}.`,
          cards: [
            { label: "Unit",           value: plate },
            { label: "Cases in file",  value: String(rows.length) },
          ],
          ...tableFor(columns, rows),
          filenameSlug: `${exportSlug}-${plate}`.replace(/\s+/g, "-").toLowerCase(),
        })}
        disabled={!rows.length}
      />

      {error && <Failed>Could not load this unit’s cases.</Failed>}
      {!error && loading && rows.length === 0 && <Loading label="Loading cases…" />}
      {!error && !loading && rows.length === 0 && <Empty>No cases for this unit in the window.</Empty>}

      {/* One card a case: in a sidebar's width the case table's eight or nine
          columns would scroll sideways, so the first column heads the card and
          the rest read down it as label and value. The CSV and PDF above still
          carry every column as a table. */}
      {rows.length > 0 && (
        <DetailSidebarSection title={`${rows.length} case${rows.length === 1 ? "" : "s"}${more ? " so far" : ""}`}>
          <ul className={"dsb__cards" + (timeline ? " dsb__cards--timeline" : "")}>
            {pager.pageRows.map((r) => (
              <li key={r.id} className={"dsb__card" + (timeline && !r.recoveredAt ? " dsb__card--open" : "")}>
                <div className="dsb__card-head">{columns[0].render(r)}</div>
                <dl>
                  {columns.slice(1).map((c) => (
                    <Fragment key={c.key}>
                      <dt title={c.title}>{c.label}</dt>
                      <dd>{c.render(r) ?? "-"}</dd>
                    </Fragment>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <TablePager pager={withMore(pager, more)} label="Case pages" />
        </DetailSidebarSection>
      )}
    </>
  );
}

export default function IncidentReport({
  orgId,
  range,              // { from, to } ISO instants — see lib/analyticsFilter rangeFor
  sort,               // one of SORTS[].key — owned by the panel's filter bar
  summaryColumns,
  detailColumns,
  fetchSummary,
  fetchDetail,
  caption,            // the .sp4-table-sub line — what these rows are, and when
  emptyLabel,
  loadingLabel,
  selectedId,
  captureStartedAt,
  reportTitle,        // names the PDF — "Sensor Monitor — Speed"
  exportSlug,         // names the file, so Speed and Malfunction don't collide
  panelTitle = "Cases", // heads the sidebar a unit opens in: "Overspeeding cases"
  timeline = false,   // the unit's cases as a -O-O- rail, newest first (Malfunction)
}) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unit, setUnit] = useState(null);

  const load = useCallback(async (nextCursor) => {
    setLoading(true);
    try {
      const res = await fetchSummary({ orgId, ...range, sort, cursor: nextCursor });
      setRows((prev) => (nextCursor ? [...prev, ...res.rows] : res.rows));
      setCursor(res.cursor);
      setMore(res.hasNextPage);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [fetchSummary, orgId, range, sort]);

  // A change of window, org or sort is a NEW list, so the open unit closes with
  // it — leaving a detail table open across a day change would show one day's
  // cases under another day's heading, and a re-sorted list is a different
  // list even when it holds the same rows.
  useEffect(() => {
    setUnit(null);
    void load(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, range.from, range.to, sort]);

  /**
   * The window reaches back further than the ledger does.
   *
   * Said out loud rather than served as a quiet zero: a month that predates
   * capture is not a month with no incidents, and the difference is a fleet
   * that looks clean versus one nobody was watching yet.
   */
  const pager = usePager(rows, `${orgId}|${range.from}|${range.to}|${sort}`);
  const lastPage = pager.page === pager.pageCount - 1;
  // As in the unit's cases: the next batch is read when the last page is reached.
  useEffect(() => {
    if (lastPage && more && !loading && !error) void load(cursor);
  }, [lastPage, more, loading, error, load, cursor]);
  const closeUnit = useCallback(() => setUnit(null), []);
  // Stable per tab, so the open unit's cases are not read again on a re-render.
  const fetchUnitPage = useCallback((args) => fetchDetail({ orgId, ...args }), [fetchDetail, orgId]);

  const startsBeforeCapture =
    captureStartedAt && Date.parse(range.from) < Date.parse(captureStartedAt);

  /* A unit's cases open in the app's detail sidebar (operator, 2026-10-20:
     the Drivers page's panel, for Speed and Malfunction as for Alerts). They
     used to replace the list; now the list stays and another row swaps the
     unit in place. */
  const sidebar = unit && (
    <DetailSidebar
      title={panelTitle}
      label={`${panelTitle}, ${unit.plate ?? unit.vehicleId}`}
      itemKey={unit.vehicleId}
      onClose={closeUnit}
    >
      <Detail
        key={unit.vehicleId}
        unit={unit}
        columns={detailColumns}
        fetchPage={fetchUnitPage}
        range={range}
        reportTitle={reportTitle}
        exportSlug={exportSlug}
        caption={caption}
        timeline={timeline}
      />
    </DetailSidebar>
  );

  return (
    <div className="sp4-table-scroll">
      {sidebar}
      {/* The caption line and the export bar are the same row now.
          The caption was already the fuel table's own slot — one sentence
          naming what these rows are and which day they cover — and the three
          buttons belong beside it rather than in a panel header that could not
          see this window or this sort. Rendered ABOVE the loading and error
          states on purpose: Refresh is exactly what a reader wants when the
          table failed, and a bar that vanishes on failure takes the recovery
          with it. */}
      <TableToolbar
        summary={<><b>{rows.length}</b> unit{rows.length === 1 ? "" : "s"}{more ? " loaded so far" : ""}</>}
        note={caption}
        loading={loading}
        onReload={() => void load(undefined)}
        onCsv={() => downloadTableCsv({
          ...tableFor(summaryColumns, rows),
          filenameSlug: exportSlug,
        })}
        onPdf={() => downloadTablePdf({
          reportTitle,
          sectionTitle: `${rows.length} unit${rows.length === 1 ? "" : "s"}`,
          filterNote: `${caption}. ${more ? "More units are available, load them before exporting for a complete file." : "Every unit in the window."}`,
          cards: [{ label: "Units in report", value: String(rows.length) }],
          ...tableFor(summaryColumns, rows),
          filenameSlug: exportSlug,
        })}
        disabled={!rows.length}
      />

      {error && <Failed>Could not load the report.</Failed>}
      {!error && loading && rows.length === 0 && <Loading label={loadingLabel} />}

      {error || (loading && rows.length === 0) ? null : rows.length === 0 ? <Empty>{emptyLabel}</Empty> : (
        <>
          {/* Its own sideways scroller on a phone, so the bar above stays put. */}
          <div className="sp4-keep-table">
          <table className="sp4-table">
            <thead>
              <tr>
                {summaryColumns.map((c, i) => (
                  <th key={c.key} title={c.title} className={headClass(c, i === 0)}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.pageRows.map((r) => (
                <tr
                  key={r.vehicleId}
                  /* Clickable, like every fuel row — and reachable by keyboard,
                     which the fuel table's rows are not. The chevron column that
                     used to end each row is gone: the fuel table carries no such
                     affordance and the tab strip already says "Click any row to
                     inspect", so it was a thirteenth column restating the hint. */
                  className={"sp4-tr sp4-tr--incident" + ((unit?.vehicleId ?? selectedId) === r.vehicleId ? " sp4-tr--selected" : "")}
                  tabIndex={0}
                  role="button"
                  aria-label={`Every case for ${r.plate ?? r.vehicleId}`}
                  onClick={() => setUnit(r)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setUnit(r); } }}
                >
                  {summaryColumns.map((c, i) => (
                    <td key={c.key} className={cellClass(c, i === 0)}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <TablePager pager={withMore(pager, more)} label="Unit pages" />
        </>
      )}
    </div>
  );
}

/* The analysis strip is gone.
 *
 * It stacked seven stat tiles — Cases, Units, Open now, Worst peak, Total time,
 * Repeat units, vs previous — above a table that already carries every one of
 * those figures per unit, and it made these two tabs open on a wall of
 * aggregates while Fuel FSL, one tab to the left, opens on the rows. Three
 * tabs of one panel should not disagree about what the reader came for, and
 * what they came for is the units.
 *
 * The window note above survives, because it is not a statistic: a window that
 * predates capture has to say so, or an empty table reads as a clean day.
 * `captureStartedAt` still arrives as its own prop from the insights payload
 * the panel already fetches.
 */
