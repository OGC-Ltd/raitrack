// MobileTabBar — bottom navigation for mobile, mirrors the React Native app exactly.
// Only visible on screens < 768px. Desktop is unaffected.

import { useAppContext } from '../../context/AppContext';
import './MobileTabBar.css';

const TABS = [
  { key: 'analytics',    label: 'Analytics',    icon: 'chart-bar'  },
  { key: 'drivers',      label: 'Drivers',      icon: 'users'       },
  { key: 'fleet',        label: 'Fleet',        icon: null          }, // FAB center
  { key: 'weighbridges', label: 'Weighbridges', icon: 'scale'       },
  { key: 'maintenance',  label: 'Maintenance',  icon: 'tool'        },
];

export default function MobileTabBar() {
  const { desktopActiveTab, setDesktopActiveTab } = useAppContext();

  return (
    <nav className="mobile-tab-bar">
      {TABS.map(tab => {
        const isActive = desktopActiveTab === tab.key;
        const isFAB    = tab.key === 'fleet';

        if (isFAB) {
          return (
            <button
              key={tab.key}
              className={`mobile-tab-bar__fab${isActive ? ' mobile-tab-bar__fab--active' : ''}`}
              onClick={() => setDesktopActiveTab('fleet')}
              aria-label="Fleet map"
            >
              {/* Truck SVG — same as RN app */}
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
              </svg>
              <span className="mobile-tab-bar__fab-label">Fleet</span>
            </button>
          );
        }

        return (
          <button
            key={tab.key}
            className={`mobile-tab-bar__item${isActive ? ' mobile-tab-bar__item--active' : ''}`}
            onClick={() => setDesktopActiveTab(tab.key)}
          >
            <i className={`ti ti-${tab.icon} mobile-tab-bar__icon`} aria-hidden="true" />
            <span className="mobile-tab-bar__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
