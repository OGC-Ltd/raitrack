/* Finding a geofence by name, for the map rail's search box.
 *
 * Names are operator-typed ("MENENGAI_VS:SUKARI MINI MARKET"), so every word of
 * the search has to appear somewhere in the name, in any order. An account can
 * hold thousands, so the list is capped and `total` says how many matched. */

export const FENCE_SEARCH_LIMIT = 30;

const clean = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** The whole name, then its start, then the start of a word in it, then anywhere. */
function rank(name, term) {
  if (name === term) return 0;
  if (name.startsWith(term)) return 1;
  const at = name.indexOf(term);
  if (at > 0 && !/[a-z0-9]/.test(name[at - 1])) return 2;
  return 3;
}

/**
 * @param {Array<object>} features GeoJSON fences, each with `properties.name`
 * @returns {{ hits: Array<object>, total: number }}
 */
export function matchFences(features, query, limit = FENCE_SEARCH_LIMIT) {
  const term = clean(query);
  if (!term || !features?.length) return { hits: [], total: 0 };
  const words = term.split(" ");
  const found = [];
  for (const feature of features) {
    const name = clean(feature?.properties?.name);
    if (words.every((w) => name.includes(w))) found.push({ feature, name, rank: rank(name, term) });
  }
  found.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { hits: found.slice(0, limit).map((f) => f.feature), total: found.length };
}

/** The second line of a result: what shape it is, and how big. */
export function fenceDetail(feature) {
  const p = feature?.properties ?? {};
  const type = feature?.geometry?.type;
  if (type === "Point") return Number.isFinite(p.radiusM) ? `Circular fence · ${p.radiusM.toLocaleString()} m radius` : "Circular fence";
  if (type === "Polygon") return Number.isFinite(p.areaHa) && p.areaHa > 0 ? `Drawn fence · ${p.areaHa.toLocaleString()} ha` : "Drawn fence";
  return p.category === "road" ? "Route" : "Line";
}
