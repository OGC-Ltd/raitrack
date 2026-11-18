/**
 * The phone map's ☰ (operator, 18 Nov 2026: "something like a hamburger …
 * when someone clicks on it they find the work plan, the fuel page, the fuel
 * audit and metrics", then Reports, Alerts and Logbook). Under the Map / Satellite toggle, top left,
 * on phones only: below 768px the side menu is gone, and the bottom bar holds
 * five tabs. Tablets keep the side menu.
 *
 * Each page shows only for those with its right (NAV_ITEMS, as the side menu
 * and the bottom bar read it). Work plans is the map's own layer: picked, it
 * opens the work-plans card on this map; it is left out where none are kept.
 */
import { useEffect, useRef, useState } from "react";
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
];

const permissionFor = (key) => NAV_ITEMS.find((n) => n.key === key)?.permission;

/** The pages this person may open from the ☰, in order. Pure, for test. */
export function morePages(can) {
  return PAGES.filter((p) => { const perm = permissionFor(p.key); return Boolean(perm) && can(perm); });
}

/** @param {{ workPlans: { on: boolean, onToggle: () => void } | null }} props */
export default function MapMoreMenu({ workPlans }) {
  const [open, setOpen] = useState(false);
  const { setDesktopActiveTab } = useAppActions();
  const { can } = usePermissions();
  const box = useRef(null);
  const btn = useRef(null);
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
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!workPlans && pages.length === 0) return null;

  const go = (key) => { setOpen(false); setDesktopActiveTab(key); };

  // Open, the menu is a panel as wide as the row above it, as tall as its
  // items, just under that row, a lone ✕ centred at its foot (operator,
  // 18 Nov 2026); it covers the ☰.
  return (
    <div className="map-more" ref={box}>
      <button type="button" className="map-more__btn" ref={btn}
              aria-label="More pages" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <i className="ti ti-menu-2" aria-hidden="true" />
        {canAlerts && (openAlerts > 0 || fuelAlarm) && <span className={`map-more__dot${fuelAlarm ? " nav-alarm" : ""}`} aria-hidden="true" />}
      </button>
      {open && (
        <div className="map-more__area">
        <div className="map-more__panel">
        <div className="map-more__menu" role="menu" aria-label="More pages">
          {workPlans && (
            <button type="button" role="menuitem" className="map-more__item"
                    onClick={() => { setOpen(false); if (!workPlans.on) workPlans.onToggle(); }}>
              <i className="ti ti-clipboard-list" aria-hidden="true" /> Work plans
            </button>
          )}
          {pages.map((p) => (
            <button key={p.key} type="button" role="menuitem" className="map-more__item" onClick={() => go(p.key)}>
              <i className={`ti ti-${p.icon}`} aria-hidden="true" /> {p.label}
              {p.key === "alerts" && openAlerts > 0 && (
                <span className={`map-more__badge${fuelAlarm ? " nav-alarm" : ""}`} title={`${openAlerts} open alert${openAlerts === 1 ? "" : "s"} you have not read, last 7 days`}>
                  {badgeText(openAlerts)}
                </span>
              )}
            </button>
          ))}
        </div>
          {/* The ✕ under the list, where the thumb finishes (operator, 18 Nov 2026) */}
          <footer className="map-more__foot">
            <button type="button" className="map-more__x" aria-label="Close the menu" onClick={close}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </footer>
        </div>
        </div>
      )}
    </div>
  );
}
