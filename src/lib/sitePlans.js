/**
 * The works-site surveys, as a table: which organisation has which, where the
 * file is, and what camera it wants.
 *
 * Lifted out of FleetMap because it is no longer only FleetMap's. A vehicle
 * can stand inside a survey belonging to an organisation OTHER than the one
 * the operator has open — a West Kenya lorry unloading at Raiply, a Sukari
 * tractor on a neighbour's weighbridge — and lib/guestSitePlans has to be able
 * to test every survey on the platform against this fleet, not just the ones
 * this tenant owns. Two copies of this table would be one place for a new
 * survey to be added and another for it to be forgotten.
 */

// ── works-site plans ───────────────────────────────────────────────────────
//
// A mill's own survey: the site fence and the named places inside it.
// Converted from the operations team's Google Earth export by
// tools/kml-to-site.mjs, which is where the rules about what is dropped live.
//
// Four organisations have at least one; the table below is the whole list, and
// it has outgrown the sentence that used to enumerate it here. They differ in
// kind as much as in place — Kabras is 29 named places inside one fence, Oyani
// is three quarters of a hectare with a gate on it, Big Farm is 11.66 km2 of ground, and the
// Molo outlines are a river with no fence at all — which is why each row
// carries its own camera and its own zoom floor rather than inheriting one
// number for "a site".
//
// It is a static asset rather than geofence rows for two reasons, both about
// not breaking things that already work: rows in `geofences` are ENFORCED, so a
// display area there is one flag away from raising violations for trucks
// parked exactly where they belong; and the Wialon sync owns that table by
// `external_id`, so hand-added rows last until the next sync disagrees. Keeping
// it out of the geofence collection also keeps it out of the browser's
// zone-containment pass — a site plan must never decide whether a unit counts
// as stranded.
//
// Same shape as the Kasulu planting plan above, and gated the same way: without
// an explicit org test a static asset will happily draw Kabras' gates over
// Menengai's refinery.
//
// A LIST per company, because an operator can have more than one place worth
// drawing and they are not one layer. West Kenya runs Kabras and Nzoia, 29 km
// apart; Menengai has an estate and the river beside it, 7 km apart. A single
// switch framing a pair like that lands the camera at a zoom where neither is
// legible and neither one's pins are drawn — so each survey gets its own
// switch, and pressing it takes you to that place.
//
// Everything below reads this table: the fetch, the styling, the hover card,
// the camera, the discard on org switch. A new survey is a row here and a file
// in public/ — and a copy of that file in fleet-server/assets/site-plans/,
// where the Logbook names a stop inside a site after the site and the named
// area in it (usage-review.siteplans, 2026-10-09).
//
//   id            what the map calls this layer internally, and the key its
//                 built shapes are cached under
//   prefKey       where its on/off lives in lib/mapPrefs. The two surveys that
//                 shipped before this table existed keep the plain `site` key,
//                 so nobody's stored preference is dropped in the change
//   fit           the camera this survey wants. The default is a works site:
//                 1 km of detail, framed tight. An estate is not that — Big
//                 Farm is 6.3 km across and zoom 16 shows a corner of it
//   pointMinZoom  below this its markers are hidden, because a dozen pins in
//                 a few hundred pixels is one blob. The polygons always draw
const SITE_FIT_ESTATE = { min: 12, max: 15 };   // a farm
const SITE_FIT_REACH  = { min: 13, max: 16 };   // a river run
// A survey with no `fit` of its own gets the works-site camera below
// (SITE_MIN_ZOOM / SITE_MAX_ZOOM), which is what the three mill yards want.

