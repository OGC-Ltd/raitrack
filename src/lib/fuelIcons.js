// The fuel report's event icons, drawn the same on the graph and on the map:
// a GREEN fuel pump for a filling, a RED fuel pump for a drain, and a road
// stop sign (red octagon, white rim) for a stop.
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

/**
 * A road stop sign (operator, 2026-10-20: "an actual stop sign"): the red
 * octagon on a white rim with a thin white line inside it, 24×24, drawn as
 * small as the pumps and without the word (operator, 2026-10-20: "make them
 * small like the fuel drain and fill and remove the text stop").
 */
export function stopSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
    + `<polygon points="7.1,0.3 16.9,0.3 23.7,7.1 23.7,16.9 16.9,23.7 7.1,23.7 0.3,16.9 0.3,7.1" fill="#fff"/>`
    + `<polygon points="7.6,1.5 16.4,1.5 22.5,7.6 22.5,16.4 16.4,22.5 7.6,22.5 1.5,16.4 1.5,7.6" fill="${STOP_COLOR}"/>`
    + `<polygon points="8.2,3 15.8,3 21,8.2 21,15.8 15.8,21 8.2,21 3,15.8 3,8.2" fill="none" stroke="#fff" stroke-width="0.9"/>`
    + `</svg>`;
}

export const svgUrl = (svg) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
