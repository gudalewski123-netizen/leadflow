/**
 * Shared hot-lead scoring. Used by both src/hot.ts (direct IG session) and
 * src/hotapify.ts (Apify) so the two data sources can never drift apart.
 */

/**
 * Link-in-bio AGGREGATORS (Linktree, Beacons, Taplink, …) bundle several links
 * behind one page — and very often one of those links is a real website
 * (a franchise page, a corporate site, etc). Sampling hot leads on 2026-08-18
 * turned up City of Tampa, Greenpeace Hong Kong, a former Rome mayor, and a
 * 360 Painting franchise — all scored "hot" purely because their single
 * linktr.ee link wasn't detected as a website. These get capped below the
 * hot threshold: worth a look manually, never an auto-hot lead.
 */
export const LINK_AGGREGATOR =
  /linktr\.ee|link\.tree|beacons\.ai|linkin\.bio|bio\.link|allmylinks|taplink|milkshake|campsite\.bio|msha\.ke|solo\.to|shorby/i;

/**
 * Single-purpose booking/CRM/social landing pages that are NOT a real website
 * — these leads stay fully hot. A trades business linking one of these has a
 * scheduling page or a social profile, not a website, and is still very much
 * a prospect. Found this on @donsdetailing, whose only link was
 * go.getjobber.com — 28k followers and no actual site.
 */
export const NOT_A_SITE =
  /facebook\.com|instagram\.com|m\.me|wa\.me|booksy|vagaro|fresha|square\.site|squareup|calendly|yelp\.com|google\.com|g\.page|getjobber|jobber\.com|housecallpro|thumbtack|angi\.com|porch\.com|nextdoor/i;

/**
 * National franchise brands — a local franchisee showing "no website" on
 * Google/IG isn't a real prospect: they're locked into the franchisor's
 * marketing program (a page on the corporate domain, a required ad budget),
 * not shopping for an independent freelance site. Found via a name-repeats-
 * across-dozens-of-cities audit on 2026-08-20 (Ace Handyman Services alone
 * had 118 leads across 69 different metro areas — the signature of a
 * franchise network, not small local businesses). These get excluded
 * entirely at hunt time rather than just score-capped, since unlike a link-
 * aggregator false positive, a franchise location is never a good lead
 * regardless of what its bio link looks like.
 *
 * All internal spaces are `\s?` (not a literal space) so this matches
 * equally well against a squashed IG handle ("weedman_bozeman") as it does
 * a spaced display name ("Weed Man Bozeman") — some franchisees whitewash
 * the display name entirely (found "WM Lawn Care" hiding Weed Man; that
 * one's a distinct alias below since it shares no substring with "weed
 * man"). Always check BOTH name and handle — see isFranchise().
 */
export const FRANCHISE_BRAND =
  /\b(roto-?rooter|mr\.?\s?handyman|certapro(\s?painters)?|ace\s?handyman(\s?services)?|mr\.?\s?rooter|serv\s?pro|trugreen|weed\s?man|wm\s?lawn\s?care|augusta\s?lawn\s?care|mister\s?sparky|merry\s?maids|lawn\s?doctor|aire\s?serv|benjamin\s?franklin\s?plumbing|molly\s?maid|stanley\s?steemer|handyman\s?connection|orkin|servicemaster|u\.?s\.?\s?lawns|two\s?maids|the\s?grounds\s?guys|one\s?hour\s?heating(\s?(and|&)\s?air)?|american\s?leak\s?detection|fresh\s?coat(\s?painters)?|chem-?dry|junk\s?king|window\s?genie|anago|puroclean|jdog(\s?junk\s?removal)?|terminix|precision\s?(garage\s?)?door|senske|bath\s?fitter|rainbow\s?(restoration|international)|1-?800-?got-?junk|n-?hance|re-?bath|two\s?men\s?and\s?a\s?truck|belfor|restoration\s?1|mosquito\s?joe|college\s?hunks|kitchen\s?tune-?up|win\s?home\s?inspection|bin\s?there\s?dump\s?that|mosquito\s?squad|dryer\s?vent\s?wizard|scotts\s?lawn(\s?service)?|amerispec|wallaby\s?windows|screenmobile|college\s?pro\s?painters|bath\s?planet|shelf\s?genie|budget\s?blinds|christmas\s?decor|glass\s?doctor|real\s?property\s?management|1-?800-?water\s?damage|dream\s?maker\s?bath|30\s?minute\s?cleaners|pillar\s?to\s?post|housemaster|five\s?star\s?painting)\b/i;

