// Weighbridges › Tickets › Coverage (operator, 18 Nov 2026; first a Metrics view): each unit's trips on a day
// and the kilometres its tracker's odometer counted that day. The rows come
// from lib/unitTrips; this reads each day's distances from the server, which
// pulls a day it holds no odometer for from Wialon and stores it, and draws the
// table in the Tickets view's grid card, pager and export bar.

import { useEffect, useMemo, useRef, useState } from "react";
import TableToolbar from "./TableToolbar";
import { loadFuelConsumptionRate, loadUnitDistance } from "../../api/reports";
import { downloadTableCsv, exportLater } from "../../utils/tableExport";
import { downloadLetterheadTablePdf } from "../../api/tableLetterheadPdf";
import { settleLimited } from "../../lib/settleLimited";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { unitTripRows, unitTripTotals, kmPerTrip, kmOfDay, kmOfUnitDistance, trackedIdsByDay, avgLoadKg, avgLoadMs, workSpanMs, consolidateUnitRows } from "../../lib/unitTrips";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { ticketsByBridge } from "../../lib/weighbridgeSheets";
import { tonnes, gapLabel, clockLabel, stampLabel } from "../../api/weighments";

const STEP = 25;

/** A finished day's kilometres do not change: kept per organisation and day for the session. */
const kmCache = new Map();
/** A day being read, shared, so a re-render or a widened span never asks for it twice. */
const inFlight = new Map();

/** Units per request, the server's cap; and how often to ask again while Wialon is still being read. */
const UNITS_PER_ASK = 500;
const ASKS = 8;

/**
 * The day's distances for these units. The server pulls what it holds no odometer for from
 * Wialon a few units at a time and answers the rest `pending`, so the day is asked again
 * until none is. A server without the endpoint yet (404) answers with its GPS figure.
 */
async function askDayKm(orgId, day, ids) {
  const km = new Map();
  try {
    for (let i = 0; i < ids.length; i += UNITS_PER_ASK) {
      let want = ids.slice(i, i + UNITS_PER_ASK);
      for (let n = 0; n < ASKS && want.length; n++) {
        const res = await loadUnitDistance({ orgId, day, vehicleIds: want });
        const rows = res?.rows ?? [];
        for (const [id, d] of kmOfUnitDistance(rows.filter((r) => !r.pending))) km.set(id, d);
        want = rows.filter((r) => r.pending).map((r) => r.vehicleId);
      }
    }
    return km;
  } catch (err) {
    if (err?.status !== 404) throw err;
    return kmOfDay(await loadFuelConsumptionRate({ orgId, from: day, to: day }));
  }
}

