// The fuel report's event icons, drawn the same on the graph and on the map:
// a GREEN fuel pump for a filling, a RED fuel pump for a drain, and a plain
// red stop sign (no lettering) for a stop.
//
// Plain SVG strings so one drawing serves both: the graph renders them inside
// its own <svg> (as a nested <svg>), the map takes them as a data URL.

export const FILL_COLOR = "#16a34a";
export const DRAIN_COLOR = "#dc2626";
export const STOP_COLOR = "#dc2626";

/** A pump on a round badge, 24×24. */
export function pumpSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
    + `<circle cx="12" cy="12" r="11" fill="${color}" stroke="#fff" stroke-width="1.5"/>`
    + `<g fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M7 18V7.5A1.5 1.5 0 0 1 8.5 6h4A1.5 1.5 0 0 1 14 7.5V18"/>`
    + `<path d="M6 18h9"/><path d="M7 10.5h7" />`
    + `<path d="M14 12h.8a1.2 1.2 0 0 1 1.2 1.2v2a1 1 0 0 0 2 0V9.5L16.2 7.7"/>`
    + `</g></svg>`;
}

/** A plain stop sign — the octagon, no lettering — 24×24. */
export function stopSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
    + `<polygon points="7.4,1 16.6,1 23,7.4 23,16.6 16.6,23 7.4,23 1,16.6 1,7.4" fill="${STOP_COLOR}" stroke="#fff" stroke-width="1.5"/>`
    + `</svg>`;
}

export const svgUrl = (svg) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