export const SITE_PLANS = {
  // Kabras and Nzoia are organisations of their own since 2026-10-07, and each
  // mill's survey went with it (it sat under West Kenya before). Each is that
  // org's only survey, so each takes the plain `site` key — preferences are
  // stored per company, so the two cannot collide.
  kabras: [
    { id: "kabras", prefKey: "site", url: "/kabras-site.geojson", label: "Kabras site plan" },
  ],
  nzoia: [
    { id: "nzoia",  prefKey: "site", url: "/nzoia-site.geojson",  label: "Nzoia site plan" },
  ],
  westsugar: [
    // The sugar run, both ends of it. Naitiri is where a loaded lorry starts
    // and Raiply is where it is going, 50 km east — so unlike the two mills
    // above these are a PAIR, and an operator reading one usually wants the
    // other. They are still two switches: 50 km apart, one fit cannot frame
    // both at a zoom where either is legible.
    //
    // `pointMinZoom` is lowered from the default 15 for the same reason
    // Menengai's Big Farm lowers it — each survey carries exactly ONE pin, its
    // gate, so there is nothing for it to pile into, and the gate is the whole
    // point of these two: it is where a trip actually begins and ends.
    { id: "naitiri", prefKey: "site:naitiri", url: "/naitiri-site.geojson",
      label: "Naitiri site plan", pointMinZoom: 13 },
    { id: "raiply",  prefKey: "site:raiply",  url: "/raiply-site.geojson",
      label: "Raiply site plan",  pointMinZoom: 13 },
  ],
  sukari: [
    { id: "sukari", prefKey: "site",       url: "/sukari-site.geojson", label: "Sukari site plan" },
    // Two out-centres, not mills: Oyani is 0.75 ha and Nyaondo 0.98 ha, each
    // surveyed as one ring and one gate. Neither needs a `fit` of its own —
    // they are a tenth of the ground the works-site camera was tuned for, so
    // it simply clamps at its tightest zoom, which is what they want.
    //
    // Three switches rather than one Sukari layer, for the reason the table
    // above gives: the mill, Oyani 32 km south-east of it, and Nyaondo 13 km
    // north-east of Oyani. A single fit framing that spread lands the camera
    // at a zoom where none of the three is legible.
    //
    // `pointMinZoom` is lowered to 13 as it is for Naitiri and Raiply: one pin
    // apiece, the gate, so there is nothing for it to pile into — and the gate
    // is what an operator opened the layer to find.
    { id: "oyani",   prefKey: "site:oyani",   url: "/oyani-site.geojson",
      label: "Oyani site plan",   pointMinZoom: 13 },
    { id: "nyaondo", prefKey: "site:nyaondo", url: "/nyaondo-site.geojson",
      label: "Nyaondo site plan", pointMinZoom: 13 },
  ],
  menengai: [
    // Not a works site: 11.66 km2 of ground with one surveyed gate on it. The
    // estate camera frames the whole block, and the gate shows two zoom steps
    // earlier than a mill's pins would — there is one of it, so it cannot pile
    // into anything.
    { id: "bigfarm", prefKey: "site:bigfarm", url: "/bigfarm-site.geojson",
      label: "Big Farm", fit: SITE_FIT_ESTATE, pointMinZoom: 12 },
    // Two traced outlines of the river, 7 km north of the farm. No perimeter:
    // a river has no site fence, and the largest of its outlines is water
    // rather than a boundary — see --no-fence in tools/kml-to-site.mjs.
    { id: "molo", prefKey: "site:molo", url: "/molo-site.geojson",
      label: "Molo River", fit: SITE_FIT_REACH, pointMinZoom: 13 },
  ],
};

/** Stable empty list, so an org with no survey does not hand every memo and
 *  effect below a brand-new array on each render. */
export const NO_PLANS = [];

/**
 * Every survey on the platform, flat, each carrying the organisation that owns
 * it.
 *
 * The lookup the guest layer needs and the per-company table cannot give: "is
 * this point inside ANY surveyed site" is a question about the whole platform,
 * and the answer has to name the owner or the layer cannot say whose yard the
 * unit is standing in.
 */
export const ALL_SITE_PLANS = Object.entries(SITE_PLANS).flatMap(
  ([companyId, plans]) => plans.map((plan) => ({ ...plan, companyId })));

