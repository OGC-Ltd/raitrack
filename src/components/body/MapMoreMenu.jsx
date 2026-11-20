/**
 * The phone map's ☰ (operator, 18 Nov 2026: "something like a hamburger …
 * when someone clicks on it they find the work plan, the fuel page, the fuel
 * audit and metrics", then Reports, Alerts and Logbook). At the far right of
 * the phone header since 19 Nov 2026 (MobileHeader), on every page; it used to
 * float under the map's Map / Satellite toggle. Phones only: below 768px the side menu is gone, and the bottom bar holds
 * five tabs. Tablets keep the side menu.
 *
 * Each page shows only for those with its right (NAV_ITEMS, as the side menu
 * and the bottom bar read it). Work plans is the map's own layer: picked, it
 * opens the work-plans card on this map; it is left out where none are kept.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppActions } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";
import { useAlertSummary, badgeText } from "../../hooks/useAlertSummary";
import { useFuelAlarm } from "../../hooks/useFuelAlarm";
import { NAV_ITEMS } from "../layout/SidePanel";
import "./MapMoreMenu.css";

const PAGES = [
  { key: "alerts",      label: "Alerts",       icon: "bell-ringing" },
  { key: "fuel",        label: "Fuel",         icon: "gas-station" },
  { key: "audit",       label: "Fuel audit",   icon: "clipboard-check" },
  { key: "fuelReport",  label: "Fuel metrics", icon: "report-analytics" },
  { key: "usageReview", label: "Logbook",      icon: "car" },
  { key: "reports",     label: "Reports",      icon: "file-analytics" },
  // Was Maintenance › Plan, which the bottom bar reached; its own page since 20 Nov 2026.
  { key: "plans",       label: "Work plan",    icon: "clipboard-list" },
];

// Open, the pages sit in two groups: the fuel pages together, then the rest
// of the fleet's (with Work plans, the map's own layer, at its foot).
const GROUPS = [
  { id: "fuel",  label: "Fuel",  keys: ["fuel", "audit", "fuelReport"] },
  { id: "fleet", label: "Fleet", keys: ["alerts", "usageReview", "reports", "plans"] },
];

const permissionFor = (key) => NAV_ITEMS.find((n) => n.key === key)?.permission;

/** The pages this person may open from the ☰, in order. Pure, for test. */
export function morePages(can) {
  return PAGES.filter((p) => { const perm = permissionFor(p.key); return Boolean(perm) && can(perm); });
}

/** @param {{ workPlans: { on: boolean, onToggle: () => void, onShow?: () => void } | null }} props
 *  onShow, when given, puts the map on screen with the layer on (the header
 *  passes it: the menu may be opened from any page). */
