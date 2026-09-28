/**
 * Is this account plausibly in the trade we searched for?
 *
 * Instagram's user search matches ANY token in the query, so "concrete
 * contractor Des Moines" happily returns anyone whose name contains "Des".
 * Audited 2026-09-23 against 756 hot leads and every large junk account was a
 * CITY-NAME collision, not a niche one:
 *
 *   Paul Wesley (13.6M)      <- Saint PAUL MN
 *   Louis Koo (934k)         <- Saint LOUIS MO
 *   Desi Lydic (758k)        <- DES Moines IA
 *   Rock & Metal (1.6M)      <- Little ROCK AR
 *   park_jiminx7 (280k)      <- Overland PARK KS
 *   Olivier DESmedt (391)    <- DES Moines IA
 *
 * Follower count alone does not catch these — Desmedt has 391. What separates
 * them from a real lead is that nothing about the account mentions the trade.
 *
 * Stems, not whole words: a first pass on whole words binned "The Rubbish
 * Removers" and "Remove and Go" because the list said "removal".
 */
export const NICHE_WORDS: Record<string, string[]> = {
  "mobile detailing": ["detail","auto","car","wash","ceramic","shine","valet","spa","mobile"],
  "auto detailing":   ["detail","auto","car","wash","ceramic","shine","valet","spa"],
  "pressure washing": ["pressure","power","wash","clean","exterior","soft","hydro","jet","streak","grime"],
  "window cleaning":  ["window","glass","clean","pane","streak"],
  "gutter cleaning":  ["gutter","downspout","clean","exterior","leaf"],
  "roofing":          ["roof","shingle","exterior","construct","contract","restor","storm","metal","gutter","energy"],
  "painting":         ["paint","coat","finish","decor","drywall","stain","contract","construct","renovat","remodel"],
  "junk removal":     ["junk","haul","remov","dumpster","debris","cleanout","clean","rubbish","trash","disposal","dump","cart"],
  "landscaping":      ["landscap","lawn","garden","yard","outdoor","turf","hardscape","nursery","scape","green","mulch","sod","mow","grounds","irrigat","construct","property","maint"],
  "lawn care":        ["lawn","turf","mow","grass","yard","landscap","green","scape","sod","grounds","maint"],
  "handyman":         ["handy","repair","fix","home","service","maint","remodel","renovat","improve","build","craft"],
  "concrete contractor":["concrete","cement","masonry","mason","paver","patio","driveway","construct","contract","curb","slab","flatwork","stamp","crete"],
  "fencing":          ["fence","fencing","gate","deck","rail","post"],
  "tree service":     ["tree","arbor","stump","timber","forest","trim","canopy","limb"],
  "sealcoating":      ["seal","asphalt","paving","pave","driveway","blacktop","striping"],
  "plumbing":         ["plumb","drain","pipe","rooter","sewer","water","leak","septic"],
  "electrician":      ["electric","wiring","volt","power","spark","amp","light","energy"],
  "hvac":             ["hvac","heat","cool","air","furnace","climate","refriger","comfort","mechanical"],
  "moving company":   ["mov","relocat","haul","transport","pack","freight"],
  "pool service":     ["pool","spa","aqua","water","swim","chlorine"],
  "hair salon":       ["hair","salon","stylist","style","cut","colour","color","blow","barb","beauty","studio","lounge","locs","braid","extension","balayage"],
  "barbershop":       ["barb","cut","fade","shave","grooming","gents","men","clipper","shop","chair","blend","taper"],
  "nail salon":       ["nail","mani","pedi","polish","lacquer","acrylic","gel","spa","beauty","claw","tip"],
  "lash and brow":    ["lash","brow","extension","beauty","aesthet","esthet","studio","wax","threading","tint","microblad","pmu"],
  "med spa":          ["spa","aesthet","esthet","skin","facial","derm","beauty","glow","botox","filler","laser","rejuven","wellness"],
  "massage therapy":  ["massage","therap","bodywork","spa","relax","wellness","deep","tissue","sports","myo"],
};

/**
 * A trading name carrying a company suffix is plausibly a business even when
 * it names no trade — "Hometown Haulers KC LLC". Kept short on purpose: every
 * entry is a hole the junk can climb back through.
 */
