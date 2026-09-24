// Escalate / de-escalate, in the fuel incident window. See lib/fuelReview.
//
// Shows the decision when there is one (who, when, why), and to an
// administrator the way to make or change it: pick a direction, give a reason,
// confirm. Nothing for anyone else when the alert is undecided.

import { useEffect, useState } from "react";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { OUTCOME, fetchReviewRights, reviewIncident, reviewState, useIncidentReview } from "../../lib/fuelReview";
import "./FuelReview.css";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

export default function FuelReview({ incident }) {
  const { orgId } = useFleetLiveShared();
  const review = useIncidentReview(incident);
  const state = reviewState(review);
  const [canReview, setCanReview] = useState(false);
  const [picking, setPicking] = useState(null); // 'ESCALATED' | 'DEESCALATED' | null
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    fetchReviewRights(orgId).then((ok) => { if (live) setCanReview(ok); });
    return () => { live = false; };
  }, [orgId]);

  // A different incident in the same window starts clean.
  useEffect(() => { setPicking(null); setNote(""); setError(null); }, [incident?.id]);

  if (!incident || (!state.status && !canReview)) return null;

  const submit = async () => {
    if (busy || note.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await reviewIncident(orgId, incident.id, picking, note.trim());
      setPicking(null);
      setNote("");
    } catch (err) {
      setError(err?.status === 403
        ? "Only an administrator can escalate or de-escalate a fuel alert."
        : err?.status === 409
          ? "This alert was deleted, so it has a Case. Decide it there."
          : "Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`frv${state.tone ? ` frv--${state.tone}` : ""}`}>
      {state.status && (
        <div className="frv-status">
          <span className="frv-chip">{state.label}</span>
          <span className="frv-meaning">{state.meaning}</span>
          <span className="frv-by">
            {review.by ?? "an administrator"}{review.at ? ` · ${WHEN.format(new Date(review.at))}` : ""}
          </span>
          {review.note && <p className="frv-note">{"“"}{review.note}{"”"}</p>}
        </div>
      )}

      {canReview && !picking && (
        <div className="frv-actions">
          {!state.status && <span className="frv-ask">Is this a theft?</span>}
          {state.offer.map((o) => (
            <button key={o} type="button"
                    className={`frv-btn frv-btn--${o === "ESCALATED" ? "up" : "down"}`}
                    onClick={() => setPicking(o)}>
              {OUTCOME[o].verb}
            </button>
          ))}
        </div>
      )}

      {picking && (
        <div className="frv-form">
          <textarea
            className="frv-input"
            rows={2}
            autoFocus
            value={note}
            maxLength={2000}
            placeholder={OUTCOME[picking].placeholder}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Reason"
          />
          {error && <p className="frv-error" role="alert">{error}</p>}
          <div className="frv-actions">
            <button type="button" className="frv-btn" onClick={() => { setPicking(null); setError(null); }} disabled={busy}>
              Cancel
            </button>
            <button type="button"
                    className={`frv-btn frv-btn--solid frv-btn--${picking === "ESCALATED" ? "up" : "down"}`}
                    onClick={submit} disabled={busy || note.trim().length < 3}
                    title={note.trim().length < 3 ? "Give a reason first" : undefined}>
              {busy ? "Saving…" : OUTCOME[picking].confirm}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
