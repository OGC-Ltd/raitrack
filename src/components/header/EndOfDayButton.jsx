// "End of day" in the top bar, beside the organisation switcher: pick a day
// and download the organisation's end-of-day report (api/endOfDayReport) —
// fleet summary, safety, fuel and device health on the house PDF layout.

import { useEffect, useRef, useState } from "react";
import { downloadEndOfDayReport, fleetToday } from "../../api/endOfDayReport";
import "./EndOfDayButton.css";

export default function EndOfDayButton({ company }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(fleetToday());
  const [busy, setBusy] = useState(null);     // progress text while it is made
  const [error, setError] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!company) return null;

  const run = async () => {
    if (busy) return;
    setBusy("Preparing"); setError(null);
    try {
      await downloadEndOfDayReport({ company, day, onProgress: setBusy });
      setOpen(false);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="eod" ref={box}>
      <button type="button" className={`eod-btn${open ? " eod-btn--open" : ""}`} onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog" aria-expanded={open} title="Download the end-of-day report for this organisation">
        <i className="ti ti-file-report" aria-hidden="true" />
        <span className="eod-btn-word">End of day</span>
      </button>
      {open && (
        <div className="eod-pop" role="dialog" aria-label="End-of-day report">
          <div className="eod-title">End-of-day report</div>
          <div className="eod-org">{company.name}</div>
          <label className="eod-day">
            <span>Day</span>
            <input type="date" value={day} max={fleetToday()} onChange={(e) => setDay(e.target.value)} disabled={Boolean(busy)} />
          </label>
          <p className="eod-what">Fleet summary, safety (overspeeding, harsh braking, no seatbelt, phone use), fuel and device health.</p>
          <button type="button" className="eod-go" onClick={run} disabled={Boolean(busy) || !day} aria-busy={Boolean(busy)}>
            {busy && <span className="eod-spin" aria-hidden="true" />}
            {busy ? `${busy}…` : "Download PDF"}
          </button>
          {error && <p className="eod-err" role="alert">The report could not be made: {error}</p>}
        </div>
      )}
    </div>
  );
}
