// Weighbridges › Tickets › Coverage (operator, 18 Nov 2026; first a Metrics view): each unit's trips on a day
// and the kilometres its tracker's odometer counted that day. The rows come
// from lib/unitTrips; this reads each day's distances from the server, which
// pulls a day it holds no odometer for from Wialon and stores it, and draws the
// table in the Tickets view's grid card, pager and export bar.

import { useEffect, useMemo, useRef, useState } from "react";
import { loadFuelConsumptionRate, loadUnitDistance, loadOdometerAt } from "../../api/reports";
import { downloadTableCsv, exportLater } from "../../utils/tableExport";
import ReportFilesBar from "./ReportFilesBar";
import { coverageDoc, spanWords } from "../../lib/weighbridgeDocs";
import { settleLimited } from "../../lib/settleLimited";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { fleetDaysBetween } from "../../lib/weighbridgeBoard";
import {
  unitTripRows, unitTripTotals, kmPerTrip, kmOfDay, kmOfUnitDistance, trackedIdsByDay, avgLoadKg, avgLoadMs, workSpanMs,
  consolidateUnitRows, distanceFirst, tripLegs, tripKmByTicket, odoKey, tripOdoPoints, tripEdgesKm,
} from "../../lib/unitTrips";
import DetailSidebar from "../shared/DetailSidebar";
import "./CoverageUnitPanel.css";
import { ticketsByBridge } from "../../lib/weighbridgeSheets";
import { tonnes, gapLabel, clockLabel, stampLabel, getWeighmentDay } from "../../api/weighments";

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

/** A finished day's tickets at every bridge, per organisation and day, for the trips' starts. */
const ticketDayCache = new Map();
async function readAllBridgeDay(orgId, day) {
  const key = `${orgId}|${day}`;
  if (ticketDayCache.has(key)) return ticketDayCache.get(key);
  const rows = (await getWeighmentDay({ orgId, day }))?.rows ?? [];
  if (day < fleetDayKey()) ticketDayCache.set(key, rows);
  return rows;
}
const dayBefore = (day) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The tickets a gross-first trip can start from: every bridge's, over the span and the day before, so a
 * unit's first ticket of a day has the one before it, wherever that was weighed. With every
 * bridge picked the span's are on screen already and only the day before is read. Null while
 * reading, "failed" when a day could not be read.
 */
function useTripTickets(orgId, tickets, from, to, centre, enabled) {
  const [extra, setExtra] = useState(null);
  useEffect(() => {
    if (!enabled || !orgId || !from) return undefined;
    let live = true;
    setExtra(null);
    const days = centre == null ? [dayBefore(from)] : fleetDaysBetween(dayBefore(from), to);
    settleLimited(days, 4, (d) => readAllBridgeDay(orgId, d)).then((res) => {
      if (!live) return;
      setExtra(res.some((r) => r.status === "rejected") ? "failed" : res.flatMap((r) => r.value));
    });
    return () => { live = false; };
  }, [orgId, from, to, centre, enabled]);
  return useMemo(
    () => (Array.isArray(extra) ? (centre == null ? [...extra, ...tickets] : extra) : extra),
    [extra, tickets, centre],
  );
}

/** Odometer readings at moments that will not change, per organisation, unit and moment. */
const odoCache = new Map();
/** Points per request, half the server's cap so a day's fill stays within one ask. */
const POINTS_PER_ASK = 1000;

