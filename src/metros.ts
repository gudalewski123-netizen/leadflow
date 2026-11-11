/* Money metros (2026-11-10, Gregg: "we need big cities, they have money… cities that have money, that is important").
   Each big, high-income metro plus its affluent suburbs. Searching the core city alone keeps returning the same
   established companies (already paid for, mostly with websites); the suburbs surface the small operators who work
   in those same wealthy areas. Keep suburbs that are real towns people type into a search. */
export const MONEY_METROS: Record<string, { state: string; places: string[] }[]> = {
  "New York": [{ state: "NY", places: ["Brooklyn", "Queens", "Staten Island", "White Plains", "Scarsdale", "Yonkers", "Huntington", "Garden City", "Great Neck", "Long Island"] },
               { state: "NJ", places: ["Hoboken", "Jersey City", "Montclair", "Morristown", "Paramus", "Princeton", "Summit"] },
               { state: "CT", places: ["Greenwich", "Stamford", "Westport", "Norwalk"] }],
  "Boston": [{ state: "MA", places: ["Boston", "Newton", "Wellesley", "Brookline", "Lexington", "Needham", "Cambridge", "Quincy"] }],
  "Washington DC": [{ state: "DC", places: ["Washington"] },
                    { state: "VA", places: ["Arlington", "Alexandria", "McLean", "Fairfax", "Reston", "Ashburn", "Leesburg"] },
                    { state: "MD", places: ["Bethesda", "Rockville", "Potomac", "Silver Spring", "Gaithersburg"] }],
  "Philadelphia": [{ state: "PA", places: ["Philadelphia", "King of Prussia", "Bryn Mawr", "Doylestown", "West Chester"] }],
  "Atlanta": [{ state: "GA", places: ["Atlanta", "Alpharetta", "Roswell", "Marietta", "Johns Creek", "Sandy Springs", "Milton", "Peachtree City"] }],
  "Miami": [{ state: "FL", places: ["Miami", "Coral Gables", "Miami Beach", "Fort Lauderdale", "Boca Raton", "Weston", "Delray Beach", "West Palm Beach", "Palm Beach Gardens", "Jupiter"] }],
  "Tampa": [{ state: "FL", places: ["Tampa", "St. Petersburg", "Clearwater", "Sarasota", "Wesley Chapel"] }],
  "Orlando": [{ state: "FL", places: ["Orlando", "Winter Park", "Windermere", "Lake Nona", "Lake Mary"] }],
  "Naples": [{ state: "FL", places: ["Naples", "Fort Myers", "Bonita Springs"] }],
  "Jacksonville": [{ state: "FL", places: ["Ponte Vedra", "St. Augustine"] }],
  "Nashville": [{ state: "TN", places: ["Nashville", "Brentwood", "Franklin", "Murfreesboro", "Hendersonville"] }],
  "Charlotte": [{ state: "NC", places: ["Charlotte", "Huntersville", "Matthews", "Mooresville", "Cornelius"] }],
  "Raleigh": [{ state: "NC", places: ["Raleigh", "Cary", "Apex", "Wake Forest", "Durham", "Chapel Hill"] }],
  "Dallas": [{ state: "TX", places: ["Dallas", "Plano", "Frisco", "McKinney", "Southlake", "Allen", "Prosper", "Highland Park", "Flower Mound", "Fort Worth"] }],
  "Houston": [{ state: "TX", places: ["Houston", "The Woodlands", "Katy", "Sugar Land", "Cypress", "Pearland", "Spring"] }],
  "Austin": [{ state: "TX", places: ["Austin", "Round Rock", "Cedar Park", "Georgetown", "Lakeway", "Dripping Springs"] }],
  "San Antonio": [{ state: "TX", places: ["San Antonio", "Boerne", "New Braunfels"] }],
  "Chicago": [{ state: "IL", places: ["Chicago", "Naperville", "Evanston", "Oak Brook", "Schaumburg", "Hinsdale", "Wheaton", "Barrington", "Lake Forest"] }],
  "Minneapolis": [{ state: "MN", places: ["Minneapolis", "Edina", "Eden Prairie", "Wayzata", "Plymouth", "Woodbury"] }],
  "Detroit": [{ state: "MI", places: ["Troy", "Birmingham", "Novi", "Ann Arbor", "Bloomfield Hills", "Rochester Hills"] }],
  "Columbus": [{ state: "OH", places: ["Columbus", "Dublin", "New Albany", "Westerville", "Powell"] }],
  "Indianapolis": [{ state: "IN", places: ["Indianapolis", "Carmel", "Fishers", "Zionsville", "Noblesville"] }],
  "Kansas City": [{ state: "KS", places: ["Overland Park", "Leawood", "Olathe"] }, { state: "MO", places: ["Kansas City", "Lee's Summit"] }],
  "St. Louis": [{ state: "MO", places: ["St. Louis", "Chesterfield", "Clayton", "Town and Country", "Wildwood"] }],
  "Denver": [{ state: "CO", places: ["Denver", "Boulder", "Highlands Ranch", "Littleton", "Castle Rock", "Parker", "Cherry Hills Village"] }],
  "Phoenix": [{ state: "AZ", places: ["Phoenix", "Scottsdale", "Paradise Valley", "Chandler", "Gilbert", "Mesa", "Queen Creek"] }],
  "Las Vegas": [{ state: "NV", places: ["Las Vegas", "Henderson", "Summerlin"] }],
  "Salt Lake City": [{ state: "UT", places: ["Salt Lake City", "Park City", "Draper", "Lehi", "Sandy"] }],
  "Seattle": [{ state: "WA", places: ["Seattle", "Bellevue", "Redmond", "Kirkland", "Sammamish", "Issaquah", "Mercer Island"] }],
  "Portland": [{ state: "OR", places: ["Portland", "Lake Oswego", "West Linn", "Beaverton"] }],
  "San Francisco Bay": [{ state: "CA", places: ["San Francisco", "San Jose", "Palo Alto", "Fremont", "Walnut Creek", "Danville", "San Ramon", "Pleasanton", "Los Gatos", "Oakland"] }],
  "Los Angeles": [{ state: "CA", places: ["Los Angeles", "Beverly Hills", "Santa Monica", "Pasadena", "Calabasas", "Malibu", "Burbank", "Thousand Oaks", "Long Beach"] }],
  "Orange County": [{ state: "CA", places: ["Irvine", "Newport Beach", "Huntington Beach", "Laguna Beach", "Mission Viejo", "Anaheim"] }],
  "San Diego": [{ state: "CA", places: ["San Diego", "La Jolla", "Carlsbad", "Encinitas", "Del Mar", "Escondido"] }],
  "Sacramento": [{ state: "CA", places: ["Sacramento", "Folsom", "Roseville", "El Dorado Hills"] }],
};

/** Flat list in metro order, each place once. */
export const MONEY_PLACES: { city: string; state: string; metro: string }[] = Object.entries(MONEY_METROS).flatMap(([metro, parts]) =>
  parts.flatMap((p) => p.places.map((city) => ({ city, state: p.state, metro }))));
