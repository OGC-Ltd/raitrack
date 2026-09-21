// The companies and their branding.



const COMPANIES = [
  {
    id:           "sukari",
    name:         "Sukari Industries",
    suffix:       "Ltd · KE",
    short:        "Sukari",
    avatarLetter: "S",
    avatarColor:  "#3b82f6",
    accentColor:  "#22c55e",
    vehicleCount: 0,
    tagline:      "Sugar cane & processed sugar logistics",

    // Matches the simulator's SUKARI hub — the plant at Riat, Ndhiwa (Homa Bay).
    hqLocation:   "Sukari Industries, Ndhiwa",
    hqLat:        -0.8209476570106832,
    hqLng:        34.38504854061814,

    // Where the map opens for this company.
    //
    // Operator-supplied, and it corroborates the two figures derived
    // independently: it is ~700 m from the hub the server measures off the
    // densest cluster of the fleet's own fixes, and ~600 m from the median
    // position of every located Sukari vehicle. All three are inside the plant.
    //
    // An explicit point beats fitting the fleet here. Half of Sukari's located
    // units sit within 600 m of the plant while the tail runs out to 91 km, so
    // any bounds-based fit is a compromise between framing the yard and framing
    // the outliers — and the yard is what an operator opens the screen to see.
    // Companies WITHOUT a defaultView still get the fleet-core fit.
    // CHANGED 2026-08-05: defaultView removed. fitBounds now frames the fleet
    // automatically so the opening view shows the actual vehicle spread rather
    // than a hardcoded point that fights every other camera call.
    // defaultView:  { lat: -0.8251622301430451, lng: 34.38727171082534, zoom: 7 },
  },
  {
    id:           "kasulu",
    name:         "Mufindi Paper Mills Ltd",
    suffix:       "· TZ",
    short:        "Kasulu",
    avatarLetter: "K",
    avatarColor:  "#f59e0b",
    accentColor:  "#f59e0b",
    vehicleCount: 0,
    tagline:      "Fleet & logistics operations",
    // Kasulu, Kigoma region (TZ) — placeholder until the RaiFactorySuite
    // integration supplies the real HQ.
    hqLocation:   "Kasulu, Kigoma",
    hqLat:        -4.5766,
    hqLng:        30.1025,
  },
  {
    id:           "menengai",
    name:         "Menengai Oil Refineries Ltd",
    suffix:       "· KE",
    short:        "Menengai",
    avatarLetter: "M",
    avatarColor:  "#14b8a6",
    accentColor:  "#14b8a6",
    vehicleCount: 0,
    tagline:      "Edible oils, board & farm logistics",

    // One organisation, three businesses sharing a Wialon account: Menengai
    // (210 units), Rai MDF (20) and MORL Farm (14).
    //
    // MEASURED, not typed: 53 of the 210 Menengai units sat in a single 1.1 km
    // cell on 2026-08-31, and that cell's centre is this point. It is 2.4 km
    // from the "Menengai Refinery, Nakuru" coordinate the simulator seed
    // carries, which is the reason for measuring rather than copying it.
    //
    // Only the Menengai cluster is used. Rai MDF sits ~17 km north-west
    // (-0.2186, 35.9081) and MORL Farm further again (-0.1989, 35.8661), so a
    // hub fitted to all three would land between the sites, in a field. This
    // point feeds the weather card, which wants the plant, not a centroid.
    hqLocation:   "Menengai Refinery, Nakuru",
    hqLat:        -0.2889,
    hqLng:        36.0446,
  },
  {
    // `id` stays "westsugar": it is not a label but a key — it addresses the
    // org in api/org.js, keys depotData, and is what every browser has already
    // stored under ft-active-company and ft-fleet:*. Renaming it would strand
    // those, for no gain. Only the two display strings below are the name.
    id:           "westsugar",
    name:         "West Kenya Sugar Ltd",
    suffix:       "· KE",
    short:        "West Kenya",
    avatarLetter: "W",
    avatarColor:  "#a855f7",
    accentColor:  "#a855f7",
    vehicleCount: 0,
    tagline:      "Sugar milling & cane haulage",

    // 486 units under two naming conventions — 298 "West Sugar*" and 188
    // "WKS*" — sharing Rai Group's Wialon account with Sukari.
    //
    // MEASURED: 82 of the 448 units that have reported sat in one 1.1 km cell
    // on 2026-08-31, and the West Sugar division alone puts 63 in the same
    // cell. That is the Kabras factory. WKS names its own estates and they
    // cluster separately — Naitiri (0.7821, 34.8776), Amuka (1.0714, 34.9972)
    // — so, as with Menengai, this is the main site rather than a centroid of
    // all of them.
    hqLocation:   "Kabras Factory, Malava",
    hqLat:        0.3781,
    hqLng:        34.8333,
  },
];

export default COMPANIES;