/** The readings at these moments ({ vehicleId, ms }), asked again while Wialon is still being read. */
async function askOdometer(orgId, points) {
  const got = new Map();
  const settled = Date.now() - 12 * 3_600_000;
  const want = [];
  for (const p of points) {
    const c = `${orgId}|${odoKey(p.vehicleId, p.ms)}`;
    if (odoCache.has(c)) got.set(odoKey(p.vehicleId, p.ms), odoCache.get(c));
    else want.push(p);
  }
  for (let i = 0; i < want.length; i += POINTS_PER_ASK) {
    let ask = want.slice(i, i + POINTS_PER_ASK);
    for (let n = 0; n < ASKS && ask.length; n++) {
      const res = await loadOdometerAt({ orgId, points: ask.map((p) => ({ vehicleId: p.vehicleId, at: new Date(p.ms).toISOString() })) });
      const again = [];
      for (const r of res?.readings ?? []) {
        const ms = Date.parse(r.at);
        if (r.pending) { again.push({ vehicleId: r.vehicleId, ms }); continue; }
        got.set(odoKey(r.vehicleId, ms), r.odometerM);
        if (ms < settled) odoCache.set(`${orgId}|${odoKey(r.vehicleId, ms)}`, r.odometerM);
      }
      ask = again;
    }
  }
  return got;
}

/**
 * The odometer at these moments (tripOdoPoints: each trip's two ends, midnight where a trip runs
 * past its day), a fleet day at a time, the latest first. `reading` until every day has answered;
 * `failed` when one could not be read.
 */
