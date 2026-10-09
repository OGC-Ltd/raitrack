/**
 * What a named place is, from Google's types for it — and so what a unit most
 * likely stopped there for: a bank is banking, a restaurant food, a clinic
 * medical (operator, 2026-10-09). Plain words an operator reads at a glance.
 *
 * Google's own wording (`primaryTypeDisplayName`, "Bank", "Kenyan restaurant")
 * is kept beside it as the detail; this is the group it falls in.
 */

// First match wins, so the specific groups come before the broad ones
// (a pharmacy is Medical, not Shopping; a hotel's restaurant is Lodging).
const GROUPS = [
  ["Fuel", ["gas_station", "electric_vehicle_charging_station"]],
  ["Vehicle service", ["car_repair", "car_wash", "car_dealer", "auto_parts_store", "tire_shop", "truck_dealer"]],
  ["Banking", ["bank", "atm", "finance", "accounting", "insurance_agency", "money_transfer"]],
  ["Medical", ["hospital", "doctor", "dentist", "dental_clinic", "pharmacy", "drugstore", "medical_lab", "physiotherapist", "health", "medical_clinic", "chiropractor", "veterinary_care"]],
  ["Lodging", ["lodging", "hotel", "motel", "guest_house", "hostel", "inn", "resort_hotel", "bed_and_breakfast", "campground"]],
  ["Food and drink", ["restaurant", "cafe", "bar", "bakery", "meal_takeaway", "meal_delivery", "food", "coffee_shop", "fast_food_restaurant", "pub", "night_club", "food_court", "butcher_shop"]],
  ["Worship", ["church", "mosque", "hindu_temple", "synagogue", "place_of_worship"]],
  ["Education", ["school", "primary_school", "secondary_school", "university", "preschool", "library"]],
  ["Government", ["local_government_office", "city_hall", "courthouse", "police", "post_office", "embassy", "fire_station", "government_office"]],
  ["Shopping", ["supermarket", "grocery_store", "convenience_store", "shopping_mall", "market", "hardware_store", "home_goods_store", "clothing_store", "electronics_store", "wholesaler", "department_store", "farm_supply_store"]],
  ["Transport", ["bus_station", "truck_stop", "parking", "airport", "train_station", "transit_depot", "taxi_stand"]],
  ["Farm", ["farm", "ranch"]],
  ["Leisure", ["stadium", "park", "gym", "tourist_attraction", "event_venue", "sports_complex"]],
];

/**
 * What the name says, where Google's types do not: places added by their
 * owners are often typed only "point_of_interest" ("Rodesa Filling Station",
 * 2026-10-09). Same order as GROUPS; Kenyan words included (sacco, chemist,
 * dispensary, butchery, agrovet).
 */
const NAMES = [
  ["Fuel", /\b(filling station|petrol|service station|fuel|energy station|shell|rubis|total ?energies|kobil|ola energy)\b/i],
  ["Vehicle service", /\b(garage|motors?|auto ?(spares|parts|centre|center)|spares|tyres?|tires?|mechanics?|car wash)\b/i],
  ["Banking", /\b(bank|sacco|microfinance|m-?pesa|forex|bureau)\b/i],
  ["Medical", /\b(hospital|clinic|pharmacy|chemist|dispensary|health cent(re|er)|medical|maternity|nursing home|dental|laboratory|lab)\b/i],
  // Before food: a "hotel" Google types as lodging is caught by its types; one
  // typed only a point of interest is, in Kenya, most often an eatery.
  ["Lodging", /\b(lodge|lodging|guest ?house|inn|resort|motel|hostel)\b/i],
  ["Food and drink", /\b(restaurant|cafe|café|eatery|butchery|nyama choma|choma|kitchen|bakery|bar|pub|grill|canteen|hotel)\b/i],
  ["Worship", /\b(church|mosque|cathedral|parish|chapel|temple|ministries)\b/i],
  ["Education", /\b(school|academy|college|university|polytechnic|institute|kindergarten|nursery)\b/i],
  ["Government", /\b(police|county|sub-?county|chief'?s|court|post office|ministry|huduma|kra|ntsa|government)\b/i],
  ["Shopping", /\b(supermarket|shop|stores?|supplies|wholesale|wholesalers|hardware|market|boutique|agrovet|agro ?vet|mall|enterprises?|distributors?)\b/i],
  ["Transport", /\b(bus (park|station|stage)|stage|parking|terminus|matatu)\b/i],
  ["Farm", /\b(farm|ranch|plantation)\b/i],
];

/** Names that say industry where Google's type is only "establishment". */
// "Waybridge" as Google's listings spell it; a cane buying centre is where
// the factory weighs and buys cane (2026-10-09).
const WORKS = /\b(sugar|factory|mill|workshop|industr\w*|plant|yard|depot|weigh ?bridge|waybridge|warehouse|estate|cane|buying cent(re|er))\b/i;
const OFFICE = /\b(office|offices|headquarters|hq|company|limited|ltd)\b/i;

/**
 * @param {{ name?: string, primaryType?: string|null, types?: string[] }} g
 * @returns {string|null} the group, or null when nothing says what it is
 */
export function placeActivity(g) {
  if (!g) return null;
  const types = [g.primaryType, ...(g.types ?? [])].filter(Boolean);
  for (const [label, keys] of GROUPS) {
    if (types.some((t) => keys.includes(t) || keys.some((k) => t.endsWith(`_${k}`)))) return label;
  }
  // "kenyan_restaurant", "shoe_store": the group by its last word.
  if (types.some((t) => t.endsWith("_restaurant"))) return "Food and drink";
  if (types.some((t) => t.endsWith("_store") || t.endsWith("_shop"))) return "Shopping";
  if (g.name && WORKS.test(g.name)) return "Industrial / works";
  for (const [label, re] of NAMES) if (g.name && re.test(g.name)) return label;
  // Google's bare "store" says less than the name does, so it comes after it.
  if (types.includes("store")) return "Shopping";
  if (types.includes("corporate_office") || (g.name && OFFICE.test(g.name))) return "Offices";
  return null;
}
