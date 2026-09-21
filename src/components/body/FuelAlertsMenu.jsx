/**
 * The fleet's open fuel incidents, behind one button in the map's control rail.
 *
 * ## What it replaces
 *
 * A banner pinned to the top of the right panel, and a window that OPENED
 * ITSELF the first time you selected a flagged unit. Between them they spent
 * the most valuable row of the panel and the middle of the map on something
 * nobody had asked to see yet, and the only way to find out which OTHER units
 * were flagged was to click them one at a time.
 *
 * Now: a count on a button, a list behind it, and a window that opens when it
 * is asked for. Measured on the live fleet the day this was written, 28 units
 * carried an open incident across the two orgs — a list, not an interruption.
 *
 * ## Two things on one control, deliberately
 *
 * The switch quiets the MAP; the list is the information. They belong together
 * because they are the same subject, and separating them is what produced the
 * arrangement above — a control in one place and its content in another. It is
 * the same shape as the layers menu next to it, for the same reason.
 *
 * Switching off is not dismissing. The incidents are still open, still counted
 * on the badge, still listed, and their windows still open; only the red
 * treatment goes. Dismissal exists and lives in the incident window, where it
 * is one deliberate click on a labelled button.
 */

import { useEffect, useId, useRef, useState } from "react";
import "./FuelAlertsMenu.css";

/** A drop, which is what every one of these is about. */
function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3s6 6.4 6 10.5a6 6 0 0 1-12 0C6 9.4 12 3 12 3Z" />
    </svg>
  );
}

const L = (ml) => (ml == null ? null : `${(ml / 1000).toFixed(1)} L`);

/** HH:MM on the fleet clock — these are Kenyan/Tanzanian operations. */
const HHMM = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi",
});
const at = (iso) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? HHMM.format(t) : null;
};

export default function FuelAlertsMenu({ vehicles, showOnMap, onToggleMap, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const panelId = useId();

  // Same dismissal contract as the layers menu — see MapLayersMenu for why
  // `pointerdown` rather than `click`, and why Escape hands focus back.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = vehicles.length;

  /**
   * NOTHING AT ALL when the fleet is clean.
   *
   * A permanent "Fuel alerts: 0" is a control that reports the absence of its
   * own subject. The button appearing IS the alert — which is also why it is
   * amber only while something is open.
   */
  if (count === 0) return null;

  return (
    <div className="fuel-alerts" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`map-cam-btn fuel-alerts__btn${open ? " fuel-alerts__btn--open" : ""}${showOnMap ? " fuel-alerts__btn--on" : " fuel-alerts__btn--muted"}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Fuel alerts, ${count} ${count === 1 ? "unit" : "units"} flagged`}
        title="Fuel alerts"
      >
        <DropIcon />
        <span className="fuel-alerts__count" data-digits={String(count).length}>{count}</span>
      </button>

      {open && (
        <div className="fuel-alerts__panel" id={panelId} role="group" aria-label="Fuel alerts">
          <div className="fuel-alerts__head">
            <span className="fuel-alerts__title">Fuel alerts</span>
            <button
              type="button"
              className="fuel-alerts__switchrow"
              role="switch"
              aria-checked={showOnMap}
              onClick={onToggleMap}
              title={showOnMap ? "Stop painting these units red on the map" : "Paint these units red on the map"}
            >
              <span className="fuel-alerts__switch" aria-hidden="true" />
              <span>On map</span>
            </button>
          </div>

          <div className="fuel-alerts__list">
            {vehicles.map((v) => {
              const inc = v.fuelIncident;
              const theft = inc?.mayUseTheftWording === true;
              const when = at(inc?.detectedAt ?? inc?.beganAt);
              return (
                <button
                  type="button"
                  className="fuel-alerts__row"
                  key={v.id}
                  onClick={() => { setOpen(false); onSelect?.(v.id); }}
                  title="Show this unit and open its incident"
                >
                  <span className={`fuel-alerts__dot${theft ? " fuel-alerts__dot--theft" : ""}`} aria-hidden="true" />
                  <span className="fuel-alerts__plate">{v.id}</span>
                  <span className="fuel-alerts__vol">{L(inc?.volumeMl) ?? "—"}</span>
                  <span className="fuel-alerts__meta">
                    {/* CONFIRMED means our own telemetry watched the level stay
                        down or come back, rather than the provider's claim being
                        relayed because we could not check it. It is the single
                        most useful thing on the row and the reason the word is
                        never applied loosely. */}
                    {inc?.confirmed ? "confirmed" : theft ? "unconfirmed" : "fuel event"}
                    {inc?.repeatCount > 1 ? ` · ${inc.repeatCount}×` : ""}
                  </span>
                  {when && <span className="fuel-alerts__when">{when}</span>}
                </button>
              );
            })}
          </div>

          {!showOnMap && (
            <div className="fuel-alerts__muted">
              Hidden on the map. Still open, still listed here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
