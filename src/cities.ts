/** Top cities per state for batch scanning. Biggest metro first. */
export const STATE_CITIES: Record<string, string[]> = {
  AL: ["Birmingham", "Huntsville", "Montgomery"],
  AK: ["Anchorage", "Fairbanks", "Juneau"],
  AZ: ["Phoenix", "Tucson", "Mesa"],
  AR: ["Little Rock", "Fayetteville", "Fort Smith"],
  CA: ["Los Angeles", "San Diego", "San Jose"],
  CO: ["Denver", "Colorado Springs", "Aurora"],
  CT: ["Bridgeport", "New Haven", "Hartford"],
  DE: ["Wilmington", "Dover", "Newark"],
  FL: ["Miami", "Orlando", "Tampa"],
  GA: ["Atlanta", "Savannah", "Augusta"],
  HI: ["Honolulu", "Hilo", "Kailua"],
  ID: ["Boise", "Meridian", "Nampa"],
  IL: ["Chicago", "Aurora", "Naperville"],
  IN: ["Indianapolis", "Fort Wayne", "Evansville"],
  IA: ["Des Moines", "Cedar Rapids", "Davenport"],
  KS: ["Wichita", "Overland Park", "Kansas City"],
  KY: ["Louisville", "Lexington", "Bowling Green"],
  LA: ["New Orleans", "Baton Rouge", "Shreveport"],
  ME: ["Portland", "Lewiston", "Bangor"],
  MD: ["Baltimore", "Columbia", "Germantown"],
  MA: ["Boston", "Worcester", "Springfield"],
  MI: ["Detroit", "Grand Rapids", "Ann Arbor"],
  MN: ["Minneapolis", "Saint Paul", "Rochester"],
  MS: ["Jackson", "Gulfport", "Hattiesburg"],
  MO: ["Kansas City", "Saint Louis", "Springfield"],
  MT: ["Billings", "Missoula", "Bozeman"],
  NE: ["Omaha", "Lincoln", "Bellevue"],
  NV: ["Las Vegas", "Reno", "Henderson"],
  NH: ["Manchester", "Nashua", "Concord"],
  NJ: ["Newark", "Jersey City", "Paterson"],
  NM: ["Albuquerque", "Las Cruces", "Santa Fe"],
  NY: ["New York", "Buffalo", "Rochester"],
  NC: ["Charlotte", "Raleigh", "Greensboro"],
  ND: ["Fargo", "Bismarck", "Grand Forks"],
  OH: ["Columbus", "Cleveland", "Cincinnati"],
  OK: ["Oklahoma City", "Tulsa", "Norman"],
  OR: ["Portland", "Salem", "Eugene"],
  PA: ["Philadelphia", "Pittsburgh", "Allentown"],
  RI: ["Providence", "Warwick", "Cranston"],
  SC: ["Charleston", "Columbia", "Greenville"],
  SD: ["Sioux Falls", "Rapid City", "Aberdeen"],
  TN: ["Nashville", "Memphis", "Knoxville"],
  TX: ["Houston", "Dallas", "San Antonio"],
  UT: ["Salt Lake City", "West Valley City", "Provo"],
  VT: ["Burlington", "South Burlington", "Rutland"],
  VA: ["Virginia Beach", "Richmond", "Norfolk"],
  WA: ["Seattle", "Spokane", "Tacoma"],
  WV: ["Charleston", "Huntington", "Morgantown"],
  WI: ["Milwaukee", "Madison", "Green Bay"],
  WY: ["Cheyenne", "Casper", "Laramie"],
};

export const ALL_STATES = Object.keys(STATE_CITIES);

/**
 * International coverage. Google Maps works worldwide, so we can scan any
 * country's cities the same way — the query just uses "City, Country" and the
 * lead's region is stored as the full country name (e.g. "Poland"), so it shows
 * up distinctly from the 2-letter US state codes in the dashboard filter.
 */
