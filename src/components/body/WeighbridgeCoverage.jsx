// Weighbridges › Tickets › Coverage (operator, 18 Nov 2026; first a Metrics view): each unit's trips on a day
// and the kilometres its tracker's odometer counted that day. The rows come
// from lib/unitTrips; this reads each day's distances from the server, which
// pulls a day it holds no odometer for from Wialon and stores it, and draws the
// table in the Tickets view's grid card, pager and export bar.

import { useEffect, useMemo, useState } from "react";
import TableToolbar from "./TableToolbar";
import { loadFuelConsumptionRate, loadUnitDistance } from "../../api/reports";
import { downloadTableCsv } from "../../utils/tableExport";
import { downloadLetterheadTablePdf } from "../../api/tableLetterheadPdf";
import { settleLimited } from "../../lib/settleLimited";
import { fleetDayKey } from "../../hooks/useFuelEvents";
import { unitTripRows, unitTripTotals, kmPerTrip, kmOfDay, kmOfUnitDistance, trackedIdsByDay } from "../../lib/unitTrips";
import { tonnes, tonnesTotal } from "../../api/weighments";

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

export default function WeighbridgeCoverage({ orgId, tickets, from, to, search, canKm, fleet, periodLabel, loading, onReload }) {
  const idsByDay = useMemo(() => trackedIdsByDay(unitTripRows(tickets)), [tickets]);
  const days = useMemo(() => [...new Set(unitTripRows(tickets).map((r) => r.day))].sort(), [tickets]);
  const { kmByDay, state } = useDayKm(orgId, idsByDay, canKm && !loading);
  const all = useMemo(() => unitTripRows(tickets, kmByDay), [tickets, kmByDay]);
  const q = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rows = useMemo(
    () => (q ? all.filter((r) => r.plate.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q)) : all),
    [all, q],
  );
  const totals = unitTripTotals(rows);
  const oneDay = from === to;
  const reading = canKm && days.some((d) => !state.has(d));

  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [from, to, q]);
  const pageCount = Math.max(1, Math.ceil(rows.length / STEP));
  const at = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(at * STEP, at * STEP + STEP);

  /** What the distance cell says when there is no figure. */
  const noKm = (r) => (!canKm ? "Not available"
    : !r.vehicleId ? "No tracker"
      : state.get(r.day) === "failed" ? "Not read"
        : !state.has(r.day) ? "Reading…" : "No GPS that day");

  const head = ["Day", "Unit", "Driver", "Trips", "Net weighed, t", "Distance, km", "Km per trip"];
  const body = rows.map((r) => [
    r.day, r.unit, r.drivers.join(", "), r.trips, (r.netKg / 1000).toFixed(2),
    r.km == null ? noKm(r) : r.km.toFixed(1), kmPerTrip(r) == null ? "" : kmPerTrip(r).toFixed(1),
  ]);
  const note = [periodLabel, q ? `matching “${search}”` : null, "distance by the tracker's odometer, from Wialon"].filter(Boolean).join(", ");
  const filenameSlug = ["weighbridge-coverage", from, oneDay ? "" : to].join("-").replace(/[^a-z0-9-]/gi, "");

  return (
    <>
      <TableToolbar
        summary={
          <>
            <b>{totals.units}</b> unit{totals.units === 1 ? "" : "s"}, <b>{totals.trips}</b> trip{totals.trips === 1 ? "" : "s"},{" "}
            {kmLabel(totals.km) || "0.0"} km{reading ? " so far" : ""}
          </>
        }
        loading={loading}
        onReload={onReload}
        onCsv={() => downloadTableCsv({ head, body, filenameSlug, title: "Weighbridge Coverage", sheetName: "Coverage" })}
        onPdf={() => downloadLetterheadTablePdf({
          ...fleet,
          prefix: "WB",
          reportTitle: "Weighbridge Coverage",
          sectionTitle: `Trips and distance, ${periodLabel}`,
          filterNote: note,
          cards: [
            { label: "Units", value: String(totals.units) },
            { label: "Trips", value: String(totals.trips) },
            { label: "Distance", value: `${kmLabel(totals.km) || "0.0"} km` },
          ],
          head, body,
        })}
        disabled={!rows.length || reading}
      />
      <div className="wb-grid-card">
        <div className="sp4-table-scroll sp4-keep-table wb-grid">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable wbm-table">
            <thead>
              <tr>
                {!oneDay && <th className="sp4-th--left">Day</th>}
                <th className="sp4-th--left sp4-th--pin">Unit</th>
                <th className="sp4-th--left wb-col-full">Driver</th>
                <th className="sp4-th--right">Trips</th>
                <th className="sp4-th--right wb-col-full">Net weighed</th>
                <th className="sp4-th--right">Distance, km</th>
                <th className="sp4-th--right wb-col-full">Km per trip</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={`${r.day}|${r.plate}`} className="sp4-tr">
                  {!oneDay && <td className="sp4-td--left wb-mono">{dayLabel(r.day)}</td>}
                  <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{r.unit}</span></td>
                  <td className="sp4-td--left wb-td-driver wb-col-full">{r.drivers.join(", ")}</td>
                  <td className="sp4-td--right sp4-num">{r.trips}</td>
                  <td className="sp4-td--right sp4-num wb-col-full">{tonnes(r.netKg)}</td>
                  <td className="sp4-td--right sp4-num">
                    {r.km == null ? <span className="sp4-muted">{noKm(r)}</span> : kmLabel(r.km)}
                  </td>
                  <td className="sp4-td--right sp4-num wb-col-full">{kmLabel(kmPerTrip(r))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="wbm-total">
                {!oneDay && <td className="sp4-td--left" />}
                <td className="sp4-td--left sp4-td--pin">Total</td>
                <td className="sp4-td--left wb-col-full" />
                <td className="sp4-td--right sp4-num">{totals.trips}</td>
                <td className="sp4-td--right sp4-num wb-col-full">{tonnesTotal(totals.netKg)}</td>
                <td className="sp4-td--right sp4-num">{kmLabel(totals.km)}</td>
                <td className="sp4-td--right sp4-num wb-col-full" />
              </tr>
            </tfoot>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="wb-pager" aria-label="Unit pages">
            <button type="button" className="wb-pager__btn" onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0}>
              ← Prev
            </button>
            <span className="wb-pager__info" aria-live="polite">Page {at + 1} of {pageCount}</span>
            <button type="button" className="wb-pager__btn" onClick={() => setPage(Math.min(pageCount - 1, at + 1))} disabled={at >= pageCount - 1}>
              Next →
            </button>
          </nav>
        )}
        <div className="sp4-grid-footer">
          A trip is one weighbridge ticket. Distance is the tracker&apos;s own odometer over the day, from Wialon;
          {" "}{totals.tracked} of {totals.unitDays} unit-days have one.
          {reading && <span className="sp4-muted"> Reading distances…</span>}
        </div>
      </div>
    </>
  );
}
