// Quick links to the places on the map — the surveyed sites and the
// weighbridges — in the header beside the theme switch.
//
// The map already draws them and the layers menu already lists them, but both
// of those are ON the map — so reaching a site plan meant finding the map,
// finding the layers button, and reading a list to find the one you wanted.
// This is the shortcut: pick a place, and the map switches that layer on and
// flies there.
//
// ## The scales are here for a second reason
//
// A survey has one switch and one place, so the layers menu can take you
// there. Six weighbridges share ONE switch, and at the opening zoom they land
// within a couple of pixels of each other — so the layers menu can only ever
// offer "the scales", all of them, and an operator who wants Oyani bridge 2
// then hunts for it among the markers. Naming each one is the only place in
// the product that answers "take me to THAT scale", which is why they earn a
// group of their own here rather than a row in the layers list.
//
// ## Why the list comes from the map rather than from the table
//
// A survey the map is lending from ANOTHER organisation is in it too. Those
// appear and disappear as this fleet's lorries arrive in other people's yards
// (see lib/guestSitePlans), so the only honest source for "what can I be taken
// to right now" is the component doing the drawing. FleetMap publishes the
// list through AppContext; this reads it.
//
// ## It disappears rather than empties
//
// An organisation with no survey gets no button. A menu whose only content is
// "nothing here" is a control that costs a press to tell you it was not worth
// pressing.
//
// ## And it disappears for anyone who cannot open the map
//
// Every row here ends in `setDesktopActiveTab("fleet")` — the map is the only
// thing that can answer "take me there". So the control is worth drawing only
// for a role that may open Fleet, which FooterNav grades on `map:read`. A role
// without it (technician, and any future screen-narrow role) would be offered
// a menu of places and sent to a tab the nav does not let them reach: the
// press either does nothing visible or lands them somewhere they were meant to
// be kept out of.
//
// The gate is `map:read` specifically, and not "does this account have any
// survey" — the surveys are a property of the ORGANISATION and the permission
// is a property of the person, so the list being non-empty says nothing about
// whether this reader may follow it.

import { useState, useRef, useEffect } from "react";
import { useAppContext } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";
import { ZONE_STYLE } from "../../lib/zoneLegend";
import "./SitePlanLinks.css";

/**
 * The locator crosshair, not a map pin.
 *
 * A teardrop pin means "a thing is HERE" — it is what the map already draws on
 * top of a place. This control is the other verb: take me there. The crosshair
 * is the glyph every mapping product uses for exactly that, so the icon states
 * the action rather than repeating the noun sitting under it.
 */
const LocatorIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3.25" />
    <circle cx="12" cy="12" r="7.75" opacity="0.5" />
    <path d="M12 1.5v3M12 19.5v3M22.5 12h-3M4.5 12h-3" />
  </svg>
);

export default function SitePlanLinks() {
  const { sitePlanLinks, requestSitePlan, desktopActiveTab, setDesktopActiveTab } = useAppContext();
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  /* Graded against the organisation currently open, because that is where the
     Fleet tab would be opened. The same person can hold map:read at one
     company and not at another, and this control follows the switcher. */
  const canOpenMap = can("map:read");

  // Closing on an outside press and on Escape, the same two gestures the
  // company switcher answers to — a second menu in the same bar that behaved
  // differently would be the thing people noticed about it.
  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onEscape = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  // A survey the map is no longer offering must not stay on screen as a link
  // to nowhere — a lorry leaving another tenant's yard withdraws its row while
  // the menu is open.
  useEffect(() => { if (sitePlanLinks.length === 0) setOpen(false); }, [sitePlanLinks]);

  /* Switching to a company where this account cannot open the map must shut an
     already-open menu, not merely stop drawing the button next time — the
     early return below unmounts the whole control, but `open` is state and
     would otherwise come back true on the way back. */
  useEffect(() => { if (!canOpenMap) setOpen(false); }, [canOpenMap]);

  if (!canOpenMap) return null;
  if (sitePlanLinks.length === 0) return null;

  const go = (id, kind) => {
    // The map is on the Fleet tab. Asking to be taken somewhere from the
    // Maintenance screen has to take you to the screen that can show it, or
    // the press does nothing visible.
    if (desktopActiveTab !== "fleet") setDesktopActiveTab("fleet");
    requestSitePlan(id, kind);
    setOpen(false);
  };

  const visiting = sitePlanLinks.filter((p) => p.guest).length;

  /* Two groups, because they answer different questions — "show me that yard"
     and "show me that scale" — and a single alphabetical list would interleave
     six bridges through however many surveys there are. Split here rather than
     in FleetMap: the publisher's job is to say what can be reached, and how it
     is arranged for reading is this menu's business.

     Either group may be empty. An org with surveys and no scales gets the list
     it has always had, with no empty heading to explain. */
  const sites   = sitePlanLinks.filter((p) => p.kind !== "bridge");
  const bridges = sitePlanLinks.filter((p) => p.kind === "bridge");

  return (
    <div className="site-links" ref={wrapRef}>
      <button
        type="button"
        className={`site-links__trigger${open ? " site-links__trigger--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={visiting
          ? `Sites, ${sitePlanLinks.length} places, ${visiting} being visited`
          : `Sites, ${sitePlanLinks.length} places`}
      >
        <LocatorIcon />
        <span className="site-links__text">Sites</span>
        {/* The count earns its place: it is how you learn a survey has been
            lent to you without opening anything. It carries the amber the
            guest rows use when one of them is a visitor — the same colour
            saying the same thing, rather than a second vocabulary. */}
        <span className="site-links__count" data-visiting={visiting > 0 || undefined}>
          {sitePlanLinks.length}
        </span>
        <span className={`site-links__chevron${open ? " site-links__chevron--open" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="site-links__menu" role="listbox" aria-label="Sites and weighbridges">
          {sites.length > 0 && <div className="site-links__title">Go to a site</div>}
          {sites.map((plan) => (
            <button
              key={plan.id}
              type="button"
              role="option"
              aria-selected="false"
              className="site-links__item"
              onClick={() => go(plan.id, plan.kind)}
            >
              <span className={`site-links__dot${plan.guest ? " site-links__dot--guest" : ""}`}
                    aria-hidden="true" />
              <span className="site-links__item-text">
                <span className="site-links__item-name">{plan.label}</span>
                {/* A visitor says whose it is not, and why it is here. Without
                    it another tenant's yard in this org's menu reads as a
                    bug. */}
                {plan.guest && (
                  <span className="site-links__item-sub">
                    Visiting · {plan.occupants === 1 ? "1 unit here" : `${plan.occupants} units here`}
                  </span>
                )}
              </span>
            </button>
          ))}

          {/* The scales. A separate heading rather than a run-on list: the
              layers menu can already show all six at once, and what this
              offers is the one you name — so the group is the part of the
              menu that is new, and burying it under the yards would hide
              exactly that. */}
          {bridges.length > 0 && <div className="site-links__title">Go to a weighbridge</div>}
          {bridges.map((b) => (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected="false"
              className="site-links__item"
              onClick={() => go(b.id, b.kind)}
            >
              {/* Painted from the same object that colours the markers, so the
                  dot and the pin it flies you to can never disagree. */}
              <span className="site-links__dot site-links__dot--bridge" aria-hidden="true"
                    style={{ backgroundColor: ZONE_STYLE.weighing?.color }} />
              <span className="site-links__item-text">
                <span className="site-links__item-name">{b.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
