/**
 * The map's weather layer (operator, 2026-10-27: "use the google map apis to
 * show weather on the map in real time").
 *
 * Google sells weather by point, not as tiles, so this is a chip per grid
 * point over the view: the temperature (no icon: the animation shows the
 * weather, and icons cluttered the map, operator 2026-10-27), with
 * rain, thunder and wind on hover. Rain and storms get a coloured edge so they
 * can be picked out from across the map. The points come from fleet-server,
 * which snaps them to a fixed grid and caches each for everyone.
 */
import L from "leaflet";
import { weatherTone, weatherTitle } from "./weatherChip";
import { createWeatherEffects } from "./weatherEffects";

/** Re-read while on: Google refreshes current conditions about this often. */
export const WEATHER_REFRESH_MS = 10 * 60_000;
/** Wait for the map to settle before asking for a new view. */
const SETTLE_MS = 600;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function chipHtml(p) {
  const tone = weatherTone(p);
  const temp = p.tempC != null ? `${Math.round(p.tempC)}°` : "–";
  return `<div class="wx-chip${tone ? ` wx-chip--${tone}` : ""}" title="${esc(weatherTitle(p))}"><span>${temp}</span></div>`;
}

/**
 * Draw on `map` (lib/mapEngine). `fetchGrid(bounds)` resolves to the server's
 * `{ points }`. Returns a function that removes the layer.
 */
export function addWeatherLayer(map, fetchGrid, { onError } = {}) {
  const l = map._l;
  if (!l.getPane("g-weather")) {
    const pane = l.createPane("g-weather");
    pane.style.zIndex = "415"; // over zones and tracks, under the units
  }
  const group = L.layerGroup().addTo(l);
  // Rain, wind and storms animated under the chips (lib/weatherEffects).
  const fx = createWeatherEffects(l, "g-weather");
  let seq = 0;
  let settle = null;

  const load = async () => {
    const mine = ++seq;
    const b = l.getBounds();
    try {
      const { points, step } = await fetchGrid({
        south: Math.max(-90, b.getSouth()), west: Math.max(-180, b.getWest()),
        north: Math.min(90, b.getNorth()),  east: Math.min(180, b.getEast()),
      });
      if (mine !== seq) return; // a newer view answered, or the layer is gone
      group.clearLayers();
      fx.set(points, step);
      for (const p of points) {
        L.marker([p.lat, p.lng], {
          pane: "g-weather",
          interactive: false,
          keyboard: false,
          icon: L.divIcon({ className: "wx-icon", html: chipHtml(p), iconSize: null }),
        }).addTo(group);
      }
    } catch (err) {
      if (mine === seq) onError?.(err);
    }
  };
  const onMove = () => { clearTimeout(settle); settle = setTimeout(load, SETTLE_MS); };

  l.on("moveend", onMove);
  load();
  const timer = setInterval(() => { if (!document.hidden) load(); }, WEATHER_REFRESH_MS);
  return () => {
    seq++;
    clearTimeout(settle);
    clearInterval(timer);
    l.off("moveend", onMove);
    group.remove();
    fx.remove();
  };
}
