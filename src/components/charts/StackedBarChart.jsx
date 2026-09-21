// Stacked bar chart primitive (legacy, unused).

import "./StackedBarChart.css";

const WIDTH = 460;
const HEIGHT = 200;
const PAD_LEFT = 28;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

export default function StackedBarChart({ data, legend }) {
  const chartW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const n = data.length;
  const step = chartW / n;
  const barWidth = Math.min(step * 0.5, 30);

  const totals = data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0));
  const max = Math.max(...totals, 1);
  const axisMax = Math.ceil(max / 3) * 3 || 3;

  const scaleY = (v) => (v / axisMax) * chartH;

  return (
    <div className="stacked-bar-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="stacked-bar-chart__svg">
        {[0, axisMax / 2, axisMax].map((tick) => {
          const y = PAD_TOP + chartH - scaleY(tick);
          return (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} className="stacked-bar-chart__gridline" />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" className="stacked-bar-chart__axis-label">
                {tick}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const x = PAD_LEFT + i * step + (step - barWidth) / 2;
          let cumulative = 0;
          return (
            <g key={d.label}>
              {d.segments.map((seg, j) => {
                const h = scaleY(seg.value);
                const y = PAD_TOP + chartH - scaleY(cumulative) - h;
                cumulative += seg.value;
                return <rect key={j} x={x} y={y} width={barWidth} height={h} fill={seg.color} rx={j === d.segments.length - 1 ? 2 : 0} />;
              })}
              {(() => {
                const labelStride = Math.max(1, Math.ceil(n / 8));
                const showLabel = i % labelStride === 0 || i === n - 1;
                if (!showLabel) return null;
                return (
                  <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="stacked-bar-chart__axis-label">
                    {d.label}
                  </text>
                );
              })()}
            </g>
          );
        })}
      </svg>

      {legend && (
        <div className="stacked-bar-chart__legend">
          {legend.map((l) => (
            <span className="stacked-bar-chart__legend-item" key={l.label}>
              <span className="stacked-bar-chart__legend-swatch" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
