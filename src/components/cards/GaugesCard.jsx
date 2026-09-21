// Gauge-ring metrics card (legacy, unused).

import "./GaugesCard.css";

function GaugeRing({ value, label, color, size = 66 }) {
  const r = 26, circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <div className="gc-gauge">
      <svg width={size} height={size} viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#1e2530" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 32 32)" />
        <text x="32" y="37" textAnchor="middle" fontSize="12" fontWeight="700" fill="#e6edf3">
          {value}
        </text>
      </svg>
      <span className="gc-label">{label}</span>
    </div>
  );
}

function GrainHealthPentagon() {
  return (
    <div className="gc-gauge">
      <svg width="66" height="66" viewBox="0 0 64 64">
        <polygon points="32,5 58,22 48,54 16,54 6,22"
          fill="none" stroke="#1e2530" strokeWidth="5" strokeLinejoin="round" />
        <polygon points="32,13 50,26 42,48 22,48 14,26"
          fill="rgba(34,197,94,0.12)" stroke="#22c55e" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <span className="gc-label">GRAIN{"\n"}HEALTH</span>
    </div>
  );
}

export default function GaugesCard({ gauges }) {
  return (
    <div className="gc-card">
      <GaugeRing value={gauges.temp}     label="ENG °C"    color="#38bdf8" size={66} />
      <GaugeRing value={gauges.humidity} label="FUEL %" color="#22c55e" size={66} />
      <GaugeRing value={gauges.fill}     label="LOAD %"     color="#f59e0b" size={66} />
      <GrainHealthPentagon />
    </div>
  );
}
