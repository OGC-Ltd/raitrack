// SVG line/area chart path + donut gradient helpers.



export function buildLinePath(values, { width = 600, height = 120, padY = 10 } = {}) {
  if (!values || values.length === 0) {
    return { line: "", area: "", points: [] };
  }

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = values.length > 1 ? i * stepX : width / 2;
    const y = padY + (1 - (v - min) / range) * (height - padY * 2);
    return [x, y];
  });

  if (points.length === 1) {
    const [x, y] = points[0];
    return { line: `M ${x},${y} L ${x},${y}`, area: "", points };
  }

  const p = [points[0], ...points, points[points.length - 1]];
  let line = `M ${p[1][0].toFixed(1)},${p[1][1].toFixed(1)} `;
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const [x3, y3] = p[i + 2];
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    line += `C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} `;
  }
  line = line.trim();

  const lastX = points[points.length - 1][0];
  const firstX = points[0][0];
  const area = `${line} L ${lastX.toFixed(1)},${height} L ${firstX.toFixed(1)},${height} Z`;

  return { line, area, points };
}

export function buildConicGradient(segments) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let acc = 0;
  const stops = segments.map((s) => {
    const start = (acc / total) * 100;
    acc += s.value;
    const end = (acc / total) * 100;
    return `${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}
