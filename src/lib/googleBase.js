/**
 * Google's satellite imagery as a base map, beside OpenStreetMap.
 *
 * "hybrid", not "satellite": the imagery with Google's road and place labels
 * over it, which is what Google Maps itself shows under "Satellite". Bare
 * imagery has no names, and a fleet map is read by road and town.
 *
 * Drawn by Google's own Maps JavaScript API (GoogleMutant mounts a real Google
 * map inside the Leaflet one and keeps them in step) rather than by fetching
 * Google's tile URLs, which their terms forbid. The official tile service, the
 * Map Tiles API, is switched off on this key's Google Cloud project; the Maps
 * JavaScript API is the one the key has always served, so this needs no
 * console change.
 *
 * Loaded on first use only: nobody who stays on OpenStreetMap downloads the
 * Google API or the plugin.
 *
 * The key is VITE_GOOGLE_MAPS_API_KEY, baked in at build time and restricted by
 * HTTP referrer in the Google Cloud console — it answers on the live domain
 * and not on localhost, so in development this reports an error and the map
 * stays on OpenStreetMap.
 */
import L from "leaflet";

export const GOOGLE_TYPE_ID = "google";
export const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
/** Offered only when a key was built in. */
export const GOOGLE_BASE_AVAILABLE = GOOGLE_KEY.length > 0;

let apiPromise = null;

/** The Maps JavaScript API, once per page. Rejects on a refused key. */
export function loadGoogleApi() {
  if (window.google?.maps?.Map) return Promise.resolve();
  apiPromise ??= new Promise((resolve, reject) => {
    const cb = "__ftGoogleMapsReady";
    window[cb] = () => resolve();
    // Google calls this, not an error event, when the key or referrer is refused.
    window.gm_authFailure = () => reject(new Error("Google refused the Maps key on this site"));
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&v=weekly&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error("Could not load Google Maps"));
    document.head.appendChild(s);
  }).catch((e) => { apiPromise = null; throw e; });
  return apiPromise;
}

let mutantPromise = null;

/** The plugin reads Leaflet from `window.L` as it loads, so that is set first. */
function loadMutant() {
  window.L ??= L;
  mutantPromise ??= import("leaflet.gridlayer.googlemutant").then((m) => m.default);
  return mutantPromise;
}

/**
 * Register the "google" map type on `map` (lib/mapEngine). Resolves once it can
 * be selected with `map.setMapTypeId(GOOGLE_TYPE_ID)`.
 */
export async function installGoogleBase(map) {
  if (!GOOGLE_BASE_AVAILABLE) throw new Error("No Google Maps key in this build");
  if (map.mapTypes.get(GOOGLE_TYPE_ID)) return;
  const [GoogleMutant] = await Promise.all([loadMutant(), loadGoogleApi()]);
  map.mapTypes.set(GOOGLE_TYPE_ID, {
    name: "Google Satellite",
    leafletLayer: () => new GoogleMutant({ type: "hybrid", maxZoom: 21 }),
  });
}

/** Google draws its own logo and terms on the map; nothing to add below it. */
export const GOOGLE_ATTRIBUTION = [];
