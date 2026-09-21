// Radar chart primitive (legacy, unused).

import "./RadarChart.css";

const SIZE = 260;
const CENTER = SIZE / 2;
const MAX_RADIUS = 92;
const LABEL_RADIUS = MAX_RADIUS + 26;

function pointFor(index, count, radius) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: CENTER + radius * Math.cos(angle),
    y: CENTER + radius * Math.sin(angle),
  };
}

export default function RadarChart({ axes, maxValue = 100, color = "#f59e0b", fillOpacity = 0.28 }) {
  const count = axes.length;

  const gridRings = [0.2, 0.4, 0.6, 0.8, 1].map((frac) =>
    Array.from({ length: count }, (_, i) => pointFor(i, count, MAX_RADIUS * frac))
      .map((p) => `${p.x},${p.y}`)
      .join(" ")
  );

  const dataPoints = axes.map((a, i) => pointFor(i, count, (a.value / maxValue) * MAX_RADIUS));
  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="radar-chart">
      {gridRings.map((points, i) => (
        <polygon key={i} points={points} className="radar-chart__grid" />
      ))}

      {axes.map((a, i) => {
        const p = pointFor(i, count, MAX_RADIUS);
        return <line key={a.label} x1={CENTER} y1={CENTER} x2={p.x} y2={p.y} className="radar-chart__spoke" />;
      })}

      <polygon points={dataPolygon} fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={axes[i].label} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}

      {axes.map((a, i) => {
        const p = pointFor(i, count, LABEL_RADIUS);
        return (
          <text
            key={a.label}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="radar-chart__label"
          >
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}
