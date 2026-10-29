// Downloads the trip report as a PDF (api/tripReport) for a dispatch, or for
// the unit's latest dispatch when `report.dispatch` is null. A spinner sits on
// the button while it is made; nothing opens.

import { useState } from "react";
import { downloadTripReport } from "../../api/tripReport";
import "./TripReportButton.css";

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
      <button type="button" className="dc-report" onClick={download} aria-busy={busy} disabled={busy}
        title={error ?? "Download the trip report as a PDF"}>
        {busy && <span className="dc-report-spin" aria-hidden="true" />}
        {busy ? "Preparing PDF…" : label}
      </button>
      {error && <span className="dc-report-err" role="alert">The report could not be made: {error}</span>}
    </>
  );
}
