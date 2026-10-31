// "End of shift" in the top bar, beside the organisation switcher: one click
// downloads the organisation's end-of-shift report (api/endOfShiftReport),
// 06:00 to now. The button says how far it has got while the report is made.

import { useState } from "react";
import { downloadEndOfShiftReport } from "../../api/endOfShiftReport";
import "./EndOfShiftButton.css";

export default function EndOfShiftButton({ company }) {
  const [busy, setBusy] = useState(null);     // progress text while it is made
  const [error, setError] = useState(null);
  if (!company) return null;

  const run = async () => {
    if (busy) return;
    setBusy("Preparing"); setError(null);
    try {
      await downloadEndOfShiftReport({ company, onProgress: setBusy });
    } catch (err) {
      setError(err?.message ?? String(err));
      setTimeout(() => setError(null), 8000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="eos">
      <button type="button" className="eos-btn" onClick={run} disabled={Boolean(busy)} aria-busy={Boolean(busy)}
        title={error ? `The report could not be made: ${error}` : "Download the end-of-shift report: 06:00 to now"}>
        {busy ? <span className="eos-spin" aria-hidden="true" /> : <i className="ti ti-clipboard-text" aria-hidden="true" />}
        <span className="eos-word">{busy ? `${busy}…` : "End of shift"}</span>
      </button>
      {error && <span className="eos-err" role="alert">Could not make the report</span>}
    </div>
  );
}
