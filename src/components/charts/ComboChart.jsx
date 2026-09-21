// Bar + dual-line combo chart (legacy, unused).

import "./ComboChart.css";

const WIDTH = 640;
const HEIGHT = 260;
const PAD_LEFT = 34;
const PAD_RIGHT = 34;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

export default function ComboChart({ data, barColor, line1Color, line2Color, barLabel, line1Label, line2Label }) {
  const chartW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const n = data.length;
  const step = chartW / n;

  const barMax = Math.max(...data.map((d) => d.bar), 1);

  const barAxisMax = Math.ceil(barMax / 2) * 2 || 2;

  const xFor = (i) => PAD_LEFT + i * step + step / 2;
  const yForPercent = (v) => PAD_TOP + chartH - (v / 100) * chartH;
  const yForBar = (v) => PAD_TOP + chartH - (v / barAxisMax) * chartH;

  const line1Points = data.map((d, i) => `${xFor(i)},${yForPercent(d.line1)}`).join(" ");
  const line2Points = data.map((d, i) => `${xFor(i)},${yForPercent(d.line2)}`).join(" ");
  const line2AreaPath =
    `M ${xFor(0)},${PAD_TOP + chartH} ` +
    data.map((d, i) => `L ${xFor(i)},${yForPercent(d.line2)}`).join(" ") +
    ` L ${xFor(n - 1)},${PAD_TOP + chartH} Z`;

  const barWidth = Math.min(step * 0.32, 26);

  return (
    <div className="combo-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="combo-chart__svg">
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT}
              y1={yForPercent(tick)} y2={yForPercent(tick)}
              className="combo-chart__gridline"
            />
            <text x={PAD_LEFT - 8} y={yForPercent(tick) + 3} textAnchor="end" className="combo-chart__axis-label">
              {tick}%
            </text>
          </g>
        ))}

        {[0, barAxisMax / 2, barAxisMax].map((tick) => (
          <text
            key={tick}
            x={WIDTH - PAD_RIGHT + 8}
            y={yForBar(tick) + 3}
            textAnchor="start"
            className="combo-chart__axis-label"
          >
            {Math.round(tick)}
          </text>
        ))}

        {data.map((d, i) => (
          <rect
            key={d.label}
            x={xFor(i) - barWidth / 2}
            y={yForBar(d.bar)}
            width={barWidth}
            height={PAD_TOP + chartH - yForBar(d.bar)}
            fill={barColor}
            rx={2}
          />
        ))}

        <path d={line2AreaPath} fill={line2Color} opacity={0.16} />

        <polyline points={line2Points} fill="none" stroke={line2Color} strokeWidth={2} />
        <polyline points={line1Points} fill="none" stroke={line1Color} strokeWidth={2} />

        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={xFor(i)} cy={yForPercent(d.line1)} r={3} fill={line1Color} />
            <circle cx={xFor(i)} cy={yForPercent(d.line2)} r={3} fill={line2Color} />
          </g>
        ))}

        {data.map((d, i) => {
          const labelStride = Math.max(1, Math.ceil(n / 8));
          const showLabel = i % labelStride === 0 || i === n - 1;
          if (!showLabel) return null;
          return (
            <text key={d.label} x={xFor(i)} y={HEIGHT - 6} textAnchor="middle" className="combo-chart__axis-label">
              {d.label}
            </text>
          );
        })}
      </svg>

      <div className="combo-chart__legend">
        <span className="combo-chart__legend-item">
          <span className="combo-chart__legend-swatch combo-chart__legend-swatch--line" style={{ background: line1Color }} />
          {line1Label}
        </span>
        <span className="combo-chart__legend-item">
          <span className="combo-chart__legend-swatch combo-chart__legend-swatch--line" style={{ background: line2Color }} />
          {line2Label}
        </span>
        <span className="combo-chart__legend-item">
          <span className="combo-chart__legend-swatch" style={{ background: barColor }} />
          {barLabel}
        </span>
      </div>
    </div>
  );
}