export default function MapMoreMenu({ workPlans, account = null }) {
  const [open, setOpen] = useState(false);
  const { setDesktopActiveTab } = useAppActions();
  const { can } = usePermissions();
  const box = useRef(null);
  const btn = useRef(null);
  // The drawer is portalled to the app root (its theme tokens, no stacking
  // layer of its own): the header is its own stacking layer
  // (z 200), under the tab bar (z 300), and the drawer must cover both.
  const drawer = useRef(null);
  // Closed by its ✕ or Esc, focus goes back to the ☰ the panel covered
  const close = () => { setOpen(false); btn.current?.focus(); };

  const pages = morePages(can);
  // The Alerts badge: the same shared count the side menu and the account menu show
  const canAlerts = pages.some((p) => p.key === "alerts");
  const alertSummary = useAlertSummary(canAlerts);
  const openAlerts = alertSummary?.open ?? 0;
  // A new fuel theft shakes the dot and the count, as it did the avatar's (one alarm, shared)
  const fuelAlarm = useFuelAlarm(canAlerts ? alertSummary : null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current?.contains(e.target) || drawer.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!workPlans && pages.length === 0 && !account) return null;

  const go = (key) => { setOpen(false); setDesktopActiveTab(key); };

  // Open, the menu is a drawer from the right edge, the screen's full height
  // and about a third of its width (operator, 19 Nov 2026), over a dimmed
  // page. Its ✕ is at the top, in the header row, where the ☰ was: the same
  // spot opens and closes it.
  return (
    <div className="map-more" ref={box}>
      <button type="button" className="map-more__btn" ref={btn}
              aria-label={canAlerts && fuelAlarm ? "Menu, new fuel theft alert" : canAlerts && openAlerts > 0 ? `Menu, ${openAlerts} open alert${openAlerts === 1 ? "" : "s"}` : "Menu"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <i className="ti ti-menu-2" aria-hidden="true" />
        {canAlerts && (openAlerts > 0 || fuelAlarm) && <span className={`map-more__dot${fuelAlarm ? " nav-alarm" : ""}`} aria-hidden="true" />}
      </button>
      {open && createPortal(
        <>
        {/* The page under the drawer, dimmed; a tap on it closes the menu */}
        <div className="map-more__scrim" aria-hidden="true" onClick={() => setOpen(false)} />
        <div className="map-more__panel" ref={drawer} role="dialog" aria-modal="true" aria-label="Menu">
          {/* Top row, the header's height: who is signed in, then the ✕ */}
          <div className="map-more__top">
            {account ? (
              <div className="map-more__who">
                <span className="map-more__face" style={{ "--ua": account.hue }} aria-hidden="true">{account.initials}</span>
                <span className="map-more__whotext">
                  <span className="map-more__name">{account.name}</span>
                  {account.email && <span className="map-more__email">{account.email}</span>}
                </span>
              </div>
            ) : <span className="map-more__title">Menu</span>}
            <button type="button" className="map-more__x" aria-label="Close the menu" onClick={close} autoFocus>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        <div className="map-more__menu" role="menu" aria-label="Menu">
          {GROUPS.map((g) => {
            const items = pages.filter((p) => g.keys.includes(p.key));
            const plans = g.id === "fleet" && workPlans;
            if (items.length === 0 && !plans) return null;
            return (
              <div key={g.id} className="map-more__group" role="group" aria-labelledby={`map-more-${g.id}`}>
                <p className="map-more__head" id={`map-more-${g.id}`}>{g.label}</p>
                {items.map((p) => (
                  <button key={p.key} type="button" role="menuitem" className="map-more__item" onClick={() => go(p.key)}>
                    <span className="map-more__icon"><i className={`ti ti-${p.icon}`} aria-hidden="true" /></span>
                    <span className="map-more__label">{p.label}</span>
                    {p.key === "alerts" && openAlerts > 0 && (
                      <span className={`map-more__badge${fuelAlarm ? " nav-alarm" : ""}`} title={`${openAlerts} open alert${openAlerts === 1 ? "" : "s"} you have not read, last 7 days`}>
                        {badgeText(openAlerts)}
                      </span>
                    )}
                    <i className="ti ti-chevron-right map-more__go" aria-hidden="true" />
                  </button>
                ))}
                {plans && (
                  <button type="button" role="menuitem" className="map-more__item"
                          onClick={() => { setOpen(false); if (workPlans.onShow) workPlans.onShow(); else if (!workPlans.on) workPlans.onToggle(); }}>
                    <span className="map-more__icon"><i className="ti ti-clipboard-list" aria-hidden="true" /></span>
                    <span className="map-more__label">Work plans</span>
                    {workPlans.on && <span className="map-more__on">On the map</span>}
                  </button>
                )}
              </div>
            );
          })}
          {account && (
            <div className="map-more__group" role="group" aria-labelledby="map-more-account">
              <p className="map-more__head" id="map-more-account">Account</p>
              {account.items.map((it) => (
                <button key={it.key} type="button" role="menuitem"
                        className={`map-more__item${it.key === "signout" ? " map-more__item--out" : ""}`}
                        onClick={() => { setOpen(false); it.onClick(); }}>
                  <span className="map-more__icon">{it.icon}</span>
                  <span className="map-more__label">{it.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
        </>,
        btn.current?.closest(".app-container") ?? document.body,
      )}
    </div>
  );
}
