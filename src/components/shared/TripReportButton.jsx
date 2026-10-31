// Downloads the trip report as a PDF (api/tripReport) for a dispatch, or for
// the unit's latest dispatch when `report.dispatch` is null. The server makes
// the report; a spinner sits on the button while it does, and nothing opens.
//
// Beside it, a calendar (DayTripsPicker): pick a day, see that day's trips,
// and download the report for one of them or for the whole day
// (api/dayReport; the server cuts the day into trips and makes the PDF).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadTripReport } from "../../api/tripReport";
import { listDayTrips, downloadDayReport, fleetToday } from "../../api/dayReport";
import "./TripReportButton.css";

const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
const clock = (t) => CLOCK.format(t);
const km = (m) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;

export default function TripReportButton({ report, label = "Trip report" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!report) return null;
  const download = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await downloadTripReport(report); } catch (err) { setError(err?.message ?? String(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <span className="dc-report-group">
        <button type="button" className="dc-report" onClick={download} aria-busy={busy} disabled={busy}
          title={error ?? "Download the trip report as a PDF"}>
          {busy && <span className="dc-report-spin" aria-hidden="true" />}
          {busy ? "Preparing PDF…" : label}
        </button>
        {report.vehicleId && <DayTripsPicker orgId={report.orgId} vehicleId={report.vehicleId} />}
      </span>
      {error && <span className="dc-report-err" role="alert">The report could not be made: {error}</span>}
    </>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** The calendar button and its list of the picked day's trips. */
export function DayTripsPicker({ orgId, vehicleId }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(fleetToday());
  const [state, setState] = useState({ loading: false, trips: null, error: null });
  const [making, setMaking] = useState(null);   // "day" | trip number, while its PDF is made
  const [failed, setFailed] = useState(null);
  const box = useRef(null);
  const pop = useRef(null);
  const [at, setAt] = useState(null);

  // The panel is portalled to <body> and placed under the button, so the
  // narrow, scrolling map card cannot clip it.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth, vh = window.innerHeight, gap = 8;
      const w = Math.min(340, vw - 32);
      // Beside the card the button sits on (the map's vehicle card), so the
      // card stays readable; its bottom level with the button.
      const card = box.current.closest(".vehicle-tooltip, .dc-card, .vt-card")?.getBoundingClientRect() ?? r;
      const bottom = Math.max(gap, vh - r.bottom);
      const maxHeight = vh - bottom - gap;
      if (card.left - w - gap >= gap) { setAt({ left: card.left - w - gap, bottom, width: w, maxHeight }); return; }
      if (card.right + w + gap <= vw - gap) { setAt({ left: card.right + gap, bottom, width: w, maxHeight }); return; }
      // No room at the sides (a phone): under or over the button, on top.
      const left = Math.max(gap, Math.min(r.right - w, vw - w - gap));
      setAt(vh - r.bottom > 260 || r.top < 260
        ? { left, top: r.bottom + 6, width: w, maxHeight: vh - r.bottom - 6 - gap }
        : { left, bottom: vh - r.top + 6, width: w, maxHeight: r.top - 6 - gap });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (box.current?.contains(e.target) || pop.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // The day's trips, loaded when the panel is open and the day changes.
  useEffect(() => {
    if (!open || !day) return undefined;
    let live = true;
    setState({ loading: true, trips: null, error: null });
    setFailed(null);
    listDayTrips({ orgId, vehicleId, day })
      .then((trips) => { if (live) setState({ loading: false, trips, error: null }); })
      .catch((err) => { if (live) setState({ loading: false, trips: null, error: err?.message ?? String(err) }); });
    return () => { live = false; };
  }, [open, day, orgId, vehicleId]);

  const make = async (trip) => {
    if (making != null) return;
    setMaking(trip ? trip.n : "day"); setFailed(null);
    try { await downloadDayReport({ orgId, vehicleId, day, trip }); }
    catch (err) { setFailed(err?.message ?? String(err)); }
    finally { setMaking(null); }
  };

  const { loading, trips, error } = state;
  const reportBtn = (key, onClick, title) => (
    <button type="button" className="dtp-dl" onClick={onClick} disabled={making != null} aria-busy={making === key} title={title}>
      {making === key && <span className="dc-report-spin" aria-hidden="true" />}
      {making === key ? "Preparing…" : "Report"}
    </button>
  );

  return (
    <span className="dtp" ref={box}>
      <button type="button" className="dc-report dtp-btn" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-haspopup="dialog" title="Report for a day or one of its trips">
        <CalendarIcon />
      </button>
      {open && at && createPortal(
        <div className={`dtp-pop${document.querySelector(".app--light") ? " dtp-pop--light" : ""}`} ref={pop}
          role="dialog" aria-label="Day and trip reports" style={at}>
          <label className="dtp-day">
            <span>Day</span>
            <input type="date" value={day} max={fleetToday()} onChange={(e) => setDay(e.target.value)} />
          </label>

          {loading && <p className="dtp-note"><span className="dc-report-spin" aria-hidden="true" /> Loading the day…</p>}
          {error && <p className="dtp-note dtp-bad">Could not load that day: {error}</p>}
          {trips && trips.length === 0 && <p className="dtp-note">No trips on this day.</p>}

          {trips && trips.length > 0 && (
            <ul className="dtp-list">
              {trips.map((t) => (
                <li key={t.n} className="dtp-row">
                  <span className="dtp-time">{clock(t.from)}–{clock(t.to)}</span>
                  <span className="dtp-route" title={`${t.fromName ?? "?"} → ${t.toName ?? "?"}`}>
                    {t.fromName ?? "—"} → {t.toName ?? "—"}
                  </span>
                  <span className="dtp-km">{km(t.distanceM)}</span>
                  {reportBtn(t.n, () => make(t), `Download the report for trip ${t.n}`)}
                </li>
              ))}
            </ul>
          )}

          {trips && (
            <div className="dtp-row dtp-whole">
              <span className="dtp-route">Whole day</span>
              {reportBtn("day", () => make(null), "Download the report for the whole day")}
            </div>
          )}
          {failed && <p className="dtp-note dtp-bad" role="alert">The report could not be made: {failed}</p>}
          <p className="dtp-foot">A trip ends after a stop of 30 min or more.</p>
        </div>,
        document.body,
      )}
    </span>
  );
}
