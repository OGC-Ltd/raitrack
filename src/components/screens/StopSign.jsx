import { STOP_COLOR, stopSvg, svgUrl } from "../../lib/fuelIcons";

/** The traditional road stop sign (operator, 2026-10-08: "🛑 this is the icon
 *  to use on the stop"; 2026-10-20: "use the traditional stop sign 🛑", then
 *  small and without the word): the red octagon on a white rim the fuel graph
 *  draws, so a stop looks the same everywhere. */
export default function StopSign({ size = 12 }) {
  return (
    <svg className="stop-sign" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="7.1,0.3 16.9,0.3 23.7,7.1 23.7,16.9 16.9,23.7 7.1,23.7 0.3,16.9 0.3,7.1" fill="#fff" />
      <polygon points="7.6,1.5 16.4,1.5 22.5,7.6 22.5,16.4 16.4,22.5 7.6,22.5 1.5,16.4 1.5,7.6" fill={STOP_COLOR} />
      <polygon points="8.2,3 15.8,3 21,8.2 21,15.8 15.8,21 8.2,21 3,15.8 3,8.2" fill="none" stroke="#fff" strokeWidth="0.9" />
    </svg>
  );
}

/** The same sign as a map marker icon, with an optional number on it. */
export function stopSignIcon(size = 22, text = "") {
  const svg = text
    ? stopSvg().replace("</svg>", `<text x="12" y="15.6" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="700" fill="#fff">${text}</text></svg>`)
    : stopSvg();
  return { url: svgUrl(svg), size: { width: size, height: size }, anchor: { x: size / 2, y: size / 2 } };
}
