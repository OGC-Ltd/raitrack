// Opens the printable trip report (api/tripReport) for a dispatch, or for the
// unit's latest dispatch when `report.dispatch` is null.

import { useState } from "react";
import { openTripReport } from "../../api/tripReport";
import "./TripReportButton.css";

export default function TripReportButton({ report, label = "Trip report" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!report) return null;
  const open = async () => {
    setBusy(true); setError(null);
    try { await openTripReport(report); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="dc-report" onClick={open} disabled={busy} title={error ?? "Open the trip report to print or save as PDF"}>
        {busy ? "Preparing…" : label}
      </button>
      {error && <span className="dc-report-err" role="alert">{error}</span>}
    </>
  );
}