const GENERIC = ["llc", " inc", "inc.", "co.", "services", "service", "solutions", "company", "contracting", "enterprise"];

/**
 * Above this, it is a brand, a chain, a public figure or a fan account — not a
 * local trade. score.ts already said so in a comment but only withheld a
 * 10-point bonus, so Paul Wesley still scored 75 as a Saint Paul concrete
 * contractor. Here it is a hard reject.
 */
export const MAX_FOLLOWERS = 50000;


/**
 * Accounts that are plainly a different industry. The niche words alone don't
 * stop them: an artist called "Rachel Rixen" trips nothing, and a search for
 * "painting" returns artists, galleries and studios by the dozen (SEARCH_TERM
 * now sends "painting contractor", which helps but doesn't cover the ones
 * already in the table).
 *
 * Tokenised on non-letters, not \b — an IG handle hides the word behind an
 * underscore or glues it on the end: "ameliabradshaw_art", "lakesandlightsart".
 */
const OTHER_INDUSTRY = new Set(
  ("art arts artist artists artwork studio studios gallery galleries fineart canvas prints printmaking " +
   "illustration illustrator mural muralist sculpt ceramics pottery craft crafts celf " +
   "fan fanaccount music band brewing brewery promotions promotion dj photography photographer photo " +
   "travel nomad guide showroom academy church school college democrat democrats republican " +
   "realty realtor salon barber tattoo fitness gym yoga restaurant cafe bakery boutique apparel " +
   "clothing jewelry jewellery nails lash").split(" ")
);
export function isOtherIndustry(
  name?: string | null,
  handle?: string | null,
  niche?: string | null
): boolean {
  /* A word is only "another industry" if it isn't one of THIS niche's own words.
     Without this, searching "hair salon" rejects every salon: "salon", "barber",
     "nails", "lash" and "spa" all sit in the other-industry list because they
     were junk when we were hunting concrete contractors. */
  const own = new Set(NICHE_WORDS[niche ?? ""] ?? []);
  const toks = `${name ?? ""} ${handle ?? ""}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (toks.some((w) => OTHER_INDUSTRY.has(w) && !own.has(w))) return true;
  /* the glued-on suffix check ("lakesandlightsart") must respect the niche too —
     "studio" is an art tell for a painting search and a normal word for a lash bar */
  const sfx = ["art", "arts", "studio"].filter((x) => !own.has(x));
  return toks.some((w) => w.length > 5 && sfx.some((x) => w.endsWith(x)));
}

export function isRelevant(
  niche: string,
  name?: string | null,
  handle?: string | null,
  bio?: string | null
): boolean {
  if (isOtherIndustry(name, handle, niche)) return false;   // a gallery is never a painting contractor
  const hay = `${name ?? ""} ${handle ?? ""} ${bio ?? ""}`.toLowerCase();
  const words = NICHE_WORDS[niche] ?? niche.toLowerCase().split(/\s+/);
  if (words.some((w) => hay.includes(w))) return true;
  return GENERIC.some((g) => hay.includes(g));
}

/**
 * What to actually type into Instagram search, per niche. The stored niche
 * label stays as-is so existing rows and the UI filters keep working.
 *
 * "painting" on its own returned artists, galleries, museums and art studios
 * by the dozen — 40-odd of them in one audit. The trade phrasing does not.
 */
export const SEARCH_TERM: Record<string, string> = {
  "painting": "painting contractor",
  "concrete contractor": "concrete contractor",
  "roofing": "roofing contractor",
  "landscaping": "landscaping company",
  "lawn care": "lawn care service",
  "tree service": "tree service company",
  "plumbing": "plumbing company",
  "electrician": "electrical contractor",
  "hvac": "hvac company",
  "fencing": "fence company",
  "moving company": "moving company",
  "pool service": "pool service company",
  "hair salon": "hair salon",
  "barbershop": "barber shop",
  "nail salon": "nail salon",
  "lash and brow": "lash studio",
  "med spa": "med spa",
  "massage therapy": "massage therapy",
};
export const searchTermFor = (niche: string) => SEARCH_TERM[niche] ?? niche;
