// MobileCompanyProfile — slide-up sheet showing company info, weather and fleet stats.
// Matches the RN CompanyProfileModal but natural, no AI cards.

import { useCompanies } from '../../context/AppContext';
import { useFleetLiveShared } from '../../context/FleetLiveContext';
import { matchesFilter } from '../../lib/vehicleMap';
import './MobileCompanyProfile.css';

// Weather hook — same as SidePanel
import { useState, useEffect } from 'react';

function useWeather(lat, lng) {
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    if (!lat || !lng) return;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weathercode,windspeed_10m&timezone=Africa%2FNairobi`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const wc = data.current;
        const code = wc.weathercode;
        const desc =
          code === 0 ? 'Sunny' :
          code <= 2  ? 'Partly cloudy' :
          code <= 3  ? 'Cloudy' :
          code <= 49 ? 'Foggy' :
          code <= 65 ? 'Rainy' :
          code <= 75 ? 'Snow' :
          code <= 99 ? 'Thunderstorm' : 'Cloudy';
        setWeather({ temp: Math.round(wc.temperature_2m), desc });
      })
      .catch(() => {});
  }, [lat, lng]);
  return weather;
}

export default function MobileCompanyProfile({ open, onClose }) {
  const { activeCompany } = useCompanies();
  const { vehicles = [] } = useFleetLiveShared();
  const weather  = useWeather(activeCompany?.hqLat, activeCompany?.hqLng);

  const count   = (key) => vehicles.filter(v => matchesFilter(v, key)).length;
  const total   = vehicles.length;
  const moving  = count('transit');
  const idle    = count('idling');
  const alerts  = vehicles.filter(v => v.status === 'speeding' || v.status === 'theft').length;
  const offline = count('offline');

  // Fleet composition from the live vehicleType of each unit
  const TYPE_LABEL = { TRUCK: 'Trucks', LORRY: 'Lorries', TRACTOR: 'Tractors', PLANT: 'Plant', 'BELL LOADER': 'Bell loaders' };
  const byType = vehicles.reduce((acc, v) => {
    const t = v.vehicleType ?? 'OTHER';
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  const composition = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => ({
      label: TYPE_LABEL[t] ?? (t.charAt(0) + t.slice(1).toLowerCase()),
      count: n,
      pct: total ? (n / total) * 100 : 0,
    }));

  const stats = [
    { key: 'moving',  label: 'Moving',  n: moving },
    { key: 'idle',    label: 'Idle',    n: idle },
    { key: 'alerts',  label: 'Alerts',  n: alerts },
    { key: 'offline', label: 'Offline', n: offline },
  ];

  // Redesigned for phones 19 Nov 2026 (Hallmark): the company is the title,
  // one big total over four plain counts, and the composition as quiet bars.
  return (
    <>
      {open && <div className="mcp-backdrop" onClick={onClose} />}
      <div className={`mcp-sheet${open ? ' mcp-sheet--open' : ''}`}
           role="dialog" aria-modal="true" aria-labelledby="mcp-org-name" aria-hidden={!open}>

        <div className="mcp-handle" aria-hidden="true" />

        <div className="mcp-header">
          <div className="mcp-org">
            <h2 className="mcp-org-name" id="mcp-org-name">{activeCompany?.name ?? 'Fleet Command'}</h2>
            <p className="mcp-org-meta">
              {activeCompany?.hqLocation && <span>{activeCompany.hqLocation}</span>}
              {weather && <span>{weather.temp}°C, {weather.desc.toLowerCase()}</span>}
            </p>
          </div>
          <button type="button" className="mcp-close" onClick={onClose} aria-label="Close company profile">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="mcp-body">
          <p className="mcp-total">
            <span className="mcp-total-num">{total}</span>
            <span className="mcp-total-lbl">{total === 1 ? 'unit' : 'units'}</span>
          </p>

          <dl className="mcp-stats">
            {stats.map((s) => (
              <div key={s.key} className={`mcp-stat mcp-stat--${s.key}`}>
                <dt className="mcp-stat-lbl">{s.label}</dt>
                <dd className="mcp-stat-num">{s.n}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mcp-section-lbl">Fleet composition</h3>

          {composition.length === 0 && <p className="mcp-empty">No vehicles reported yet</p>}
          <ul className="mcp-comp">
            {composition.map(c => (
              <li key={c.label} className="mcp-comp-row">
                <span className="mcp-comp-label">{c.label}</span>
                <span className="mcp-comp-count">{c.count}</span>
                <span className="mcp-comp-track" aria-hidden="true">
                  <span className="mcp-comp-fill" style={{ transform: `scaleX(${c.pct / 100})` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
