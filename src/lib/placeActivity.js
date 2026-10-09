/**
 * What a named place is — and so what a unit most likely stopped there for: a
 * bank is banking, a garage mechanical, a kinyozi a haircut (operator,
 * 2026-10-09). Plain words an operator reads at a glance.
 *
 * Read from the name first, then from Google's types (operator, 2026-10-09:
 * "by looking into the exact location they can extract text and know the
 * activity"): the words in a name ("Motorcycle Spares", "Resort", "Kinyozi")
 * say more than Google's type for owner-added places, which is often only
 * "point of interest" or a guess ("lodging" for a resort that is a bar and
 * dance floor). Ambiguous words wait until Google's types have spoken — a
 * Kenyan "hotel" is usually an eatery, but not when Google lists it as
 * lodging; a "depot" is usually works, but not a fish restaurant.
 *
 * The same groups as the server's model (usage-review.activity-ai) and the
 * OpenStreetMap readings (lib/osmPlaceNames, usage-review.poi).
 */

/** Words that say what a place is whatever Google's type says. First match wins. */
const STRONG = [
  ["Fuel", /\b(filling station|petrol|service station|fuel|energy station|shell|rubis|total ?energies|kobil|ola energy|gas station)\b/i],
  ["Mechanical", /\b(garage|motors?|motor ?cycles?|motor ?bikes?|boda|spares|spare parts|tyres?|tires?|mechanics?|mechanical|car wash|auto|welding|panel beat\w*|lube|vulcani[sz]\w*)\b/i],
  ["Banking", /\b(bank|sacco|microfinance|m-?pesa|forex|bureau|finance trust)\b/i],
  ["Medical", /\b(hospital|clinic|pharmacy|chemist|dispensary|health cent(re|er)|medical|maternity|nursing home|dental|laboratory)\b/i],
  ["Barber / salon", /\b(kinyozi|barbers?|barber ?shop|salon|saloon|beauty|hair|nails?|spa|cuts)\b/i],
  // "park" alone is a park; a bus, car or business park is not entertainment.
  ["Entertainment", /\b(resort|club|lounge|disco|night ?club|stadium|gym|jim|fitness|cinema|casino|arena|amusement|(?<!\b(bus|car|lorry|truck|matatu|business|industrial|tech|technology)\s)park)\b/i],
  ["Worship", /\b(church|mosque|cathedral|parish|chapel|temple|ministries|masjid)\b/i],
  ["Education", /\b(school|academy|college|university|polytechnic|institute|kindergarten|nursery school)\b/i],
  ["Government", /\b(police|county government|sub-?county|chief'?s|court|post office|ministry|huduma|kra|ntsa|government)\b/i],
];

/** Google's types, by group. First match wins, so the specific come first. */
const GROUPS = [
  ["Fuel", ["gas_station", "electric_vehicle_charging_station"]],
  ["Mechanical", ["car_repair", "car_wash", "car_dealer", "auto_parts_store", "tire_shop", "truck_dealer", "motorcycle_dealer", "motorcycle_repair_shop"]],
  ["Banking", ["bank", "atm", "finance", "accounting", "insurance_agency", "money_transfer"]],
  ["Medical", ["hospital", "doctor", "dentist", "dental_clinic", "pharmacy", "drugstore", "medical_lab", "physiotherapist", "health", "medical_clinic", "chiropractor", "veterinary_care"]],
  ["Barber / salon", ["hair_salon", "barber_shop", "beauty_salon", "hair_care", "nail_salon", "spa", "beautician"]],
  // Before lodging: a resort's types include "lodging".
  ["Entertainment", ["resort_hotel", "night_club", "stadium", "park", "gym", "fitness_center", "tourist_attraction", "event_venue", "sports_complex", "sports_club", "amusement_park", "movie_theater", "casino", "bowling_alley", "water_park", "zoo"]],
  ["Lodging", ["lodging", "hotel", "motel", "guest_house", "hostel", "inn", "bed_and_breakfast", "campground"]],
  ["Food and drink", ["restaurant", "cafe", "bar", "bakery", "meal_takeaway", "meal_delivery", "food", "coffee_shop", "fast_food_restaurant", "pub", "food_court", "butcher_shop"]],
  ["Worship", ["church", "mosque", "hindu_temple", "synagogue", "place_of_worship"]],
  ["Education", ["school", "primary_school", "secondary_school", "university", "preschool", "library"]],
  ["Government", ["local_government_office", "city_hall", "courthouse", "police", "post_office", "embassy", "fire_station", "government_office"]],
  ["Shopping", ["supermarket", "grocery_store", "convenience_store", "shopping_mall", "market", "hardware_store", "home_goods_store", "clothing_store", "electronics_store", "wholesaler", "department_store", "farm_supply_store"]],
  ["Transport", ["bus_station", "truck_stop", "parking", "airport", "train_station", "transit_depot", "taxi_stand"]],
  ["Farm", ["farm", "ranch"]],
];

/** Words that say what a place is only where Google's types do not. */
const WEAK = [
  // A factory, a weighbridge ("Waybridge", as Google's listings spell it), a
  // cane buying centre: where the factory's units work.
  ["Work", /\b(sugar|factory|mill|workshop|industr\w*|plant|yard|depot|weigh ?bridge|waybridge|warehouse|cane|buying cent(re|er))\b/i],
  ["Lodging", /\b(lodge|lodging|guest ?house|inn|motel|hostel|bnb)\b/i],
  ["Food and drink", /\b(restaurant|cafe|café|eatery|butchery|nyama choma|choma|kitchen|bakery|bar|pub|grill|canteen|hotel)\b/i],
  ["Shopping", /\b(supermarket|shop|stores?|supplies|wholesale|wholesalers|hardware|market|boutique|agrovet|agro ?vet|mall|enterprises?|distributors?|phones?|electronics|mobile|cyber)\b/i],
  ["Transport", /\b(bus (park|station|stage)|stage|parking|terminus|matatu)\b/i],
  ["Farm", /\b(farm|ranch|plantation)\b/i],
];
const OFFICE = /\b(office|offices|headquarters|hq|company|limited|ltd)\b/i;

/** "Diamond Motorcycle Spares, 0.5 km away" → "Diamond Motorcycle Spares". */
export const bareName = (name) => (name ?? "").replace(/,\s*[\d.]+\s*km away$/i, "").trim();

/**
 * @param {{ name?: string, primaryType?: string|null, types?: string[] }} g
 * @returns {string|null} the group, or null when nothing says what it is
 */
export function placeActivity(g) {
  if (!g) return null;
  const name = bareName(g.name);
  for (const [label, re] of STRONG) if (name && re.test(name)) return label;
  const types = [g.primaryType, ...(g.types ?? [])].filter(Boolean);
  for (const [label, keys] of GROUPS) {
    if (types.some((t) => keys.includes(t) || keys.some((k) => t.endsWith(`_${k}`)))) return label;
  }
  // "kenyan_restaurant", "shoe_store": the group by its last word.
  if (types.some((t) => t.endsWith("_restaurant"))) return "Food and drink";
  if (types.some((t) => t.endsWith("_store") || t.endsWith("_shop"))) return "Shopping";
  for (const [label, re] of WEAK) if (name && re.test(name)) return label;
  // Google's bare "store" says less than the name does, so it comes after it.
  if (types.includes("store")) return "Shopping";
  if (types.includes("corporate_office") || (name && OFFICE.test(name))) return "Offices";
  return null;
}
