// Which fences the live map draws (user, 2026-11-18). For Menengai an inactive
// fence is not shown: its 6,159 Wialon zones came in switched off and are being
// replaced by fences drawn here. Other organisations keep showing inactive
// fences: Kasulu's estate areas are inactive and ARE the map's estate layer.
//
// Archived fences never reach the browser: the server leaves them out of
// /geofences/geojson. Mirrors fleet-server src/lib/fence-archive.ts.

export const HIDE_INACTIVE_FENCE_ORGS = ["MENENGAI"];

export function hidesInactiveFences(orgCode) {
  return HIDE_INACTIVE_FENCE_ORGS.includes(String(orgCode ?? "").toUpperCase());
}

/**
 * The FeatureCollection the map draws: the same object when nothing is hidden,
 * so memoised consumers do not rebuild for other organisations.
 */
export function mapFences(fc, orgCode) {
  if (!fc?.features || !hidesInactiveFences(orgCode)) return fc;
  const features = fc.features.filter((f) => f?.properties?.isActive !== false);
  return features.length === fc.features.length ? fc : { ...fc, features };
}