/** Checks both the business name and the IG handle — a franchisee's display
 * name is sometimes rebranded generic ("WM Lawn Care") while the handle
 * still gives away the real franchise ("weedman_bozeman"). */
export function isFranchise(name: string | null | undefined, igHandle?: string | null): boolean {
  return FRANCHISE_BRAND.test(name ?? "") || FRANCHISE_BRAND.test(igHandle ?? "");
}

export interface Profile {
  userId?: string | null;
  lastPost: number | null; // unix seconds
  followers: number | null;
  posts: number | null;
  externalUrl: string | null;
  email: string | null;
  phone: string | null;
  isBusiness: boolean;
}

const DAY = 86400;

/**
 * Instagram has never exposed account-creation date (no API, no scraper
 * field, unlike X/Twitter's join date) — so "how old is this business" has
 * to be inferred. Low post count alone is a false signal: an account that
 * posted 8 times two years ago and went silent ALSO has a low count. The
 * combination of few posts + still actively posting is what isolates a
 * genuinely new, live business — and it's free, since both fields are
 * already collected for every lead.
 */
export function isLikelyNewBusiness(p: Profile): boolean {
  if (p.posts == null || p.posts > 15) return false;
  if (!p.lastPost) return false;
  const ageDays = (Date.now() / 1000 - p.lastPost) / DAY;
  return ageDays <= 21;
}

export function scoreOf(p: Profile): { score: number; why: string[] } {
  const why: string[] = [];
  let s = 0;

  // 1. Recency — are they active RIGHT NOW? Biggest single factor.
  if (p.lastPost) {
    const ageDays = (Date.now() / 1000 - p.lastPost) / DAY;
    if (ageDays <= 7) { s += 40; why.push("posted this week"); }
    else if (ageDays <= 14) { s += 33; why.push("posted <2wk"); }
    else if (ageDays <= 30) { s += 26; why.push("posted <1mo"); }
    else if (ageDays <= 90) { s += 12; why.push("posted <3mo"); }
    else if (ageDays <= 180) { s += 4; why.push("posted <6mo"); }
    else why.push("stale");
  }

  // 2. Bio link — the money signal.
  let aggregator = false;
  if (!p.externalUrl) { s += 30; why.push("NO link in bio"); }
  else if (LINK_AGGREGATOR.test(p.externalUrl)) { aggregator = true; why.push("link-in-bio page — may hide a real site"); }
  else if (NOT_A_SITE.test(p.externalUrl)) { s += 22; why.push("booking/social page only"); }

  // 3. Treating IG as a business channel.
  if (p.isBusiness) { s += 10; why.push("business acct"); }

  // 4. Real local audience — big enough to have revenue, small enough to need
  //    us. Above 50k followers gets no bonus at all: that's a chain, brand,
  //    public figure, or org, not a small local business.
  if (p.followers != null) {
    if (p.followers >= 500 && p.followers <= 50000) { s += 10; why.push(`${p.followers} followers`); }
    else if (p.followers >= 150 && p.followers < 500) { s += 5; why.push(`${p.followers} followers`); }
  }

  // 5. Enough content to actually build a site from.
  if ((p.posts ?? 0) >= 20) { s += 5; why.push(`${p.posts} posts`); }

  // 6. Public contact = a second channel that isn't a DM.
  if (p.email) { s += 5; why.push("public email"); }

  // 7. New & active business — few posts total, but posting recently. This is
  // NOT just "low post count": a dead account that posted 8 times two years
  // ago and stopped also has a low count. Requiring BOTH low posts and a
  // recent lastPost is what actually isolates "just started, still going" —
  // exactly who's most likely to be shopping for a first website right now,
  // with zero legacy-site baggage. Threshold is deliberately generous (≤15
  // posts, active in the last 3 weeks) since a brand-new account posting
  // 2-3x/week hits 15 posts around the 5-7 week mark.
  if (isLikelyNewBusiness(p)) { s += 15; why.push("NEW BUSINESS — few posts, active"); }

  const score = aggregator ? Math.min(s, 45) : Math.min(100, s);
  return { score, why };
}
