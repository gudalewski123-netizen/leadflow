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