function readDayKm(orgId, day, ids) {
  const key = `${orgId}|${day}|${ids.join(",")}`;
  if (kmCache.has(key)) return Promise.resolve(kmCache.get(key));
  if (!inFlight.has(key)) {
    inFlight.set(key, askDayKm(orgId, day, ids)
      .then((km) => {
        if (day < fleetDayKey()) kmCache.set(key, km);
        return km;
      })
      .finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

const kmLabel = (km) => (km == null ? "" : km.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });

/**
 * The day's kilometres for every unit, three days at a time, the latest first; `state` is
 * day → "ok" | "failed". Waits for `enabled`, which is the tickets having finished loading,
 * so the days asked for are the span's and not each part of it as it arrives.
 */
function useDayKm(orgId, idsByDay, enabled) {
  const [kmByDay, setKmByDay] = useState(() => new Map());
  const [state, setState] = useState(() => new Map());
  const days = [...idsByDay.keys()].sort();
  const key = [...idsByDay].map(([d, ids]) => `${d}:${ids.length}`).sort().join(",");
  useEffect(() => {
    if (!enabled || !orgId || !days.length) return undefined;
    let live = true;
    setKmByDay(new Map());
    setState(new Map());
    settleLimited([...days].reverse(), 3, async (d) => {
      try {
        const km = await readDayKm(orgId, d, idsByDay.get(d));
        if (!live) return;
        setKmByDay((m) => new Map(m).set(d, km));
        setState((m) => new Map(m).set(d, "ok"));
      } catch {
        if (live) setState((m) => new Map(m).set(d, "failed"));
      }
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, key, enabled]);
  return { kmByDay, state };
}

/**
 * One unit over the span, opened from a consolidated row (operator, 18 Nov 2026: "drop the drivers
 * column if we are consolidating and only have it populated on the sidebar if we click on the
 * single row"): its figures, who drove it, and each day it crossed a bridge.
 */
function UnitPanel({ row, kmText, onClose }) {
  const loadMs = avgLoadMs(row);
  return (
    <DetailSidebar title="Unit coverage" label={`Coverage for ${row.unit}`} itemKey={row.plate} onClose={onClose}>
      <DetailSidebarIdent
        name={row.unit}
        sub={`${row.days.length} day${row.days.length === 1 ? "" : "s"}${row.bridges.length ? ` · ${row.bridges.join(", ")}` : ""}`}
      />
      <DetailSidebarFacts facts={[
        { label: "Trips", value: String(row.trips) },
        { label: "Net weighed", value: tonnes(row.netKg) },
        { label: "Distance", value: row.km == null ? (kmText(row) || "-") : `${kmLabel(row.km)} km` },
        { label: "Average load", value: tonnes(avgLoadKg(row)) },
        { label: "Km per trip", value: kmPerTrip(row) == null ? "-" : kmLabel(kmPerTrip(row)) },
        { label: "Average load time", value: loadMs == null ? "-" : gapLabel(loadMs) },
      ]} />
      <DetailSidebarSection title="Drivers">
        {row.drivers.length
          ? <ul className="wbm-drivers">{row.drivers.map((d) => <li key={d}>{d}</li>)}</ul>
          : <p className="wb-ticket-note">No driver on its tickets.</p>}
      </DetailSidebarSection>
      <DetailSidebarSection title="By day">
        <table className="wbm-days">
          <thead>
            <tr>
              <th>Day</th>
              <th>Trips</th>
              <th>Net</th>
              <th>Km</th>
            </tr>
          </thead>
          <tbody>
            {[...row.perDay].reverse().map((d) => (
              <tr key={d.day}>
                <td>{dayLabel(d.day)}</td>
                <td>{d.trips}</td>
                <td>{tonnes(d.netKg)}</td>
                <td>{d.km == null ? "" : kmLabel(d.km)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DetailSidebarSection>
    </DetailSidebar>
  );
}

/*
 * The exports, titles, pager and footer follow the Tickets table's (operator, 18 Nov 2026:
 * "just like the default, especially when you pick more weighbridges"): the bridge picked
 * names the report; with every bridge, the Excel file's first sheet holds every unit and a
 * sheet follows for each weighbridge, counting the trips made over that bridge. A unit's
 * distance is its whole day's, so it is the same on every sheet it appears on.
 *
 * `consolidate` folds the span's days into one row per unit (operator, 18 Nov 2026: "if we
 * pick from 10/10 to 15/10 then we get to pick a single car and sum up its collective data");
 * search picks the car. Its drivers are in the panel a row opens, not in a column.
 */
export default function WeighbridgeCoverage({ orgId, tickets, from, to, search, canKm, fleet, span, centre, centreName, centres, consolidate, loading, onReload }) {
  const idsByDay = useMemo(() => trackedIdsByDay(unitTripRows(tickets)), [tickets]);
  const days = useMemo(() => [...new Set(unitTripRows(tickets).map((r) => r.day))].sort(), [tickets]);
  const { kmByDay, state } = useDayKm(orgId, idsByDay, canKm && !loading);
  const all = useMemo(() => unitTripRows(tickets, kmByDay), [tickets, kmByDay]);
  const q = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const keep = (r) => !q || r.plate.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q);
  const fold = (list) => (consolidate ? consolidateUnitRows(list) : list);
  const rows = useMemo(
    () => fold(q ? all.filter(keep) : all),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, q, consolidate],
  );
  const totals = unitTripTotals(rows);
  const oneDay = from === to;
  const reading = canKm && days.some((d) => !state.has(d));

  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [from, to, q, consolidate]);
  const pageCount = Math.max(1, Math.ceil(rows.length / STEP));
  const at = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(at * STEP, at * STEP + STEP);

  // The unit open in the side panel, by plate; only a consolidated row opens one
  const [openPlate, setOpenPlate] = useState(null);
  useEffect(() => { setOpenPlate(null); }, [from, to, centre, consolidate]);
  const openRow = consolidate && openPlate ? rows.find((r) => r.plate === openPlate) ?? null : null;
  const toggleRow = (r) => setOpenPlate((p) => (p === r.plate ? null : r.plate));

  /** What the distance cell says when there is no figure: blank for a unit with no tracker or none counted (operator, 18 Nov 2026). */
  const noKm = (r) => {
    const ds = r.days ?? [r.day];
    return !canKm ? "Not available"
      : !r.vehicleId ? ""
        : ds.some((d) => state.get(d) === "failed") ? "Not read"
          : ds.some((d) => !state.has(d)) ? "Reading…" : "";
  };
  /** A ticket's time: the clock on one day, the date with it over a span. */
  const when = (iso) => (oneDay ? clockLabel(iso) : stampLabel(iso, null));

  const allBridges = centre == null;
  const head = consolidate
    ? ["Unit", "Weighbridges", "Days", "Days with distance", "Trips", "First ticket", "Last ticket",
      "Net weighed, t", "Average load, t", "Average load time", "Distance, km", "Km per trip"]
    : ["Day", "Unit", "Driver", "Weighbridges", "Trips", "First ticket", "Last ticket", "First to last",
      "Net weighed, t", "Average load, t", "Average load time", "Distance, km", "Km per trip"];
  const bodyOf = (list) => list.map((r) => {
    const tail = [
      (r.netKg / 1000).toFixed(2), (avgLoadKg(r) / 1000).toFixed(2), avgLoadMs(r) == null ? "" : gapLabel(avgLoadMs(r)),
      r.km == null ? noKm(r) : r.km.toFixed(1), kmPerTrip(r) == null ? "" : kmPerTrip(r).toFixed(1),
    ];
    return consolidate
      ? [r.unit, r.bridges.join(", "), r.days.length, r.kmDays, r.trips, when(r.firstAt), r.trips > 1 ? when(r.lastAt) : "", ...tail]
      : [r.day, r.unit, r.drivers.join(", "), r.bridges.join(", "), r.trips,
        clockLabel(r.firstAt), r.trips > 1 ? clockLabel(r.lastAt) : "",
        workSpanMs(r) == null ? "" : gapLabel(workSpanMs(r)), ...tail];
  });
  const body = bodyOf(rows);
  // The same note, filename and sheets as the Tickets table's export.
  const note = [span, centreName || null, q ? `matching “${search}”` : null, consolidate ? "one row per unit" : null]
    .filter(Boolean).join(" · ");
  const filenameSlug = ["weighbridge-coverage", consolidate ? "by-unit" : "", from, oneDay ? "" : to, (centreName || "all").toLowerCase()]
    .filter(Boolean).join("-").replace(/[^a-z0-9-]/gi, "");
  // "Weighbridge Coverage at NYAONDO", each sheet its own bridge (operator, 18 Nov 2026)
  const titleOf = (bridge) => `Weighbridge Coverage at ${bridge}`;
  const reportTitle = centreName ? titleOf(centreName) : "Weighbridge Coverage across All Weighbridges";
  // Every sheet says what it covers: the dates, the bridge, a search
  const metaFor = (bridge) => [["Period", span], ["Weighbridge", bridge], ...(q ? [["Units matching", search.trim()]] : [])];
  const saveCsv = () => downloadTableCsv({
    head, body, filenameSlug, title: reportTitle,
    sheetName: centreName || "Coverage",
    meta: metaFor(centreName || "All"),
    ...(allBridges && {
      sheetName: "All weighbridges",
      sheets: ticketsByBridge(tickets, centres).map((g) => ({
        name: g.name,
        title: titleOf(g.name),
        body: bodyOf(fold(unitTripRows(g.rows, kmByDay).filter(keep))),
        meta: metaFor(g.name),
      })).filter((sh) => sh.body.length),
    }),
  });
  const savePdf = () => downloadLetterheadTablePdf({
    ...fleet,
    prefix: "WB",
    reportTitle,
    sectionTitle: `${centreName || "All weighbridges"}, ${span}`,
    filterNote: note,
    cards: [
      { label: "Units", value: String(totals.units) },
      { label: "Trips", value: String(totals.trips) },
      { label: "Net weighed", value: tonnes(totals.netKg) },
      { label: "Distance", value: `${kmLabel(totals.km) || "0.0"} km` },
      { label: "Trips per unit", value: totals.tripsPerUnit == null ? "-" : String(totals.tripsPerUnit) },
      { label: "Average load", value: totals.avgLoadKg == null ? "-" : tonnes(totals.avgLoadKg) },
      { label: "Km per trip", value: totals.kmPerTrip == null ? "-" : kmLabel(totals.kmPerTrip) },
    ],
    head, body,
  });

  /*
   * A file asked for while distances are still being read waits for them, then saves with
   * every figure in (operator, 18 Nov 2026: Excel "click does nothing" — the buttons were
   * disabled until the read finished). The save runs the latest render's handlers, so the
   * file holds the finished distances, not the ones on screen at the click.
   */
  const latest = useRef({});
  latest.current = { saveCsv, savePdf };
  const readWaiters = useRef([]);
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (reading) return;
    const ws = readWaiters.current;
    readWaiters.current = [];
    ws.forEach((resolve) => resolve());
  }, [reading]);
  const whenRead = () => (reading
    ? new Promise((resolve) => { readWaiters.current.push(resolve); })
    : Promise.resolve());
  const afterRead = (save) => {
    if (!reading) return save();
    const run = exportLater();
    setWaiting((n) => n + 1);
    return whenRead().then(() => run(save)).finally(() => setWaiting((n) => n - 1));
  };
  const exportCsv = () => afterRead(() => latest.current.saveCsv());
  const exportPdf = () => afterRead(() => latest.current.savePdf());

  return (
    <>
      {openRow && <UnitPanel row={openRow} kmText={noKm} onClose={() => setOpenPlate(null)} />}
      <TableToolbar
        summary={
          <>
            <b>{totals.units}</b> unit{totals.units === 1 ? "" : "s"} ·{" "}
            <b>{totals.trips}</b> trip{totals.trips === 1 ? "" : "s"} ·{" "}
            {tonnes(totals.netKg)} weighed ·{" "}
            {kmLabel(totals.km) || "0.0"} km{reading ? " so far" : ""}
            {waiting > 0 && <span className="sp4-muted" role="status"> · your file follows once the distances are read</span>}
          </>
        }
        note={note}
        loading={loading}
        onReload={onReload}
        onCsv={exportCsv}
        onPdf={exportPdf}
        disabled={!rows.length}
      />
      <div className="wb-grid-card">
        <div className="sp4-table-scroll sp4-keep-table wb-grid">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable wbm-table">
            <thead>
              <tr>
                {!oneDay && !consolidate && <th className="sp4-th--left">Day</th>}
                <th className="sp4-th--left sp4-th--pin">Unit</th>
                {!consolidate && <th className="sp4-th--left wb-col-full">Driver</th>}
                {allBridges && <th className="sp4-th--left wb-col-full">Weighbridges</th>}
                {consolidate && <th className="sp4-th--right">Days</th>}
                <th className="sp4-th--right">Trips</th>
                <th className="sp4-th--right wb-col-full">First ticket</th>
                <th className="sp4-th--right wb-col-full">Last ticket</th>
                {!consolidate && <th className="sp4-th--right wb-col-full">First to last</th>}
                <th className="sp4-th--right wb-col-full">Net weighed</th>
                <th className="sp4-th--right wb-col-full">Average load</th>
                <th className="sp4-th--right wb-col-full">Average load time</th>
                <th className="sp4-th--right">Distance, km</th>
                <th className="sp4-th--right wb-col-full">Km per trip</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const on = openRow?.plate === r.plate;
                const open = consolidate ? {
                  className: "sp4-tr" + (on ? " sp4-tr--selected" : ""),
                  "aria-selected": on,
                  tabIndex: 0,
                  onClick: () => toggleRow(r),
                  onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(r); } },
                } : { className: "sp4-tr" };
                return (
                  <tr key={`${r.day ?? "all"}|${r.plate}`} {...open}>
                    {!oneDay && !consolidate && <td className="sp4-td--left wb-mono">{dayLabel(r.day)}</td>}
                    <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{r.unit}</span></td>
                    {!consolidate && <td className="sp4-td--left wb-td-driver wb-col-full">{r.drivers.join(", ")}</td>}
                    {allBridges && <td className="sp4-td--left wb-col-full">{r.bridges.join(", ")}</td>}
                    {consolidate && <td className="sp4-td--right sp4-num">{r.days.length}</td>}
                    <td className="sp4-td--right sp4-num">{r.trips}</td>
                    <td className="sp4-td--right wb-mono wb-col-full">{consolidate ? when(r.firstAt) : clockLabel(r.firstAt)}</td>
                    <td className="sp4-td--right wb-mono wb-col-full">{r.trips > 1 ? (consolidate ? when(r.lastAt) : clockLabel(r.lastAt)) : ""}</td>
                    {!consolidate && <td className="sp4-td--right sp4-num wb-col-full">{workSpanMs(r) == null ? "" : gapLabel(workSpanMs(r))}</td>}
                    <td className="sp4-td--right sp4-num wb-col-full">{tonnes(r.netKg)}</td>
                    <td className="sp4-td--right sp4-num wb-col-full">{tonnes(avgLoadKg(r))}</td>
                    <td className="sp4-td--right sp4-num wb-col-full">{avgLoadMs(r) == null ? "" : gapLabel(avgLoadMs(r))}</td>
                    <td className="sp4-td--right sp4-num">
                      {r.km == null ? <span className="sp4-muted">{noKm(r)}</span> : kmLabel(r.km)}
                    </td>
                    <td className="sp4-td--right sp4-num wb-col-full">{kmLabel(kmPerTrip(r))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="wb-pager" aria-label="Unit pages">
            <button type="button" className="wb-pager__btn" onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}>
              ← Prev
            </button>
            <span className="wb-pager__info" aria-live="polite">
              Page {at + 1} of {pageCount}
              <span className="wb-pager__range">
                {" · "}{at * STEP + 1}–{at * STEP + pageRows.length} of {rows.length}
              </span>
            </span>
            <button type="button" className="wb-pager__btn" onClick={() => setPage(Math.min(pageCount - 1, at + 1))} disabled={at >= pageCount - 1}>
              Next →
            </button>
          </nav>
        )}
        <div className="sp4-grid-footer">
          {consolidate
            ? `${totals.units} unit${totals.units === 1 ? "" : "s"} in ${span}`
            : `${totals.unitDays} unit-day${totals.unitDays === 1 ? "" : "s"} in ${span}`}
          {centreName ? ` · ${centreName}` : ""}
          {" · "}{totals.tracked} with a distance
          {consolidate && rows.length > 0 && <span className="sp4-muted"> · open a unit for its drivers and days</span>}
          {(loading || reading) && <span className="sp4-muted"> · {reading ? "reading distances…" : "refreshing…"}</span>}
        </div>
      </div>
    </>
  );
}
