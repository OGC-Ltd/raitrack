/**
 * Phones: ONE rail button for the fleet (operator, 19 Nov 2026: "a single icon
 * that we can click to popup and close out the fleets"). It used to be two,
 * the Fleets funnel and the Units truck, each with its own panel in the same
 * spot. Now one button opens one panel whose head switches between them, and
 * the same button closes it (so do Escape and a press outside, as before).
 *
 * On a phone the panel is a bottom sheet ("doesn't feel like a phone",
 * 19 Nov 2026): full width on the tab bar, over a dimmed map, with a handle
 * that drags it down to close (FleetUnitsMenu.css has the geometry).
 *
 * Tablets and desktops keep the two buttons (FleetMap renders this only when
 * isMobile). Both menus are reused as they are, in their `bare` mode: no
 * button of their own, opened from here, the switch in their title's place.
 *
 * One number on the button, the Fleets rule: the halted count is news, the
 * filter is a setting you can see. The button goes green while the map is
 * narrowed (fleet types, in transit only, or tracked units), and the
 * aria-label says which.
 */
import { useEffect, useRef, useState } from "react";
import { useAppFields } from "../../context/AppContext";
import FleetsMenu from "./FleetsMenu";
import UnitsMenu from "./UnitsMenu";
import "./FleetUnitsMenu.css";

/** A truck, the rail's own 1.9 stroke: this button is the fleet, not a filter. */
function FleetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
         fill="none" stroke="currentColor" strokeWidth="1.9"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16V7h10v9" /><path d="M13 11h4l3 3v2h-7" />
      <circle cx="7" cy="17.5" r="1.6" /><circle cx="17" cy="17.5" r="1.6" />
    </svg>
  );
}

/**
 * @param {{
 *   fleets: object,   FleetsMenu's own props
 *   units: object,    UnitsMenu's own props, without open / onOpenChange
 *   unitsOpen: boolean,
 *   onUnitsOpenChange: (open: boolean) => void,
 * }} props
 */
export default function FleetUnitsMenu({ fleets, units, unitsOpen, onUnitsOpenChange }) {
  const { fleetTypes, trackedIds } = useAppFields("fleetTypes", "trackedIds");
  const [fleetsOpen, setFleetsOpen] = useState(false);
  // The tab it opens on is the one it was last left on
  const [last, setLast] = useState("fleets");
  const btn = useRef(null);
  // Was the panel open when this press began? The open panel closes itself on
  // any press outside it (this button included), so by the click it is shut;
  // the click must then leave it shut rather than open it again. The press is
  // NOT stopped: other open panels (the ☰ menu) must still see it and close.
  const wasOpen = useRef(false);

  const tab = unitsOpen ? "units" : fleetsOpen ? "fleets" : null;
  const open = tab !== null;

  const show = (which) => {
    setLast(which);
    setFleetsOpen(which === "fleets");
    onUnitsOpenChange?.(which === "units");
  };
  const close = () => { setFleetsOpen(false); onUnitsOpenChange?.(false); };

  // The menus hand focus back to their own button on Escape; bare, they have
  // none, so it comes back here.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setTimeout(() => btn.current?.focus(), 0); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const flagCount = fleets.flagged?.length ?? 0;
  const trackedCount = trackedIds?.length ?? 0;
  const typeCount = fleetTypes?.length ?? 0;
  const narrowed = typeCount > 0 || fleets.inTransitOnly || trackedCount > 0;

  const tabs = (
    <div className="fu-tabs" role="tablist" aria-label="Fleets and units">
      <button type="button" role="tab" className="fu-tabs__tab"
              aria-selected={tab === "fleets"} onClick={() => show("fleets")}>
        Fleets
      </button>
      <button type="button" role="tab" className="fu-tabs__tab"
              aria-selected={tab === "units"} onClick={() => show("units")}>
        Units
        {trackedCount > 0 && <span className="fu-tabs__n">{trackedCount}</span>}
      </button>
    </div>
  );
  // Drag the handle down to put the sheet away: it follows the finger, and
  // past a quarter of its height (or a quick flick) it closes; short of that
  // it springs back. Transform only, set straight on the sheet while dragging.
  const drag = useRef(null);
  const onGrab = (e) => {
    const sheet = e.currentTarget.closest(".fleets-menu__panel, .units-menu__panel");
    if (!sheet) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { sheet, y0: e.clientY, t0: e.timeStamp, dy: 0 };
    sheet.classList.add("fu-sheet--dragging");
  };
  const onDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    d.sheet.style.transform = `translateY(${d.dy}px)`;
  };
  const onDrop = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.sheet.classList.remove("fu-sheet--dragging");
    const fast = d.dy > 40 && d.dy / Math.max(1, e.timeStamp - d.t0) > 0.6;
    if (d.dy > d.sheet.offsetHeight / 4 || fast) {
      close();
      btn.current?.focus();
    } else {
      d.sheet.style.transform = "";
    }
  };

  // The handle, the switch, then a ✕ at the head's far end: the sheet closes
  // from inside it too, not only from the rail button.
  const head = (
    <div className="fu-head">
      <div className="fu-grab" aria-hidden="true"
           onPointerDown={onGrab} onPointerMove={onDrag} onPointerUp={onDrop} onPointerCancel={onDrop} />
      {tabs}
      <button type="button" className="fu-head__x" aria-label="Close fleets and units"
              onClick={() => { close(); btn.current?.focus(); }}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );

  return (
    <div className="fu-menu">
      <button
        ref={btn}
        type="button"
        className={`map-cam-btn fleets-menu__btn${open ? " fleets-menu__btn--open" : ""}${narrowed ? " fleets-menu__btn--on" : ""}`}
        aria-expanded={open}
        aria-label={[
          "Fleets and units",
          typeCount ? `${typeCount} types shown` : null,
          fleets.inTransitOnly ? "in transit only" : null,
          trackedCount ? `${trackedCount} tracked` : null,
          flagCount ? `${flagCount} ${flagCount === 1 ? "unit" : "units"} stopped` : null,
        ].filter(Boolean).join(", ")}
        title="Fleets and units"
        onPointerDown={() => { wasOpen.current = open; }}
        onClick={() => {
          // A keyboard press has no pointerdown: it reads the state as it is
          const shut = wasOpen.current || open;
          wasOpen.current = false;
          if (shut) close(); else show(last);
        }}
      >
        <FleetIcon />
        {flagCount > 0 && (
          <span className="fleets-menu__flagcount" data-digits={String(flagCount).length}>{flagCount}</span>
        )}
      </button>

      {/* The map dims behind the sheet. A press on it is a press outside the
          sheet, so the menu's own dismissal closes it: nothing to wire. */}
      {open && <div className="fu-scrim" aria-hidden="true" />}
      <FleetsMenu {...fleets} bare tabs={head}
                  open={tab === "fleets"} onOpenChange={(v) => { if (!v) setFleetsOpen(false); }} />
      <UnitsMenu {...units} bare tabs={head}
                 open={tab === "units"} onOpenChange={(v) => { if (!v) onUnitsOpenChange?.(false); }} />
    </div>
  );
}
