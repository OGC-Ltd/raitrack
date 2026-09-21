// Mobile bottom tab bar.

import "./MobileBottomNav.css";
import { useAppContext } from "../../context/AppContext";

const TABS = [
  {
    key: "home",
    label: "Home",
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
      </svg>
    ),
  },
  {
    key: "map",
    label: "Map",
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
        <line x1="9" y1="3" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="21" />
      </svg>
    ),
  },
  {
    key: "search",
    label: "Search",
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    key: "drivers",
    label: "Drivers",
    icon: (active) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.9} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
];

export default function MobileBottomNav() {
  const { mobileActiveTab, setMobileActiveTab } = useAppContext();

  return (
    <nav className="mobile-bottomnav" role="navigation" aria-label="Main navigation">
      {TABS.map((tab) => {
        const isActive = mobileActiveTab === tab.key;
        return (
          <button
            key={tab.key}
            className={`mobile-bottomnav__item${isActive ? " mobile-bottomnav__item--active" : ""}`}
            onClick={() => setMobileActiveTab(tab.key)}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="mobile-bottomnav__icon">{tab.icon(isActive)}</span>
            <span className="mobile-bottomnav__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
