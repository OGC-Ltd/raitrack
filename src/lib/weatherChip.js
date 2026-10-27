// What a weather chip on the map says (lib/weatherLayer), kept apart from
// Leaflet so it can be tested without a DOM.

const RAINY = new Set([
  "LIGHT_RAIN", "RAIN", "MODERATE_RAIN", "HEAVY_RAIN", "RAIN_PERIODICALLY_HEAVY",
  "LIGHT_RAIN_SHOWERS", "CHANCE_OF_SHOWERS", "SCATTERED_SHOWERS", "RAIN_SHOWERS",
  "HEAVY_RAIN_SHOWERS", "LIGHT_TO_MODERATE_RAIN", "MODERATE_TO_HEAVY_RAIN", "DRIZZLE",
]);

/** "rain" | "storm" | null: how loud the chip's edge is. */
export function weatherTone(p) {
  const t = p?.type ?? "";
  if (t.includes("THUNDER") || (p?.thunderPct ?? 0) >= 50) return "storm";
  if (RAINY.has(t) || (p?.rainPct ?? 0) >= 60) return "rain";
  return null;
}

/** The hover line: "Light rain · 70% rain · wind 14 km/h from the NE". */
export function weatherTitle(p) {
  const bits = [p.text || p.type];
  if (p.rainPct != null) bits.push(`${p.rainPct}% rain`);
  if (p.thunderPct) bits.push(`${p.thunderPct}% thunder`);
  if (p.windKmh != null) {
    const from = p.windFrom ? ` from the ${p.windFrom.replaceAll("_", " ").toLowerCase()}` : "";
    bits.push(`wind ${Math.round(p.windKmh)} km/h${from}`);
  }
  if (p.visibilityKm != null && p.visibilityKm < 5) bits.push(`visibility ${p.visibilityKm} km`);
  return bits.join(" · ");
}
