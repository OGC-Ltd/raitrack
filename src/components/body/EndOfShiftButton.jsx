// "End of shift" on the Weighbridges screen: one click downloads the
// organisation's end-of-shift report, 06:00 to now. The server makes it
// (api/endOfShiftReport); the button only waits for the file.

import { useState } from "react";
import { downloadEndOfShiftReport } from "../../api/endOfShiftReport";
import "./EndOfShiftButton.css";

export default function EndOfShiftButton({ orgId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!orgId) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await downloadEndOfShiftReport({ orgId });
    } catch (err) {
      setError(err?.message ?? String(err));
      setTimeout(() => setError(null), 8000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eos">
      <button type="button" className="eos-btn" onClick={run} disabled={busy} aria-busy={busy}
        title={error ? `The report could not be made: ${error}` : "Download the end-of-shift report: 06:00 to now"}>
        {busy ? <span className="eos-spin" aria-hidden="true" /> : <i className="ti ti-clipboard-text" aria-hidden="true" />}
        <span className="eos-word">{busy ? "Making the report…" : "End of shift report"}</span>
      </button>
      {error && <span className="eos-err" role="alert">Could not make the report</span>}
    </div>
  );
}
