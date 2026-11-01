// "Movements" in the top bar, beside the organisation switcher — a temporary
// way in (operator, 2026-11-01) to the movement report: where every unit is
// now and whether it is heading to or from MORL over the last 2 or 4 hours.
// The server makes the PDF (fleet-server reports/movement-report); this asks
// for it and saves it.

import { useEffect, useRef, useState } from "react";
import { downloadMovementReport } from "../../api/reports";
import "./MovementsButton.css";

const WINDOWS = [2, 4];

export default function MovementsButton({ company }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);     // the window being made
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

  const run = async (hours) => {
    if (busy) return;
    setBusy(hours); setError(null);
    try {
      await downloadMovementReport({ companyId: company.id, hours });
      setOpen(false);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mvb" ref={box}>
      <button type="button" className={`mvb-btn${open ? " mvb-btn--open" : ""}`} onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog" aria-expanded={open} title="Movement report: where every unit is, to or from MORL">
        <i className="ti ti-route" aria-hidden="true" />
        <span className="mvb-btn-word">Movements</span>
      </button>
      {open && (
        <div className="mvb-pop" role="dialog" aria-label="Movement report">
          <div className="mvb-title">Movement report</div>
          <div className="mvb-org">{company.name}</div>
          <p className="mvb-what">Where every unit was last seen, its speed, and whether it is heading to or from MORL over the window.</p>
          <div className="mvb-go-row">
            {WINDOWS.map((h) => (
              <button key={h} type="button" className="mvb-go" onClick={() => run(h)} disabled={Boolean(busy)} aria-busy={busy === h}>
                {busy === h && <span className="mvb-spin" aria-hidden="true" />}
                {busy === h ? "Preparing…" : `Last ${h} hours`}
              </button>
            ))}
          </div>
          {error && <p className="mvb-err" role="alert">The report could not be made: {error}</p>}
        </div>
      )}
    </div>
  );
}
