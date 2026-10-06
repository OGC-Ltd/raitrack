// Mapbox as the base map, Google's own tiles as the fallback.
//
// Operator, 2026-10-03: "we would like to use Mapbox as primary and Google Map
// as secondary (fallback), use the access token in the .env
// VITE_MAPBOX_API_KEY". Chosen scope: the BASE MAP only. The map engine stays
// Google Maps JS, so every marker, cluster, route, replay, site-plan layer and
// window keeps working unchanged; only the tiles under them come from Mapbox.
//
// Two Mapbox styles stand in for Google's two map types:
//   roadmap → mapbox/streets-v12            ("Map")
//   hybrid  → mapbox/satellite-streets-v12  ("Satellite", imagery + labels)
//
// Fallback. Each map watches its own tiles. No token, or a run of tiles that
// fail without one ever loading (a revoked token, a spent quota, Mapbox down),
// and the map is switched to Google's own type of the same kind, for the rest
// of the session: a base map that flickers between providers is worse than
// either one.
//
// Switch: MAPBOX_ENABLED. Set it false to go back to Google tiles everywhere
// without touching the two maps that use this.

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_API_KEY || "").trim();

/** One place to turn the Mapbox base map off.
 *  Off (operator, 2026-10-03: "make Google Map the primary here"): both maps
 *  are back on Google's own tiles. Everything else in this file stays, so
 *  setting this true puts Mapbox back in front with Google as its fallback. */
export const MAPBOX_ENABLED = false;

const STYLES = {
  roadmap: { id: "mb-roadmap", style: "mapbox/streets-v12",           name: "Map" },
  hybrid:  { id: "mb-hybrid",  style: "mapbox/satellite-streets-v12", name: "Satellite" },
};

const STYLE_IDS = new Set(Object.values(STYLES).map((s) => s.id));

/** Consecutive failed tiles, with none loaded yet, that count as "Mapbox is down". */
const FAIL_RUN = 6;

/** Session-wide: once Mapbox has failed, every map stays on Google. */
let mapboxDead = !MAPBOX_TOKEN || !MAPBOX_ENABLED;

export const mapboxActive = () => !mapboxDead;

/** The attribution Mapbox's terms require wherever its tiles are shown. */
export const MAPBOX_ATTRIBUTION = [
  { text: "© Mapbox", href: "https://www.mapbox.com/about/maps/" },
  { text: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  { text: "Improve this map", href: "https://www.mapbox.com/map-feedback/" },
];

function tileUrl(style, x, y, z) {
  // 256 tiles at @2x: a 512px image drawn into Google's 256px grid, sharp on
  // a high-density screen.
  return `https://api.mapbox.com/styles/v1/${style}/tiles/256/${z}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;
}

/**
 * A Google MapType drawing Mapbox raster tiles, with getTile written out
 * (rather than an ImageMapType) so each tile's load and error can be watched.
 */
function makeType(maps, { style, name }, onTile) {
  return {
    tileSize: new maps.Size(256, 256),
    minZoom: 0,
    maxZoom: 22,
    name,
    alt: `${name} (Mapbox)`,
    getTile(coord, zoom, doc) {
      const img = doc.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.style.width = "256px";
      img.style.height = "256px";
      img.style.border = "0";
      const n = 1 << zoom;
      const x = ((coord.x % n) + n) % n; // wrap across the antimeridian
      if (coord.y < 0 || coord.y >= n) return img; // above / below the world
      img.onload = () => onTile(true);
      img.onerror = () => onTile(false);
      img.src = tileUrl(style, x, coord.y, zoom);
      return img;
    },
    releaseTile(tile) {
      if (tile) { tile.onload = null; tile.onerror = null; tile.src = ""; }
    },
  };
}

/**
 * Register the Mapbox types on `map` and return a small controller.
 *
 *   base.typeFor("hybrid")  → the id to pass to setMapTypeId / mapTypeId
 *   base.active()           → true while Mapbox is the base map
 *
 * `onChange(active)` fires once if the map falls back to Google, so the page
 * can take the Mapbox attribution down.
 */
export function installMapboxBase(maps, map, { onChange } = {}) {
  let loadedAny = false;
  let failRun = 0;

  let fellBack = false;
  const fallBack = () => {
    if (fellBack) return;
    fellBack = true;
    mapboxDead = true;
    const current = map.getMapTypeId();
    if (STYLE_IDS.has(current)) map.setMapTypeId(current === STYLES.roadmap.id ? "roadmap" : "hybrid");
    onChange?.(false);
  };

  const onTile = (ok) => {
    if (ok) { loadedAny = true; failRun = 0; return; }
    failRun += 1;
    if (!loadedAny && failRun >= FAIL_RUN) fallBack();
  };

  if (!mapboxDead) {
    for (const s of Object.values(STYLES)) map.mapTypes.set(s.id, makeType(maps, s, onTile));
  }

  return {
    typeFor: (kind) => (mapboxDead ? kind : (STYLES[kind] ?? STYLES.hybrid).id),
    active: () => !fellBack && STYLE_IDS.has(map.getMapTypeId()),
  };
}