function useTripReadings(orgId, points, enabled) {
  const [readings, setReadings] = useState(() => new Map());
  const [doneKey, setDoneKey] = useState(null);
  const [failed, setFailed] = useState(false);
  const key = `${orgId}|${points.length}|${points.reduce((h, p) => (h * 31 + p.ms / 1000) % 1e9, 0)}`;
  useEffect(() => {
    if (!enabled || !orgId) return undefined;
    let live = true;
    setReadings(new Map());
    setFailed(false);
    const byDay = new Map();
    for (const p of points) {
      const d = fleetDayKey(new Date(p.ms));
      if (!byDay.has(d)) byDay.set(d, new Map());
      byDay.get(d).set(odoKey(p.vehicleId, p.ms), p);
    }
    const days = [...byDay.keys()].sort().reverse();
    settleLimited(days, 2, async (d) => {
      const got = await askOdometer(orgId, [...byDay.get(d).values()]);
      if (live) setReadings((m) => new Map([...m, ...got]));
    }).then((res) => {
      if (!live) return;
      if (res.some((r) => r.status === "rejected")) setFailed(true);
      setDoneKey(key);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { readings, reading: enabled && doneKey !== key, failed };
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

/** Each driver on the unit's tickets and the days they drove it, the most days first. */
function driverDays(perDay) {
  const days = new Map();
  for (const d of perDay) for (const name of d.drivers ?? []) days.set(name, (days.get(name) ?? 0) + 1);
  return [...days].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const spanOf = (days) => {
  const short = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const first = days[0];
  const last = days[days.length - 1];
  return first === last ? short(first) : `${short(first)} to ${short(last)}`;
};

/**
 * One unit over the span, opened from a consolidated row (operator, 18 Nov 2026: "drop the drivers
 * column if we are consolidating and only have it populated on the sidebar if we click on the
 * single row"). Km per trip leads, the figure the panel is opened for; the span's other figures
 * under it; who drove it and on how many days; then the day-by-day ledger, each day's drivers
 * under its date and the span's total at the foot.
 *
 * `tripsState` is "reading" | "failed" | "ok" for the trip measurements; `kmText` says why a
 * distance cell is empty.
 */
function UnitPanel({ row, kmText, tripsState, onClose }) {
  const loadMs = avgLoadMs(row);
  const perTrip = kmPerTrip(row);
  const drivers = driverDays(row.perDay);
  const nDays = row.days.length;
  const distance = row.km == null ? (kmText(row) || "None") : `${kmLabel(row.km)} km`;
  // Why there is no figure, said plainly rather than left as a dash
  const perTripNote = perTrip != null
    ? `The average of ${row.tripN} measured trip${row.tripN === 1 ? "" : "s"}, from leaving a weighbridge empty to coming back laden.`
    : !row.vehicleId ? "Not a tracked unit, so its trips have no distance."
      : tripsState === "reading" ? "Reading the odometer at each end of its trips."
        : tripsState === "failed" ? "Its trips could not be read. Reload to try again."
          : "None of its trips has an odometer reading at both ends.";
  return (
    <DetailSidebar title="Unit coverage" label={`Coverage for ${row.unit}`} itemKey={row.plate} onClose={onClose}>
      <div className="wcp-ident">
        <h2 className="wcp-unit">{row.unit}</h2>
        <p className="wcp-span">{nDays} day{nDays === 1 ? "" : "s"}, {spanOf(row.days)}</p>
        {row.bridges.length > 0 && <p className="wcp-span">Weighed at {row.bridges.join(", ")}</p>}
      </div>

      <section className="wcp-lead" aria-label="Km per trip">
        <p className="wcp-lead__label">Km per trip</p>
        <p className={"wcp-lead__value" + (perTrip == null ? " wcp-lead__value--none" : "")}>
          {perTrip == null ? (tripsState === "reading" && row.vehicleId ? "Measuring" : "None") : kmLabel(perTrip)}
          {perTrip != null && <span className="wcp-lead__unit">km</span>}
        </p>
        <p className="wcp-lead__note">{perTripNote}</p>
      </section>

      <dl className="wcp-figs">
        <div><dt>Trips</dt><dd>{row.trips}</dd></div>
        <div><dt>Net weighed</dt><dd>{tonnes(row.netKg)}</dd></div>
        <div><dt>Distance</dt><dd>{distance}</dd></div>
        <div><dt>Average load</dt><dd>{tonnes(avgLoadKg(row))}</dd></div>
        <div><dt>Average load time</dt><dd>{loadMs == null ? "None" : gapLabel(loadMs)}</dd></div>
        <div><dt>Days with a distance</dt><dd>{row.kmDays} of {nDays}</dd></div>
      </dl>

      <section className="wcp-sec">
        <h3 className="wcp-h">Drivers</h3>
        {drivers.length
          ? (
            <ul className="wcp-drivers">
              {drivers.map(([name, n]) => (
                <li key={name}><span>{name}</span><span className="wcp-drivers__days">{n} day{n === 1 ? "" : "s"}</span></li>
              ))}
            </ul>
          )
          : <p className="wcp-empty">No driver is named on its tickets.</p>}
      </section>

      <section className="wcp-sec">
        <h3 className="wcp-h">By day</h3>
        <table className="wcp-days">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Trips</th>
              <th scope="col">Net, t</th>
              <th scope="col">Km</th>
              <th scope="col">Km per trip</th>
            </tr>
          </thead>
          <tbody>
            {[...row.perDay].reverse().map((d) => (
              <tr key={d.day}>
                <th scope="row">
                  <span className="wcp-days__date">{dayLabel(d.day)}</span>
                  {d.drivers.length > 0 && <span className="wcp-days__who">{d.drivers.join(", ")}</span>}
                </th>
                <td>{d.trips}</td>
                <td>{(d.netKg / 1000).toFixed(2)}</td>
                <td>{d.km == null ? <span className="wcp-dim">{kmText(d) || "None"}</span> : kmLabel(d.km)}</td>
                <td>{perTripOrNone(d)}</td>
              </tr>
            ))}
          </tbody>
          {nDays > 1 && (
            <tfoot>
              <tr>
                <th scope="row">All {nDays} days</th>
                <td>{row.trips}</td>
                <td>{(row.netKg / 1000).toFixed(2)}</td>
                <td>{row.km == null ? "" : kmLabel(row.km)}</td>
                <td>{perTripOrNone(row)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </DetailSidebar>
  );
}

const perTripOrNone = (r) => (kmPerTrip(r) == null ? <span className="wcp-dim">None</span> : kmLabel(kmPerTrip(r)));

/*
 * The exports, titles, pager and footer follow the Tickets table's (operator, 18 Nov 2026:
 * "just like the default, especially when you pick more weighbridges"): the bridge picked
 * names the report; with every bridge, the Excel file's first sheet holds every unit and a
 * sheet follows for each weighbridge, counting the trips made over that bridge. A unit's
 * distance is its whole day's, with its trips' kilometres past midnight either side, so it is the
 * same on every sheet it appears on.
 *
 * `consolidate` folds the span's days into one row per unit (operator, 18 Nov 2026: "if we
 * pick from 10/10 to 15/10 then we get to pick a single car and sum up its collective data");
 * search picks the car. Its drivers are in the panel a row opens, not in a column.
 */
export default function WeighbridgeCoverage({ orgId, tickets, from, to, search, canKm, fleet, span, centre, centreName, centres, consolidate, loading, onReload }) {
  const idsByDay = useMemo(() => trackedIdsByDay(unitTripRows(tickets)), [tickets]);
  const days = useMemo(() => [...new Set(unitTripRows(tickets).map((r) => r.day))].sort(), [tickets]);
  const { kmByDay, state } = useDayKm(orgId, idsByDay, canKm && !loading);
  // Km per trip: each trip arriving for a ticket on screen, measured by the odometer at its two ends
  const tripTickets = useTripTickets(orgId, tickets, from, to, centre, canKm && !loading);
  const legs = useMemo(() => {
    if (!Array.isArray(tripTickets)) return [];
    // Each trip under its ticket's fleet day, the row it is counted in
    const dayOf = new Map(tickets.filter((t) => t.tokenAt).map((t) => [t.id, fleetDayKey(new Date(t.tokenAt))]));
    return tripLegs(tripTickets).filter((l) => dayOf.has(l.ticketId)).map((l) => ({ ...l, day: dayOf.get(l.ticketId) }));
  }, [tripTickets, tickets]);
  const points = useMemo(() => tripOdoPoints(legs), [legs]);
  const trips = useTripReadings(orgId, points, canKm && !loading && Array.isArray(tripTickets));
  const tripKm = useMemo(() => tripKmByTicket(legs, trips.readings), [legs, trips.readings]);
  // A trip's kilometres outside its day, added to the row's distance (lib/unitTrips)
  const edges = useMemo(() => tripEdgesKm(legs, trips.readings, tripKm), [legs, trips.readings, tripKm]);
  const tripsReading = canKm && (tripTickets == null || trips.reading);
  const tripsFailed = tripTickets === "failed" || trips.failed;
  const all = useMemo(() => unitTripRows(tickets, kmByDay, tripKm, edges), [tickets, kmByDay, tripKm, edges]);
  const q = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const keep = (r) => !q || r.plate.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q);
  // One row per unit when consolidating; either way, rows with a distance first, by date-time
  const fold = (list) => distanceFirst(consolidate ? consolidateUnitRows(list) : list);
  const rows = useMemo(
    () => fold(q ? all.filter(keep) : all),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, q, consolidate],
  );
  const totals = unitTripTotals(rows);
  const oneDay = from === to;
  const kmReading = canKm && days.some((d) => !state.has(d));
  // The files wait for both: the day's distances and the trips' (operator, 18 Nov 2026)
  const reading = kmReading || tripsReading;

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
  // No km per trip column (operator, 18 Nov 2026): the figure stays in the totals and the unit panel
  const head = consolidate
    ? ["Unit", "Weighbridges", "Days", "Days with distance", "Trips", "First ticket", "Last ticket",
      "Net weighed, t", "Average load, t", "Average load time", "Distance, km"]
    : ["Day", "Unit", "Driver", "Weighbridges", "Trips", "First ticket", "Last ticket", "First to last",
      "Net weighed, t", "Average load, t", "Average load time", "Distance, km"];
  const bodyOf = (list) => list.map((r) => {
    const tail = [
      (r.netKg / 1000).toFixed(2), (avgLoadKg(r) / 1000).toFixed(2), avgLoadMs(r) == null ? "" : gapLabel(avgLoadMs(r)),
      r.km == null ? noKm(r) : r.km.toFixed(1),
    ];
    return consolidate
      ? [r.unit, r.bridges.join(", "), r.days.length, r.kmDays, r.trips, when(r.firstAt), r.trips > 1 ? when(r.lastAt) : "", ...tail]
      : [r.day, r.unit, r.drivers.join(", "), r.bridges.join(", "), r.trips,
        clockLabel(r.firstAt), r.trips > 1 ? clockLabel(r.lastAt) : "",
        workSpanMs(r) == null ? "" : gapLabel(workSpanMs(r)), ...tail];
  });
  const body = bodyOf(rows);
  // The same filename and sheets as the Tickets table's export.
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
        body: bodyOf(fold(unitTripRows(g.rows, kmByDay, tripKm, edges).filter(keep))),
        meta: metaFor(g.name),
      })).filter((sh) => sh.body.length),
    }),
  });
  // The PDF, JPEG and Preview the Movements tabs make, drawn by the server (operator, 18 Nov 2026)
  const sheet = (landscape) => coverageDoc({
    title: reportTitle, head, body,
    fleet: fleet.companyName, orgCode: fleet.orgCode, bridge: centreName, span: spanWords(from, to),
    search: q ? search : "", consolidated: consolidate, landscape,
    figures: [
      { label: "Units", value: String(totals.units) },
      { label: "Trips", value: String(totals.trips) },
      { label: "Net weighed, t", value: (totals.netKg / 1000).toFixed(2) },
      { label: "Distance, km", value: kmLabel(totals.km) || "0.0" },
      { label: "Trips per unit", value: totals.tripsPerUnit == null ? "-" : String(totals.tripsPerUnit) },
      { label: "Average load, t", value: totals.avgLoadKg == null ? "-" : (totals.avgLoadKg / 1000).toFixed(2) },
      { label: "Km per trip", value: totals.kmPerTrip == null ? "-" : kmLabel(totals.kmPerTrip) },
      { label: "Trips measured", value: String(totals.measuredTrips ?? 0) },
    ],
  });

  /*
   * A file asked for while distances are still being read waits for them, then saves with
   * every figure in (operator, 18 Nov 2026: Excel "click does nothing" — the buttons were
   * disabled until the read finished). The save runs the latest render's handlers, so the
   * file holds the finished distances, not the ones on screen at the click.
   */
  const latest = useRef({});
  latest.current = { saveCsv, sheet };
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

  return (
    <>
      {openRow && (
        <UnitPanel
          row={openRow}
          kmText={noKm}
          tripsState={tripsReading ? "reading" : tripsFailed ? "failed" : "ok"}
          onClose={() => setOpenPlate(null)}
        />
      )}
      <ReportFilesBar
        orgId={orgId}
        source={rows}
        title={reportTitle}
        ready={whenRead}
        sheet={(landscape) => latest.current.sheet(landscape)}
        summary={
          <>
            <b>{totals.units}</b> unit{totals.units === 1 ? "" : "s"} ·{" "}
            <b>{totals.trips}</b> trip{totals.trips === 1 ? "" : "s"} ·{" "}
            {tonnes(totals.netKg)} weighed ·{" "}
            {kmLabel(totals.km) || "0.0"} km{kmReading ? " so far" : ""}
            {totals.kmPerTrip != null && <> · {kmLabel(totals.kmPerTrip)} km a trip over {totals.measuredTrips} measured{tripsReading ? " so far" : ""}</>}
            {waiting > 0 && <span className="sp4-muted" role="status"> · your file follows once the distances are read</span>}
          </>
        }
        loading={loading}
        onReload={onReload}
        onCsv={exportCsv}
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
          {(loading || reading) && <span className="sp4-muted"> · {loading ? "refreshing…" : kmReading ? "reading distances…" : "measuring trips…"}</span>}
          {!loading && !reading && tripsFailed && <span className="sp4-muted"> · some trips could not be measured, reload to try again</span>}
        </div>
      </div>
    </>
  );
}