export const COUNTRY_CITIES: Record<string, string[]> = {
  "United Kingdom": ["London", "Manchester", "Birmingham", "Leeds", "Glasgow", "Liverpool", "Bristol", "Edinburgh", "Sheffield", "Cardiff", "Newcastle", "Nottingham"],
  "Poland": ["Warsaw", "Kraków", "Łódź", "Wrocław", "Poznań", "Gdańsk", "Szczecin", "Lublin", "Katowice", "Bydgoszcz"],
  "Ireland": ["Dublin", "Cork", "Galway", "Limerick", "Waterford"],
  "Germany": ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig"],
  "France": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Bordeaux", "Lille"],
  "Spain": ["Madrid", "Barcelona", "Valencia", "Seville", "Málaga", "Bilbao"],
  "Italy": ["Rome", "Milan", "Naples", "Turin", "Florence", "Bologna"],
  "Netherlands": ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"],
  "Portugal": ["Lisbon", "Porto", "Braga", "Faro"],
  "Canada": ["Toronto", "Montreal", "Vancouver", "Calgary", "Ottawa", "Edmonton", "Winnipeg"],
  "Australia": ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast"],
};

// Type "uk", "poland", etc. in the batch selector → resolve to the full name.
export const COUNTRY_ALIASES: Record<string, string> = {
  uk: "United Kingdom", britain: "United Kingdom", england: "United Kingdom", gb: "United Kingdom",
  poland: "Poland", pl: "Poland",
  ireland: "Ireland", ie: "Ireland",
  germany: "Germany", de: "Germany",
  france: "France", fr: "France",
  spain: "Spain", es: "Spain",
  italy: "Italy", it: "Italy",
  netherlands: "Netherlands", holland: "Netherlands", nl: "Netherlands",
  portugal: "Portugal", pt: "Portugal",
  canada: "Canada", australia: "Australia",
};

export interface Region { state: string; areas: string[] }

/** US state → its cities tagged with the state code, e.g. "Birmingham AL". */
function usRegion(st: string): Region {
  return { state: st, areas: STATE_CITIES[st].map((c) => `${c} ${st}`) };
}
/** Country → its cities tagged with the country, e.g. "Warsaw, Poland". */
function countryRegion(name: string): Region {
  return { state: name, areas: COUNTRY_CITIES[name].map((c) => `${c}, ${name}`) };
}

/**
 * Resolve a location selector into the regions to scan.
 *   "us" / "all"  → all 50 US states
 *   "world"       → US + every country
 *   "intl"        → every country (no US)
 *   "uk,poland"   → those countries
 *   "FL,GA,uk"    → mix of US state codes and countries
 */
export function buildRegions(selector: string): Region[] {
  const sel = selector.toLowerCase().trim();
  if (sel === "us" || sel === "all") return ALL_STATES.map(usRegion);
  if (sel === "intl" || sel === "international") return Object.keys(COUNTRY_CITIES).map(countryRegion);
  if (sel === "world") return [...ALL_STATES.map(usRegion), ...Object.keys(COUNTRY_CITIES).map(countryRegion)];

  const out: Region[] = [];
  for (const raw of selector.split(",").map((s) => s.trim())) {
    const up = raw.toUpperCase();
    const aliased = COUNTRY_ALIASES[raw.toLowerCase()];
    if (STATE_CITIES[up]) out.push(usRegion(up));
    else if (aliased) out.push(countryRegion(aliased));
    else if (COUNTRY_CITIES[raw]) out.push(countryRegion(raw));
  }
  return out;
}

/**
 * Local-business niches that (a) are everywhere, (b) frequently lack a real
 * website, and (c) are good web-design / remodel clients. Pass "allbiz" to the
 * batch to rotate through all of these per city.
 */
/**
 * Skilled trades — owners are tradesmen, not tech people, so they rarely have a
 * real website and convert well. Lines up with the trades-template site stack.
 * Pass "trades" to the batch to scan just these.
 */
export const TRADES = [
  "concrete contractor",
  "hvac contractor",
  "roofing contractor",
  "plumber",
  "electrician",
];

export const NICHES = [
  "barbershop",
  "hair salon",
  "nail salon",
  "tattoo shop",
  "auto detailing",
  "auto repair shop",
  "landscaping",
  "cleaning service",
  "pressure washing",
  "lawn care",
  "handyman",
  "painter",
  "roofing contractor",
  "hvac contractor",
  "plumber",
  "electrician",
  "pest control",
  "moving company",
  "catering",
  "food truck",
  "bakery",
  "coffee shop",
  "boutique",
  "florist",
  "pet grooming",
  "gym",
  "personal trainer",
  "massage therapist",
  "spa",
  "med spa",
  "barber school",
  "daycare",
  "junk removal",
  "towing service",
  "locksmith",
];

