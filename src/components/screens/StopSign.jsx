/** The stop sign (operator, 2026-10-08: "🛑 this is the icon to use on the stop"). */
export default function StopSign({ size = 12 }) {
  return (
    <svg className="stop-sign" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.86 1h8.28L23 7.86v8.28L16.14 23H7.86L1 16.14V7.86Z" fill="#dc2626" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="6" y="10.4" width="12" height="3.2" rx="0.6" fill="#fff" />
    </svg>
  );
}

/** The same sign as a map marker icon, with an optional number on it. */
export function stopSignIcon(size = 22, text = "") {
  const t = text
    ? `<text x="12" y="15.6" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="700" fill="#fff">${text}</text>`
    : '<rect x="6" y="10.4" width="12" height="3.2" rx="0.6" fill="#fff"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M7.86 1h8.28L23 7.86v8.28L16.14 23H7.86L1 16.14V7.86Z" fill="#dc2626" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>${t}</svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size: { width: size, height: size }, anchor: { x: size / 2, y: size / 2 } };
}
